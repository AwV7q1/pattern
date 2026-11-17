//! Usage:
//!   pattern-sim [--windows] <scenario.json>...
//!   pattern-sim [--windows] --level <level.json> <design.json>...
//!   pattern-sim calibrate <design.json> <k6-summary.json>... [options]
//!   pattern-sim size <sizing.json> [--json]
//!   pattern-sim sweep <design.json> --rates 100,200,400 [--sim-ms 20000] [--arrival uniform]
//!
//! Runs each `{ design, scenario }` file headless and prints a comparison.
//! With `--level`, each file is a player design scored against the level.

use std::process::ExitCode;

use pattern_engine::calibrate::{
    self, CalibrateOptions, CalibrationReport, Measurement, Predicted,
};
use pattern_engine::sizing::{self, SizingSpec};
use pattern_engine::{Design, Level, SimInput, Simulation, Slo};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("calibrate") => cmd_calibrate(&args[1..]),
        Some("size") => cmd_size(&args[1..]),
        Some("sweep") => cmd_sweep(&args[1..]),
        _ => cmd_run(&args),
    };
    match result {
        Ok(code) => code,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::from(2)
        }
    }
}

fn read(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))
}

// ---------------------------------------------------------------- run

fn cmd_run(args: &[String]) -> Result<ExitCode, String> {
    let show_windows = args.iter().any(|a| a == "--windows");
    let mut files: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let level = if args.iter().any(|a| a == "--level") {
        if files.is_empty() {
            return Err("--level needs a level file".into());
        }
        let path = files.remove(0);
        Some(serde_json::from_str::<Level>(&read(path)?).map_err(|e| format!("{path}: {e}"))?)
    } else {
        None
    };
    if files.is_empty() {
        return Err("usage:\n  pattern-sim [--windows] <scenario.json>...\n  pattern-sim --level <level.json> <design.json>...\n  pattern-sim calibrate <design.json> <k6-summary.json>... [--fit key[=min:max]] [--observe node.metric@rps=value] [--max-vus N] [--out file]\n  pattern-sim size <sizing.json> [--json]".into());
    }

    println!(
        "{:<28} {:>8} {:>9} {:>8} {:>9} {:>9} {:>9} {:>8} {:>8}  SLO   stars",
        "scenario",
        "requests",
        "ok rps",
        "err %",
        "p50 ms",
        "p95 ms",
        "p99 ms",
        "retries",
        "cost/h"
    );
    let mut failed = false;
    for path in files {
        if let Err(e) = run(path, show_windows, level.as_ref()) {
            eprintln!("{path}: {e}");
            failed = true;
        }
    }
    Ok(if failed {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    })
}

/// Accept a bare design or a `{ design, ... }` wrapper.
fn parse_design(text: &str) -> Result<(Design, Option<serde_json::Value>), String> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let scenario = v.get("scenario").cloned();
    let design: Design =
        serde_json::from_value(v.get("design").cloned().unwrap_or(v)).map_err(|e| e.to_string())?;
    Ok((design, scenario))
}

fn run(path: &str, show_windows: bool, level: Option<&Level>) -> Result<(), String> {
    let text = read(path)?;
    let input: SimInput = match level {
        Some(level) => level.build_input(&parse_design(&text)?.0)?,
        None => serde_json::from_str(&text).map_err(|e| e.to_string())?,
    };
    let mut sim = Simulation::new(&input, false)?;
    sim.run_to_end()?;
    let s = sim.summary();
    let name = std::path::Path::new(path)
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or(path);
    println!(
        "{:<28} {:>8} {:>9.0} {:>8.2} {:>9.1} {:>9.1} {:>9.1} {:>8} {:>8.2}  {}  {}",
        name,
        s.total,
        s.throughput_rps,
        s.error_rate * 100.0,
        s.p50_ms,
        s.p95_ms,
        s.p99_ms,
        s.retries,
        s.cost_per_hour,
        if s.slo_pass { "PASS" } else { "FAIL" },
        "★".repeat(s.stars as usize) + &"☆".repeat(3 - s.stars as usize)
    );
    if show_windows {
        for w in sim.take_windows() {
            let util: Vec<String> = w
                .nodes
                .iter()
                .map(|n| format!("{:>3.0}%", n.utilization * 100.0))
                .collect();
            let queues: Vec<String> = w.nodes.iter().map(|n| n.queue.to_string()).collect();
            let lag: Vec<String> = w
                .nodes
                .iter()
                .enumerate()
                .filter(|(_, n)| n.lag_ms >= 0.05)
                .map(|(i, n)| format!("n{i}:{:.1}ms", n.lag_ms))
                .collect();
            let mut extra: Vec<String> = w
                .edges
                .iter()
                .enumerate()
                .filter(|(_, e)| e.breaker != "closed")
                .map(|(i, e)| format!("e{i}:{}", e.breaker))
                .collect();
            extra.extend(
                w.edges
                    .iter()
                    .enumerate()
                    .filter(|(_, e)| e.pool_utilization > 0.0)
                    .map(|(i, e)| {
                        format!(
                            "pool e{i}:{:.0}% wait {:.1}ms",
                            e.pool_utilization * 100.0,
                            e.pool_wait_ms
                        )
                    }),
            );
            if !lag.is_empty() {
                extra.push(format!("lag [{}]", lag.join(" ")));
            }
            println!(
                "    t={:>6.0}s ok={:>6.0}/s err={:>6.0}/s p99={:>7.1}ms retry={:>5} async={:>5}/s util=[{}] queue=[{}] {}",
                w.t_ms / 1000.0,
                w.rps,
                w.error_rps,
                w.p99_ms,
                w.retries,
                w.async_ok,
                util.join(" "),
                queues.join(" "),
                extra.join(" ")
            );
        }
    }
    Ok(())
}

