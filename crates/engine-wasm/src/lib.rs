//! WebAssembly bindings. Kept deliberately thin: all logic lives in
//! `pattern-engine` so native and browser runs are identical.

use pattern_engine::{SimInput, Simulation};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Sim {
    inner: Simulation,
}

#[wasm_bindgen]
impl Sim {
    /// `input_json`: `{ design, scenario }` as described in `pattern-engine::model`.
    #[wasm_bindgen(constructor)]
    pub fn new(input_json: &str) -> Result<Sim, JsError> {
        let input: SimInput =
            serde_json::from_str(input_json).map_err(|e| JsError::new(&e.to_string()))?;
        let inner = Simulation::new(&input, true).map_err(|e| JsError::new(&e))?;
        Ok(Sim { inner })
    }

    pub fn step(&mut self, until_ms: f64) {
        self.inner.step(until_ms);
    }

    pub fn now_ms(&self) -> f64 {
        self.inner.now_ms()
    }

    /// Returns a `Float32Array` of `[edge, t0 (s), duration (s), kind]` quads.
    pub fn take_particles(&mut self) -> Vec<f32> {
        self.inner.take_particles()
    }

    pub fn take_windows_json(&mut self) -> String {
        serde_json::to_string(&self.inner.take_windows()).unwrap_or_else(|_| "[]".into())
    }

    pub fn summary_json(&self) -> String {
        serde_json::to_string(&self.inner.summary()).unwrap_or_else(|_| "{}".into())
    }

    pub fn set_rps(&mut self, rps: f64) {
        self.inner.set_rps(rps);
    }

    pub fn set_traffic_multiplier(&mut self, m: f64) {
        self.inner.set_traffic_multiplier(m);
    }

    pub fn set_node_down(&mut self, node: u32, down: bool) -> Result<(), JsError> {
        self.inner
            .set_node_down(node as usize, down)
            .map_err(|e| JsError::new(&e))
    }
}

/// Run a scenario to completion and return the summary as JSON.
#[wasm_bindgen]
pub fn run_headless(input_json: &str) -> Result<String, JsError> {
    let summary = pattern_engine::run_headless(input_json).map_err(|e| JsError::new(&e))?;
    serde_json::to_string(&summary).map_err(|e| JsError::new(&e.to_string()))
}
