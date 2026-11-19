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

    /// Trace the next `n` user requests; read them with `take_traces_json`.
    pub fn trace_next(&mut self, n: u32) {
        self.inner.trace_next(n);
    }

    pub fn take_traces_json(&mut self) -> String {
        serde_json::to_string(&self.inner.take_traces()).unwrap_or_else(|_| "[]".into())
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

/// Run a scenario to completion; returns `{ summary, windows }` as JSON.
#[wasm_bindgen]
pub fn run_detailed(input_json: &str) -> Result<String, JsError> {
    let (summary, windows) = pattern_engine::run_detailed(input_json).map_err(|e| JsError::new(&e))?;
    serde_json::to_string(&serde_json::json!({ "summary": summary, "windows": windows }))
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Score a player design against a level (both JSON). Returns the summary
/// JSON, including `stars`. The server runs the very same function.
#[wasm_bindgen]
pub fn play_level(level_json: &str, design_json: &str) -> Result<String, JsError> {
    let summary =
        pattern_engine::play_level(level_json, design_json).map_err(|e| JsError::new(&e))?;
    serde_json::to_string(&summary).map_err(|e| JsError::new(&e.to_string()))
}

/// The sanitized `{ design, scenario }` a level would simulate for this
/// design (catalog numbers applied), ready for `new Sim(...)`.
#[wasm_bindgen]
pub fn level_input(level_json: &str, design_json: &str) -> Result<String, JsError> {
    let input =
        pattern_engine::level_input(level_json, design_json).map_err(|e| JsError::new(&e))?;
    serde_json::to_string(&input).map_err(|e| JsError::new(&e.to_string()))
}

/// Default per-instance catalog, keyed by node kind.
#[wasm_bindgen]
pub fn catalog_json() -> String {
    use pattern_engine::NodeKind::*;
    let map: std::collections::BTreeMap<&str, _> = [
        ("loadBalancer", LoadBalancer),
        ("service", Service),
        ("cache", Cache),
        ("database", Database),
        ("queue", Queue),
    ]
    .into_iter()
    .map(|(k, kind)| (k, pattern_engine::default_catalog(kind)))
    .collect();
    serde_json::to_string(&map).unwrap_or_else(|_| "{}".into())
}

/// Sizing wizard: `SizingSpec` JSON in, `SizingReport` JSON out.
#[wasm_bindgen]
pub fn size_json(spec_json: &str) -> Result<String, JsError> {
    let spec: pattern_engine::sizing::SizingSpec =
        serde_json::from_str(spec_json).map_err(|e| JsError::new(&e.to_string()))?;
    let report = pattern_engine::sizing::size(&spec).map_err(|e| JsError::new(&e))?;
    serde_json::to_string(&report).map_err(|e| JsError::new(&e.to_string()))
}

/// Default sizing spec (form defaults for the UI).
#[wasm_bindgen]
pub fn default_sizing_spec() -> String {
    serde_json::to_string(&pattern_engine::sizing::SizingSpec::default()).unwrap_or_default()
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct CalibrateRequest {
    /// `[{ name, json }]`: k6 summary files.
    summaries: Vec<NamedFile>,
    /// `--fit` style keys; empty = automatic.
    fit: Vec<String>,
    /// `--observe` style specs.
    observe: Vec<String>,
    max_vus: Option<u32>,
    max_evals: Option<usize>,
    max_sim_ms: Option<f64>,
    /// SLO used for the capacity estimate.
    slo: Option<pattern_engine::Slo>,
}

#[derive(serde::Deserialize, Default)]
struct NamedFile {
    name: String,
    json: String,
}

/// Fit `design_json` to k6 summaries. Returns
/// `{ report, defaultFit, capacityRps, slo }`.
#[wasm_bindgen]
pub fn calibrate_json(design_json: &str, request_json: &str) -> Result<String, JsError> {
    use pattern_engine::calibrate as cal;
    let err = |e: String| JsError::new(&e);
    let design: pattern_engine::Design =
        serde_json::from_str(design_json).map_err(|e| JsError::new(&e.to_string()))?;
    let req: CalibrateRequest =
        serde_json::from_str(request_json).map_err(|e| JsError::new(&e.to_string()))?;
    let mut levels = vec![];
    for f in &req.summaries {
        levels.extend(cal::parse_k6_summary(&f.json, &f.name).map_err(err)?);
    }
    levels.sort_by(|a, b| a.offered_rps.total_cmp(&b.offered_rps));
    let opts = cal::CalibrateOptions {
        max_vus: req.max_vus,
        max_evals: req.max_evals.unwrap_or(80),
        max_sim_ms: req.max_sim_ms.unwrap_or(15_000.0),
        ..Default::default()
    };
    let params = if req.fit.is_empty() {
        cal::default_params(&design, &levels, &opts).map_err(err)?
    } else {
        req.fit
            .iter()
            .map(|f| cal::parse_fit(f, &design))
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?
    };
    let observations = req
        .observe
        .iter()
        .map(|o| cal::parse_observe(o, &design))
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let report = cal::calibrate(&design, &levels, &params, &observations, &opts).map_err(err)?;
    let low_p99 = levels.first().and_then(|l| l.p99_ms).unwrap_or(100.0);
    let slo = req.slo.unwrap_or(pattern_engine::Slo {
        p99_ms: (low_p99 * 3.0).max(50.0),
        error_rate: 0.01,
    });
    let top = levels.iter().map(|l| l.offered_rps).fold(0.0, f64::max);
    let cap = cal::capacity(
        &report.design,
        slo,
        top / 4.0,
        top,
        &cal::CalibrateOptions {
            max_vus: None,
            ..opts
        },
    )
    .map_err(err)?;
    let out = serde_json::json!({
        "report": report,
        "fit": params.iter().map(|p| p.key.clone()).collect::<Vec<_>>(),
        "capacityRps": cap,
        "slo": slo,
    });
    Ok(out.to_string())
}