// ----------------------------------------------------------- calibrate

fn flag_values<'a>(args: &'a [String], name: &str) -> Vec<&'a str> {
    args.windows(2)
        .filter(|w| w[0] == name)
        .map(|w| w[1].as_str())
        .collect()
}

fn flag_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    flag_values(args, name).into_iter().last()
}

fn positional(args: &[String]) -> Vec<&str> {
    let with_value = [
        "--fit",
        "--observe",
        "--max-vus",
        "--out",
        "--sim-ms",
        "--evals",
        "--timeout-ms",
        "--seed",
        "--rates",
        "--arrival",
    ];
    let mut out = vec![];
    let mut skip = false;
    for a in args {
        if skip {
            skip = false;
        } else if with_value.contains(&a.as_str()) {
            skip = true;
        } else if !a.starts_with("--") {
            out.push(a.as_str());
        }
    }
    out
}

fn parse_num<T: std::str::FromStr>(args: &[String], name: &str) -> Result<Option<T>, String> {
    flag_value(args, name)
        .map(|v| {
            v.parse::<T>()
                .map_err(|_| format!("{name}: bad value '{v}'"))
        })
        .transpose()
}

fn fmt_opt(v: Option<f64>) -> String {
    v.map_or("-".into(), |v| format!("{v:.1}"))
}

fn delta(sim: f64, meas: Option<f64>) -> String {
    match meas {
        Some(m) if m > 0.0 => format!("{:+.0}%", (sim / m - 1.0) * 100.0),
        _ => "".into(),
    }
}

fn print_compare(m: &Measurement, p: &Predicted, label: &str) {
    println!(
        "  {:<9} {:>9.1} {:>7.2} {:>9} {:>9} {:>9}",
        label,
        p.ok_rps,
        p.error_rate * 100.0,
        format!("{:.1} {}", p.p50_ms, delta(p.p50_ms, m.p50_ms)),
        format!("{:.1} {}", p.p95_ms, delta(p.p95_ms, m.p95_ms)),
        format!("{:.1} {}", p.p99_ms, delta(p.p99_ms, m.p99_ms)),
    );
}

