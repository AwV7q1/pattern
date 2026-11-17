//! Usage:
//!   pattern-sim [--windows] <scenario.json>...
//!   pattern-sim [--windows] --level <level.json> <design.json>...
//!
//! Runs each `{ design, scenario }` file headless and prints a comparison.
//! With `--level`, each file is a player design scored against the level.

use std::process::ExitCode;

use pattern_engine::{Design, Level, SimInput, Simulation};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let show_windows = args.iter().any(|a| a == "--windows");
    let mut files: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let level = if args.iter().any(|a| a == "--level") {
        if files.is_empty() {
            eprintln!("--level needs a level file");
            return ExitCode::from(2);
        }
        let path = files.remove(0);
        match std::fs::read_to_string(path)
            .map_err(|e| e.to_string())
            .and_then(|t| serde_json::from_str::<Level>(&t).map_err(|e| e.to_string()))
        {
            Ok(l) => Some(l),
            Err(e) => {
                eprintln!("{path}: {e}");
                return ExitCode::from(2);
            }
        }
    } else {
        None
    };
    if files.is_empty() {
        eprintln!("usage: pattern-sim [--windows] <scenario.json>...");
        return ExitCode::from(2);
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
        match run(path, show_windows, level.as_ref()) {
            Ok(()) => {}
            Err(e) => {
                eprintln!("{path}: {e}");
                failed = true;
            }
        }
    }
    if failed {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

fn run(path: &str, show_windows: bool, level: Option<&Level>) -> Result<(), String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let input: SimInput = match level {
        Some(level) => {
            // accept either a bare design or a `{ design }` wrapper
            let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            let design: Design = serde_json::from_value(v.get("design").cloned().unwrap_or(v))
                .map_err(|e| e.to_string())?;
            level.build_input(&design)?
        }
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
            let open: Vec<String> = w
                .edges
                .iter()
                .enumerate()
                .filter(|(_, e)| e.breaker != "closed")
                .map(|(i, e)| format!("e{i}:{}", e.breaker))
                .collect();
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
                open.join(" ")
            );
        }
    }
    Ok(())
}
