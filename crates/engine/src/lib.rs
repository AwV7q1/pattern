//! Deterministic discrete-event simulator for system architecture designs.
//!
//! The engine is pure Rust with no platform dependencies so the exact same
//! code runs natively (CLI, tests, server-side score verification) and in the
//! browser via WebAssembly. All randomness comes from a seeded RNG and all
//! transcendental math goes through `libm`, so a given input always produces
//! the same output on every platform.

pub mod histogram;
pub mod level;
pub mod model;
pub mod rng;
pub mod sim;

pub use level::{default_catalog, level_input, play_level, Level};
pub use model::{
    ChaosAction, ChaosEvent, CircuitBreaker, Design, EdgeSpec, NodeConfig, NodeKind, NodeSpec,
    Scenario, SimInput, Slo, TrafficPhase,
};
pub use sim::{EdgeWindow, NodeWindow, Simulation, Summary, WindowMetrics};

/// Parse a JSON input, run it to `scenario.durationMs` and return the summary.
pub fn run_headless(input_json: &str) -> Result<Summary, String> {
    let input: SimInput = serde_json::from_str(input_json).map_err(|e| e.to_string())?;
    let mut sim = Simulation::new(&input, false)?;
    sim.run_to_end()?;
    Ok(sim.summary())
}