fn print_report(r: &CalibrationReport, design: &Design) {
    println!(
        "\nTham số đã fit ({} lần mô phỏng, sai số {:.3} → {:.3}):",
        r.evaluations, r.loss_before, r.loss_after
    );
    for p in &r.params {
        let v = if p.multiplier {
            format!("×{:.3}", p.after)
        } else {
            format!("{:.3} (trước: {:.3})", p.after, p.before)
        };
        println!(
            "  {:<24} {}{}",
            p.key,
            v,
            if p.at_bound {
                "   ⚠ chạm biên khoảng tìm kiếm"
            } else {
                ""
            }
        );
    }
    println!("\nSo sánh từng mức tải (đo bằng k6 / mô phỏng trước / sau hiệu chỉnh):");
    println!(
        "  {:<9} {:>9} {:>7} {:>9} {:>9} {:>9}",
        "", "ok rps", "err %", "p50 ms", "p95 ms", "p99 ms"
    );
    for l in &r.levels {
        let m = &l.measured;
        println!(
            "{} (offered {:.0} rps, {:.0}s)",
            m.name,
            m.offered_rps,
            m.duration_ms / 1000.0
        );
        println!(
            "  {:<9} {:>9.1} {:>7.2} {:>9} {:>9} {:>9}",
            "k6",
            m.ok_rps,
            m.error_rate * 100.0,
            fmt_opt(m.p50_ms),
            fmt_opt(m.p95_ms),
            fmt_opt(m.p99_ms)
        );
        print_compare(m, &l.before, "trước");
        print_compare(m, &l.after, "sau");
        let busiest = design
            .nodes
            .iter()
            .enumerate()
            .filter(|(i, _)| l.after.node_utilization[*i] > 0.0)
            .map(|(i, n)| format!("{} {:.0}%", n.id, l.after.node_utilization[i] * 100.0))
            .collect::<Vec<_>>();
        let pools = design
            .edges
            .iter()
            .enumerate()
            .filter(|(i, _)| l.after.pool_utilization[*i] > 0.0)
            .map(|(i, e)| {
                format!(
                    "pool {}→{} {:.0}%",
                    e.source,
                    e.target,
                    l.after.pool_utilization[i] * 100.0
                )
            })
            .collect::<Vec<_>>();
        println!(
            "  {:<9} {}",
            "util",
            busiest
                .into_iter()
                .chain(pools)
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
}

fn cmd_calibrate(args: &[String]) -> Result<ExitCode, String> {
    let pos = positional(args);
    if pos.len() < 2 {
        return Err("usage: pattern-sim calibrate <design.json> <k6-summary.json>... [--fit key[=min:max]]... [--observe node.metric@rps=value]... [--max-vus N] [--sim-ms 20000] [--evals 100] [--out calibrated.json]".into());
    }
    let (design, scenario) = parse_design(&read(pos[0])?)?;
    let mut levels = vec![];
    for path in &pos[1..] {
        levels.extend(calibrate::parse_k6_summary(&read(path)?, path)?);
    }
    levels.sort_by(|a, b| a.offered_rps.total_cmp(&b.offered_rps));
    let slo: Option<Slo> = scenario
        .as_ref()
        .and_then(|s| s.get("slo").cloned())
        .and_then(|v| serde_json::from_value(v).ok());
    let opts = CalibrateOptions {
        max_vus: parse_num(args, "--max-vus")?,
        max_sim_ms: parse_num(args, "--sim-ms")?.unwrap_or(20_000.0),
        max_evals: parse_num(args, "--evals")?.unwrap_or(100),
        timeout_ms: parse_num(args, "--timeout-ms")?.unwrap_or(60_000.0),
        seed: parse_num(args, "--seed")?.unwrap_or(1),
    };

    println!("Đọc {} mức tải từ k6:", levels.len());
    for l in &levels {
        println!(
            "  {:<16} offered {:>8.1} rps  ok {:>8.1} rps  lỗi {:>5.2}%  p50 {:>7} p95 {:>7} p99 {:>7} ms{}",
            l.name,
            l.offered_rps,
            l.ok_rps,
            l.error_rate * 100.0,
            fmt_opt(l.p50_ms),
            fmt_opt(l.p95_ms),
            fmt_opt(l.p99_ms),
            if l.dropped_rps > 0.0 { format!("  dropped {:.1}/s (thiếu VU?)", l.dropped_rps) } else { String::new() }
        );
    }
    if levels.iter().all(|l| l.p99_ms.is_none()) {
        println!("  (không có p99: thêm 'p(99)' vào summaryTrendStats của k6)");
    }

    let fit = flag_values(args, "--fit");
    let params = if fit.is_empty() {
        let p = calibrate::default_params(&design, &levels, &opts)?;
        println!(
            "\nKhông có --fit: tự chọn {} (núm công suất của tài nguyên bận nhất + hệ số latency chung).",
            p.iter().map(|p| p.key.as_str()).collect::<Vec<_>>().join(", ")
        );
        p
    } else {
        fit.iter()
            .map(|f| calibrate::parse_fit(f, &design))
            .collect::<Result<Vec<_>, _>>()?
    };
    let observations = flag_values(args, "--observe")
        .iter()
        .map(|o| calibrate::parse_observe(o, &design))
        .collect::<Result<Vec<_>, _>>()?;
    for o in &observations {
        println!("  quan sát thêm: {} = {}", o.key, o.value);
    }
    if !observations
        .iter()
        .any(|o| o.metric == calibrate::ObservedMetric::Utilization)
    {
        println!(
            "\n⚠ Chưa có số đo CPU (--observe <node>.utilization@<rps>=<0..1>). Chỉ từ latency, mô hình không phân biệt được\n  \"p99 cao vì CPU gần đầy\" với \"p99 cao vì GC/pause\": giới hạn dự đoán có thể lệch 2 lần. Đo CPU bằng tools/k6/cpu-per-request.sh."
        );
    }
    if levels.len() < 2 {
        println!("\n⚠ Chỉ có 1 mức tải: không phân biệt được latency cơ bản với điểm bão hoà. Nên đo 2–3 mức.");
    }

    let report = calibrate::calibrate(&design, &levels, &params, &observations, &opts)?;
    print_report(&report, &design);

    let worst = report
        .levels
        .iter()
        .flat_map(|l| {
            [
                (l.after.p50_ms, l.measured.p50_ms),
                (l.after.p99_ms, l.measured.p99_ms),
                (l.after.ok_rps, Some(l.measured.ok_rps)),
            ]
        })
        .filter_map(|(s, m)| m.filter(|m| *m > 0.0).map(|m| (s / m - 1.0).abs()))
        .fold(0.0, f64::max);
    println!(
        "\nĐộ khớp: lệch lớn nhất {:.0}%. {}",
        worst * 100.0,
        if worst < 0.15 {
            "Tốt: có thể dùng design này để hỏi \"nếu thì sao\"."
        } else if worst < 0.35 {
            "Tạm được: xem lại mức lệch nhiều nhất."
        } else {
            "Kém: mô hình thiếu yếu tố nào đó (GC, lock, N+1 query, CPU throttling...). Thử --fit thêm tham số hoặc --observe số liệu từng node."
        }
    );

    let low_p99 = report
        .levels
        .first()
        .and_then(|l| l.measured.p99_ms)
        .unwrap_or(100.0);
    let slo = slo.unwrap_or(Slo {
        p99_ms: (low_p99 * 3.0).max(50.0),
        error_rate: 0.01,
    });
    let top = levels.iter().map(|l| l.offered_rps).fold(0.0, f64::max);
    let cap = calibrate::capacity(
        &report.design,
        slo,
        top / 4.0,
        top,
        &CalibrateOptions {
            max_vus: None,
            ..opts.clone()
        },
    )?;
    println!(
        "Giới hạn ước tính với traffic thật (Poisson), SLO p99 ≤ {:.0} ms và lỗi ≤ {:.1}%: ~{:.0} rps",
        slo.p99_ms,
        slo.error_rate * 100.0,
        cap
    );

    if let Some(out) = flag_value(args, "--out") {
        let mut v = serde_json::json!({ "design": report.design });
        if let Some(s) = scenario {
            v["scenario"] = s;
        }
        std::fs::write(out, serde_json::to_string_pretty(&v).unwrap())
            .map_err(|e| format!("{out}: {e}"))?;
        println!("Đã ghi design đã hiệu chỉnh vào {out}");
    }
    Ok(ExitCode::SUCCESS)
}

// ---------------------------------------------------------------- size

fn cmd_size(args: &[String]) -> Result<ExitCode, String> {
    let pos = positional(args);
    let spec: SizingSpec = match pos.first() {
        Some(path) => serde_json::from_str(&read(path)?).map_err(|e| format!("{path}: {e}"))?,
        None => SizingSpec::default(),
    };
    let r = sizing::size(&spec)?;
    if args.iter().any(|a| a == "--json") {
        println!("{}", serde_json::to_string_pretty(&r).unwrap());
        return Ok(ExitCode::SUCCESS);
    }
    let a = &r.analytic;
    println!(
        "Tải: cao điểm {:.0} rps, thiết kế cho {:.0} rps (đột biến)",
        a.peak_rps, a.design_rps
    );
    println!("Ước tính nhanh (utilization law):");
    println!(
        "  App : {:.2} ms CPU/request trên vCPU đích → {:.1} core bận lúc cao điểm, cần ~{:.1} vCPU ở {:.0}% tải",
        a.app_cpu_ms,
        a.app_cores_busy,
        a.app_cores_needed,
        spec.target_utilization * 100.0
    );
    println!(
        "  DB  : {:.1} core bận, cần ~{:.1} vCPU; trung bình {:.1} kết nối bận",
        a.db_cores_busy, a.db_cores_needed, a.db_connections_busy
    );
    println!(
        "  Mạng: {:.1} Mbps lúc đột biến, ~{:.0} GB/tháng",
        a.bandwidth_mbps, a.monthly_traffic_gb
    );
    println!("\nPhương án (rẻ nhất trước, chỉ mô phỏng tới khi tìm được phương án đạt):");
    for (i, c) in r.candidates.iter().enumerate().filter(|(_, c)| c.simulated) {
        let tag = if Some(i) == r.recommended {
            "  ← ĐỀ XUẤT"
        } else if Some(i) == r.rule_of_thumb {
            "  ← theo công thức"
        } else {
            ""
        };
        println!(
            "  {} {}× {} + DB {}  ${:.0}/tháng  pool {}/process  (CPU app {:.0}%, DB {:.0}%){}",
            if c.pass { "✔" } else { "✘" },
            c.app_servers,
            c.app_plan.name,
            c.db_plan.name,
            c.monthly_cost,
            c.pool_per_process,
            c.app_utilization * 100.0,
            c.db_utilization * 100.0,
            tag
        );
        for k in &c.checks {
            println!(
                "      {} {:<28} {:>6.0} rps  p99 {:>7.1} ms  lỗi {:>5.2}%  app {:>3.0}% db {:>3.0}% pool {:>3.0}% lag {:.1} ms{}",
                if k.pass { "✔" } else { "✘" },
                k.name,
                k.rps,
                k.p99_ms,
                k.error_rate * 100.0,
                k.app_utilization * 100.0,
                k.db_utilization * 100.0,
                k.pool_utilization * 100.0,
                k.event_loop_lag_ms,
                if k.required { "" } else { "  (tham khảo)" }
            );
        }
    }
    if let Some(i) = r.rule_of_thumb {
        if r.recommended != Some(i) {
            let c = &r.candidates[i];
            println!(
                "\nTheo công thức ({}% tải) chọn: {}× {} + DB {} (${:.0}/tháng){}",
                spec.target_utilization * 100.0,
                c.app_servers,
                c.app_plan.name,
                c.db_plan.name,
                c.monthly_cost,
                if c.simulated {
                    ""
                } else {
                    " (chưa mô phỏng)"
                }
            );
        }
    }
    println!();
    for n in &r.notes {
        println!("• {n}");
    }
    Ok(if r.recommended.is_some() {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    })
}

// ---------------------------------------------------------------- sweep

/// Predict a design at several constant arrival rates.
fn cmd_sweep(args: &[String]) -> Result<ExitCode, String> {
    let pos = positional(args);
    let path = pos.first().ok_or("usage: pattern-sim sweep <design.json> --rates 100,200,400 [--sim-ms 20000] [--arrival poisson|uniform]")?;
    let (design, _) = parse_design(&read(path)?)?;
    let rates: Vec<f64> = flag_value(args, "--rates")
        .ok_or("--rates is required, e.g. --rates 100,200,400")?
        .split(',')
        .map(|r| {
            r.trim()
                .parse::<f64>()
                .map_err(|_| format!("--rates: bad value '{r}'"))
        })
        .collect::<Result<_, _>>()?;
    let arrival = match flag_value(args, "--arrival").unwrap_or("poisson") {
        "uniform" => pattern_engine::Arrival::Uniform,
        "poisson" => pattern_engine::Arrival::Poisson,
        a => return Err(format!("--arrival: poisson or uniform, got '{a}'")),
    };
    let opts = CalibrateOptions {
        max_sim_ms: parse_num(args, "--sim-ms")?.unwrap_or(20_000.0),
        timeout_ms: parse_num(args, "--timeout-ms")?.unwrap_or(60_000.0),
        seed: parse_num(args, "--seed")?.unwrap_or(1),
        ..Default::default()
    };
    let busy: Vec<usize> = (0..design.nodes.len())
        .filter(|&i| design.nodes[i].kind != pattern_engine::NodeKind::Client)
        .collect();
    print!(
        "{:>9} {:>9} {:>7} {:>8} {:>8} {:>8}",
        "rps", "ok rps", "err %", "p50 ms", "p95 ms", "p99 ms"
    );
    for &i in &busy {
        print!("  {:>12}", format!("{} util/lag", design.nodes[i].id));
    }
    println!();
    for rps in rates {
        let (p, _) = calibrate::predict(&design, rps, opts.max_sim_ms, arrival, &opts)?;
        print!(
            "{:>9.0} {:>9.1} {:>7.2} {:>8.1} {:>8.1} {:>8.1}",
            rps,
            p.ok_rps,
            p.error_rate * 100.0,
            p.p50_ms,
            p.p95_ms,
            p.p99_ms
        );
        for &i in &busy {
            print!(
                "  {:>12}",
                format!(
                    "{:.0}% {:.1}ms",
                    p.node_utilization[i] * 100.0,
                    p.node_lag_ms[i]
                )
            );
        }
        println!();
    }
    Ok(ExitCode::SUCCESS)
}
