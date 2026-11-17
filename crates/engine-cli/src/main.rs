//! Usage: pattern-sim [--windows] <scenario.json>...
//!
//! Runs each `{ design, scenario }` file headless and prints a comparison.

use std::process::ExitCode;

use pattern_engine::{SimInput, Simulation};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let show_windows = args.iter().any(|a| a == "--windows");
    let files: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    if files.is_empty() {
        eprintln!("usage: pattern-sim [--windows] <scenario.json>...");
        return ExitCode::from(2);
    }

    println!(
        "{:<28} {:>8} {:>9} {:>8} {:>9} {:>9} {:>9} {:>8}  SLO",
        "scenario", "requests", "ok rps", "err %", "p50 ms", "p95 ms", "p99 ms", "cost/h"
    );
    let mut failed = false;
    for path in files {
        match run(path, show_windows) {
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

fn run(path: &str, show_windows: bool) -> Result<(), String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let input: SimInput = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let mut sim = Simulation::new(&input, false)?;
    sim.run_to_end()?;
    let s = sim.summary();
    let name = std::path::Path::new(path)
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or(path);
    println!(
        "{:<28} {:>8} {:>9.0} {:>8.2} {:>9.1} {:>9.1} {:>9.1} {:>8.2}  {}",
        name,
        s.total,
        s.throughput_rps,
        s.error_rate * 100.0,
        s.p50_ms,
        s.p95_ms,
        s.p99_ms,
        s.cost_per_hour,
        if s.slo_pass { "PASS" } else { "FAIL" }
    );
    if show_windows {
        for w in sim.take_windows() {
            let util: Vec<String> = w
                .nodes
                .iter()
                .map(|n| format!("{:>3.0}%", n.utilization * 100.0))
                .collect();
            let queues: Vec<String> = w.nodes.iter().map(|n| n.queue.to_string()).collect();
            println!(
                "    t={:>6.0}s ok={:>6.0}/s err={:>6.0}/s p99={:>7.1}ms async={:>5}/s util=[{}] queue=[{}]",
                w.t_ms / 1000.0,
                w.rps,
                w.error_rps,
                w.p99_ms,
                w.async_ok,
                util.join(" "),
                queues.join(" ")
            );
        }
    }
    Ok(())
}
