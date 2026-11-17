//! Fit a design to load-test measurements.
//!
//! Input: a design whose structure is known (who calls whom, pool sizes,
//! process counts) and k6 summaries at a few load levels. The parameters
//! that are hard to know up front (CPU cost, effective concurrency, a global
//! latency scale...) are searched so that simulating the same k6 test
//! reproduces the measured throughput, error rate and percentiles.
//!
//! From end-to-end numbers only a couple of parameters are identifiable:
//! one that sets latency at low load and one that sets where the system
//! saturates. That is the default fit. Per-node numbers (`--observe`, e.g.
//! DB utilization from Prometheus) let more parameters be fitted.

use serde::Serialize;
use serde_json::Value;

use crate::model::{Arrival, Design, ExecModel, NodeKind, Scenario, SimInput, Slo, TrafficPhase};
use crate::sim::{Simulation, Summary};

/// One load level as measured by k6.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Measurement {
    pub name: String,
    /// Target arrival rate (iterations started + dropped).
    pub offered_rps: f64,
    pub duration_ms: f64,
    pub ok_rps: f64,
    pub error_rate: f64,
    pub dropped_rps: f64,
    pub p50_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub p99_ms: Option<f64>,
}

fn metric<'a>(metrics: &'a Value, name: &str) -> Option<&'a Value> {
    let m = metrics.get(name)?;
    // `handleSummary` data nests numbers under `values`; `--summary-export` does not
    Some(m.get("values").unwrap_or(m))
}

fn num(m: Option<&Value>, key: &str) -> Option<f64> {
    m?.get(key)?.as_f64()
}

/// Parse `rps500_60s` → (500, 60 000 ms).
fn parse_step_name(name: &str) -> Option<(f64, f64)> {
    let rest = name.strip_prefix("rps")?;
    let (rate, dur) = rest.split_once('_')?;
    let dur = dur.strip_suffix('s')?;
    Some((rate.parse().ok()?, dur.parse::<f64>().ok()? * 1000.0))
}

fn level_from(
    metrics: &Value,
    suffix: &str,
    name: String,
    offered: Option<f64>,
    duration_ms: Option<f64>,
) -> Result<Measurement, String> {
    let m = |n: &str| metric(metrics, &format!("{n}{suffix}"));
    let dur =
        m("http_req_duration").ok_or_else(|| format!("{name}: no http_req_duration{suffix}"))?;
    let reqs = m("http_reqs");
    let iters = m("iterations");
    let count = num(reqs, "count").or(num(iters, "count")).unwrap_or(0.0);
    let error_rate = num(m("http_req_failed"), "value")
        .or_else(|| num(m("http_req_failed"), "rate"))
        .unwrap_or(0.0);
    let dropped = num(m("dropped_iterations"), "count").unwrap_or(0.0);
    let duration_ms = match duration_ms {
        Some(d) => d,
        None => {
            let (c, r) = (
                num(iters, "count").unwrap_or(count),
                num(iters, "rate").or(num(reqs, "rate")),
            );
            match r {
                Some(r) if r > 0.0 => c / r * 1000.0,
                _ => return Err(format!("{name}: cannot infer the test duration")),
            }
        }
    };
    let secs = duration_ms / 1000.0;
    let offered = offered.unwrap_or((num(iters, "count").unwrap_or(count) + dropped) / secs);
    Ok(Measurement {
        name,
        offered_rps: offered,
        duration_ms,
        ok_rps: count * (1.0 - error_rate) / secs,
        error_rate,
        dropped_rps: dropped / secs,
        p50_ms: num(Some(dur), "med").or(num(Some(dur), "p(50)")),
        p95_ms: num(Some(dur), "p(95)"),
        p99_ms: num(Some(dur), "p(99)"),
    })
}

/// Parse a k6 `--summary-export` (or `handleSummary` JSON) file.
///
/// If it contains per-scenario sub-metrics named `rpsRATE_DURs` (as written
/// by `tools/k6/step-load.js`), each becomes a level. Otherwise the whole
/// file is one level and the rate is inferred from the iteration counts.
pub fn parse_k6_summary(json: &str, name: &str) -> Result<Vec<Measurement>, String> {
    let v: Value = serde_json::from_str(json).map_err(|e| format!("{name}: {e}"))?;
    let metrics = v
        .get("metrics")
        .ok_or_else(|| format!("{name}: no `metrics` (not a k6 summary?)"))?;
    let mut steps: Vec<(String, f64, f64)> = metrics
        .as_object()
        .into_iter()
        .flat_map(|o| o.keys())
        .filter_map(|k| {
            let tag = k
                .strip_prefix("http_req_duration{scenario:")?
                .strip_suffix('}')?;
            let (rate, dur) = parse_step_name(tag)?;
            Some((tag.to_string(), rate, dur))
        })
        .collect();
    if steps.is_empty() {
        return Ok(vec![level_from(metrics, "", name.to_string(), None, None)?]);
    }
    steps.sort_by(|a, b| a.1.total_cmp(&b.1));
    steps
        .into_iter()
        .map(|(tag, rate, dur)| {
            level_from(
                metrics,
                &format!("{{scenario:{tag}}}"),
                tag,
                Some(rate),
                Some(dur),
            )
        })
        .collect()
}

// ------------------------------------------------------------------ params

#[derive(Clone, Debug, PartialEq)]
enum Target {
    AllLatency,
    NodeLatency(usize),
    NodeCpu(usize),
    NodeIo(usize),
    /// Multiplier on cpu p99 only (tail shape).
    NodeCpuTail(usize),
    GcPause(usize),
    GcEvery(usize),
    Wakeup(usize),
    Concurrency(usize),
    CpuLanes(usize),
    MaxInFlight(usize),
    Contention(usize),
    Pool(usize),
    EdgeLatency(usize),
}

impl Target {
    fn is_multiplier(&self) -> bool {
        matches!(
            self,
            Target::AllLatency
                | Target::NodeLatency(_)
                | Target::NodeCpu(_)
                | Target::NodeIo(_)
                | Target::NodeCpuTail(_)
        )
    }
    fn is_integer(&self) -> bool {
        matches!(
            self,
            Target::Concurrency(_)
                | Target::CpuLanes(_)
                | Target::MaxInFlight(_)
                | Target::Pool(_)
                | Target::GcEvery(_)
        )
    }
}

#[derive(Clone, Debug)]
pub struct FitParam {
    pub key: String,
    target: Target,
    min: f64,
    max: f64,
    init: f64,
}

fn scale_latency(c: &mut crate::model::NodeConfig, v: f64) {
    c.latency_p50_ms *= v;
    c.latency_p99_ms *= v;
    c.cpu_p50_ms *= v;
    c.cpu_p99_ms *= v;
    c.io_p50_ms *= v;
    c.io_p99_ms *= v;
}

fn apply(design: &mut Design, t: &Target, v: f64) {
    match *t {
        Target::AllLatency => design
            .nodes
            .iter_mut()
            .filter(|n| n.kind != NodeKind::Client)
            .for_each(|n| scale_latency(&mut n.config, v)),
        Target::NodeLatency(i) => scale_latency(&mut design.nodes[i].config, v),
        Target::NodeCpu(i) => {
            let c = &mut design.nodes[i].config;
            c.cpu_p50_ms *= v;
            c.cpu_p99_ms *= v;
        }
        Target::NodeIo(i) => {
            let c = &mut design.nodes[i].config;
            c.io_p50_ms *= v;
            c.io_p99_ms *= v;
        }
        Target::NodeCpuTail(i) => {
            let c = &mut design.nodes[i].config;
            c.cpu_p99_ms = (c.cpu_p99_ms * v).max(c.cpu_p50_ms);
        }
        Target::Wakeup(i) => design.nodes[i].config.wakeup_ms = v,
        Target::GcPause(i) => {
            let c = &mut design.nodes[i].config;
            c.gc_pause_ms = v;
            if c.gc_every_requests == 0 {
                c.gc_every_requests = 1000;
            }
        }
        Target::GcEvery(i) => {
            let c = &mut design.nodes[i].config;
            c.gc_every_requests = v.round().max(1.0) as u32;
            if c.gc_pause_ms <= 0.0 {
                c.gc_pause_ms = 2.0;
            }
        }
        Target::Concurrency(i) => design.nodes[i].config.concurrency = v.round().max(1.0) as u32,
        Target::CpuLanes(i) => design.nodes[i].config.cpu_lanes = v.round().max(1.0) as u32,
        Target::MaxInFlight(i) => design.nodes[i].config.max_in_flight = v.round().max(1.0) as u32,
        Target::Contention(i) => design.nodes[i].config.contention = v,
        Target::Pool(e) => design.edges[e].pool_size = Some(v.round().max(1.0) as u32),
        Target::EdgeLatency(e) => design.edges[e].latency_ms = v,
    }
}

fn current(design: &Design, t: &Target) -> f64 {
    match *t {
        Target::AllLatency
        | Target::NodeLatency(_)
        | Target::NodeCpu(_)
        | Target::NodeIo(_)
        | Target::NodeCpuTail(_) => 1.0,
        Target::GcPause(i) => design.nodes[i].config.gc_pause_ms.max(2.0),
        Target::Wakeup(i) => design.nodes[i].config.wakeup_ms.max(0.05),
        Target::GcEvery(i) => match design.nodes[i].config.gc_every_requests {
            0 => 1000.0,
            n => n as f64,
        },
        Target::Concurrency(i) => design.nodes[i].config.concurrency as f64,
        Target::CpuLanes(i) => design.nodes[i].config.cpu_lanes as f64,
        Target::MaxInFlight(i) => design.nodes[i].config.max_in_flight as f64,
        Target::Contention(i) => design.nodes[i].config.contention.max(0.001),
        Target::Pool(e) => design.edges[e].pool_size.unwrap_or(10) as f64,
        Target::EdgeLatency(e) => design.edges[e].latency_ms.max(0.1),
    }
}

/// Parse `node.field[=min:max]`, `*.latency`, `a->b.pool`, `a->b.latency`.
///
/// Node fields: `latency`, `cpu`, `io`, `cpuTail` (multipliers, default
/// range 0.1..10), `concurrency`, `cpuLanes`, `maxInFlight`, `contention`,
/// `gcPause` (ms), `gcEvery` (requests), `wakeup` (ms).
pub fn parse_fit(spec: &str, design: &Design) -> Result<FitParam, String> {
    let (key, range) = match spec.split_once('=') {
        Some((k, r)) => (k, Some(r)),
        None => (spec, None),
    };
    let (who, field) = key
        .rsplit_once('.')
        .ok_or_else(|| format!("--fit {spec}: expected <node>.<field>"))?;
    let node = |id: &str| {
        design
            .nodes
            .iter()
            .position(|n| n.id == id)
            .ok_or_else(|| format!("--fit {spec}: unknown node '{id}'"))
    };
    let target = if who == "*" {
        match field {
            "latency" => Target::AllLatency,
            _ => return Err(format!("--fit {spec}: only *.latency is supported")),
        }
    } else if let Some((a, b)) = who.split_once("->") {
        let e = design
            .edges
            .iter()
            .position(|e| e.source == a && e.target == b)
            .ok_or_else(|| format!("--fit {spec}: unknown edge {a}->{b}"))?;
        match field {
            "pool" => Target::Pool(e),
            "latency" => Target::EdgeLatency(e),
            _ => return Err(format!("--fit {spec}: edge fields are pool, latency")),
        }
    } else {
        let i = node(who)?;
        match field {
            "latency" => Target::NodeLatency(i),
            "cpu" => Target::NodeCpu(i),
            "io" => Target::NodeIo(i),
            "cpuTail" => Target::NodeCpuTail(i),
            "gcPause" => Target::GcPause(i),
            "gcEvery" => Target::GcEvery(i),
            "wakeup" => Target::Wakeup(i),
            "concurrency" => Target::Concurrency(i),
            "cpuLanes" => Target::CpuLanes(i),
            "maxInFlight" => Target::MaxInFlight(i),
            "contention" => Target::Contention(i),
            _ => return Err(format!("--fit {spec}: unknown field '{field}'")),
        }
    };
    let cur = current(design, &target);
    let (min, max) = match range {
        Some(r) => {
            let (a, b) = r
                .split_once(':')
                .ok_or_else(|| format!("--fit {spec}: range is min:max"))?;
            let a: f64 = a.parse().map_err(|_| format!("--fit {spec}: bad min"))?;
            let b: f64 = b.parse().map_err(|_| format!("--fit {spec}: bad max"))?;
            (a.min(b), a.max(b))
        }
        None if target.is_multiplier() => (0.1, 10.0),
        None if matches!(target, Target::Contention(_)) => (0.0001, 0.3),
        None if matches!(target, Target::GcPause(_)) => (0.2, 100.0),
        None if matches!(target, Target::Wakeup(_)) => (0.01, 5.0),
        None if matches!(target, Target::GcEvery(_)) => (20.0, 20_000.0),
        None => ((cur / 4.0).max(1.0), cur * 4.0),
    };
    if min <= 0.0 {
        return Err(format!("--fit {spec}: range must be > 0"));
    }
    Ok(FitParam {
        key: key.to_string(),
        target,
        min,
        max: max.max(min * 1.0001),
        init: cur.clamp(min, max),
    })
}

/// Per-node observation, e.g. `db.utilization@500=0.62` (utilization of
/// `db` at the level whose offered rate is closest to 500 rps).
#[derive(Clone, Debug)]
pub struct Observation {
    pub node: usize,
    pub metric: ObservedMetric,
    pub level_rps: f64,
    pub value: f64,
    pub key: String,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ObservedMetric {
    Utilization,
    InFlight,
    LagMs,
}

pub fn parse_observe(spec: &str, design: &Design) -> Result<Observation, String> {
    let err =
        || format!("--observe {spec}: expected <node>.<utilization|inFlight|lagMs>@<rps>=<value>");
    let (lhs, value) = spec.split_once('=').ok_or_else(err)?;
    let (key, rps) = lhs.split_once('@').ok_or_else(err)?;
    let (id, m) = key.rsplit_once('.').ok_or_else(err)?;
    let node = design
        .nodes
        .iter()
        .position(|n| n.id == id)
        .ok_or_else(|| format!("--observe {spec}: unknown node"))?;
    let metric = match m {
        "utilization" => ObservedMetric::Utilization,
        "inFlight" => ObservedMetric::InFlight,
        "lagMs" => ObservedMetric::LagMs,
        _ => return Err(err()),
    };
    Ok(Observation {
        node,
        metric,
        level_rps: rps.parse().map_err(|_| err())?,
        value: value.parse().map_err(|_| err())?,
        key: lhs.to_string(),
    })
}

// --------------------------------------------------------------- simulation

#[derive(Clone, Debug)]
pub struct CalibrateOptions {
    pub seed: u64,
    /// Cap on simulated time per level (shorter = faster fit).
    pub max_sim_ms: f64,
    /// k6 `maxVUs`, if the test had one.
    pub max_vus: Option<u32>,
    /// Client timeout (k6 default 60 s).
    pub timeout_ms: f64,
    pub max_evals: usize,
}

impl Default for CalibrateOptions {
    fn default() -> Self {
        Self {
            seed: 1,
            max_sim_ms: 20_000.0,
            max_vus: None,
            timeout_ms: 60_000.0,
            max_evals: 100,
        }
    }
}

/// What the simulator predicts for one level.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Predicted {
    pub ok_rps: f64,
    pub error_rate: f64,
    pub dropped_rps: f64,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
    /// Average per node over the run (after the first second).
    pub node_utilization: Vec<f64>,
    pub node_in_flight: Vec<f64>,
    pub node_lag_ms: Vec<f64>,
    pub pool_utilization: Vec<f64>,
}

fn scenario_for(
    rps: f64,
    duration_ms: f64,
    arrival: Arrival,
    opts: &CalibrateOptions,
    slo: Slo,
) -> Scenario {
    Scenario {
        seed: opts.seed,
        duration_ms: Some(duration_ms),
        timeout_ms: opts.timeout_ms,
        traffic: vec![TrafficPhase { at_ms: 0.0, rps }],
        slo,
        window_ms: 1000.0,
        events: vec![],
        budget_per_hour: None,
        arrival,
        max_concurrent: opts.max_vus,
    }
}

pub fn predict(
    design: &Design,
    rps: f64,
    duration_ms: f64,
    arrival: Arrival,
    opts: &CalibrateOptions,
) -> Result<(Predicted, Summary), String> {
    let input = SimInput {
        design: design.clone(),
        scenario: scenario_for(
            rps,
            duration_ms.min(opts.max_sim_ms),
            arrival,
            opts,
            Slo::default(),
        ),
    };
    let mut sim = Simulation::new(&input, false)?;
    sim.run_to_end()?;
    let s = sim.summary();
    let w = sim.take_windows();
    let skip = if w.len() > 2 { 1 } else { 0 };
    let n = (w.len() - skip).max(1) as f64;
    let avg_node = |f: &dyn Fn(&crate::sim::NodeWindow) -> f64| -> Vec<f64> {
        (0..design.nodes.len())
            .map(|i| w[skip..].iter().map(|w| f(&w.nodes[i])).sum::<f64>() / n)
            .collect()
    };
    let secs = s.duration_ms / 1000.0;
    Ok((
        Predicted {
            ok_rps: s.ok as f64 / secs,
            error_rate: s.error_rate,
            dropped_rps: s.dropped as f64 / secs,
            p50_ms: s.p50_ms,
            p95_ms: s.p95_ms,
            p99_ms: s.p99_ms,
            node_utilization: avg_node(&|n| n.utilization),
            node_in_flight: avg_node(&|n| n.in_flight),
            node_lag_ms: avg_node(&|n| n.lag_ms),
            pool_utilization: (0..design.edges.len())
                .map(|i| {
                    w[skip..]
                        .iter()
                        .map(|w| w.edges[i].pool_utilization)
                        .sum::<f64>()
                        / n
                })
                .collect(),
        },
        s,
    ))
}

fn log_err(sim: f64, meas: Option<f64>) -> f64 {
    match meas {
        Some(m) if m > 0.0 => {
            let d = libm::log(sim.max(0.01) / m);
            d * d
        }
        _ => 0.0,
    }
}

fn loss(levels: &[Measurement], preds: &[Predicted], obs: &[Observation]) -> f64 {
    let mut l = 0.0;
    for (m, p) in levels.iter().zip(preds) {
        l +=
            log_err(p.p50_ms, m.p50_ms) + log_err(p.p95_ms, m.p95_ms) + log_err(p.p99_ms, m.p99_ms);
        l += 2.0 * log_err(p.ok_rps, Some(m.ok_rps));
        let de = p.error_rate - m.error_rate;
        l += 20.0 * de * de;
    }
    for o in obs {
        let li = nearest_level(levels, o.level_rps);
        let p = &preds[li];
        let v = match o.metric {
            ObservedMetric::Utilization => p.node_utilization[o.node],
            ObservedMetric::InFlight => p.node_in_flight[o.node],
            ObservedMetric::LagMs => p.node_lag_ms[o.node],
        };
        // CPU utilization is a direct, low-noise measurement: weigh it more
        // than any single percentile so it can break latency ambiguities
        // (queueing vs. pauses produce the same p99).
        l += match o.metric {
            ObservedMetric::Utilization => 4.0 * log_err(v, Some(o.value)),
            _ => log_err(v, Some(o.value)),
        };
    }
    l
}

fn nearest_level(levels: &[Measurement], rps: f64) -> usize {
    levels
        .iter()
        .enumerate()
        .min_by(|a, b| {
            (a.1.offered_rps - rps)
                .abs()
                .total_cmp(&(b.1.offered_rps - rps).abs())
        })
        .map(|(i, _)| i)
        .unwrap_or(0)
}

// ---------------------------------------------------------------- optimizer

struct Space<'a> {
    params: &'a [FitParam],
}

impl Space<'_> {
    fn to_value(&self, i: usize, u: f64) -> f64 {
        let p = &self.params[i];
        let (a, b) = (libm::log(p.min), libm::log(p.max));
        let v = libm::exp(a + u.clamp(0.0, 1.0) * (b - a));
        if p.target.is_integer() {
            v.round()
        } else {
            v
        }
    }
    fn to_unit(&self, i: usize, v: f64) -> f64 {
        let p = &self.params[i];
        let (a, b) = (libm::log(p.min), libm::log(p.max));
        ((libm::log(v) - a) / (b - a)).clamp(0.0, 1.0)
    }
}

/// Coordinate scan, then Nelder–Mead on the unit cube (log scale).
fn minimize(
    d: usize,
    x0: Vec<f64>,
    max_evals: usize,
    f: &mut dyn FnMut(&[f64]) -> f64,
) -> (Vec<f64>, f64) {
    let mut evals = 0usize;
    let mut eval = |x: &[f64], evals: &mut usize| {
        *evals += 1;
        f(x)
    };
    let mut best = x0;
    let mut best_f = eval(&best, &mut evals);
    // coarse scan per coordinate
    for i in 0..d {
        for k in 0..=8 {
            let mut x = best.clone();
            x[i] = k as f64 / 8.0;
            let fx = eval(&x, &mut evals);
            if fx < best_f {
                best_f = fx;
                best = x;
            }
        }
    }
    // Nelder–Mead, restarted from the best point with a smaller simplex
    // while it keeps improving (parameters are often correlated: valleys)
    for step in [0.2, 0.1, 0.05, 0.025] {
        if evals >= max_evals {
            break;
        }
        let (x, fx) = nelder_mead(
            d,
            best.clone(),
            best_f,
            step,
            max_evals,
            &mut evals,
            &mut eval,
        );
        if fx < best_f {
            best = x;
            best_f = fx;
        }
    }
    (best, best_f)
}

fn nelder_mead(
    d: usize,
    start: Vec<f64>,
    start_f: f64,
    step: f64,
    max_evals: usize,
    evals: &mut usize,
    eval: &mut dyn FnMut(&[f64], &mut usize) -> f64,
) -> (Vec<f64>, f64) {
    let mut simplex: Vec<(Vec<f64>, f64)> = vec![(start.clone(), start_f)];
    for i in 0..d {
        let mut x = start.clone();
        x[i] = if x[i] + step <= 1.0 {
            x[i] + step
        } else {
            x[i] - step
        };
        let fx = eval(&x, evals);
        simplex.push((x, fx));
    }
    let clamp = |x: Vec<f64>| x.into_iter().map(|v| v.clamp(0.0, 1.0)).collect::<Vec<_>>();
    while *evals < max_evals {
        simplex.sort_by(|a, b| a.1.total_cmp(&b.1));
        let spread = simplex.last().unwrap().1 - simplex[0].1;
        let size = simplex[1..]
            .iter()
            .map(|(x, _)| {
                x.iter()
                    .zip(&simplex[0].0)
                    .map(|(a, b)| (a - b).abs())
                    .fold(0.0, f64::max)
            })
            .fold(0.0, f64::max);
        if size < 2e-3 || spread.abs() < 1e-6 {
            break;
        }
        let centroid: Vec<f64> = (0..d)
            .map(|j| simplex[..d].iter().map(|(x, _)| x[j]).sum::<f64>() / d as f64)
            .collect();
        let worst = simplex[d].clone();
        let along = |t: f64| {
            clamp(
                centroid
                    .iter()
                    .zip(&worst.0)
                    .map(|(c, w)| c + t * (c - w))
                    .collect(),
            )
        };
        let xr = along(1.0);
        let fr = eval(&xr, evals);
        if fr < simplex[0].1 {
            let xe = along(2.0);
            let fe = eval(&xe, evals);
            simplex[d] = if fe < fr { (xe, fe) } else { (xr, fr) };
        } else if fr < simplex[d - 1].1 {
            simplex[d] = (xr, fr);
        } else {
            let xc = along(if fr < worst.1 { 0.5 } else { -0.5 });
            let fc = eval(&xc, evals);
            if fc < worst.1.min(fr) {
                simplex[d] = (xc, fc);
            } else {
                let b = simplex[0].0.clone();
                for s in simplex.iter_mut().skip(1) {
                    let x: Vec<f64> =
                        s.0.iter()
                            .zip(&b)
                            .map(|(v, bv)| bv + 0.5 * (v - bv))
                            .collect();
                    s.1 = eval(&x, evals);
                    s.0 = x;
                }
            }
        }
    }
    simplex.sort_by(|a, b| a.1.total_cmp(&b.1));
    simplex.swap_remove(0)
}

// ------------------------------------------------------------------ report

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LevelReport {
    pub measured: Measurement,
    pub before: Predicted,
    pub after: Predicted,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FittedParam {
    pub key: String,
    pub before: f64,
    pub after: f64,
    /// Multiplier (true) or absolute value (false).
    pub multiplier: bool,
    /// Hit the edge of its search range: widen it or rethink the model.
    pub at_bound: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationReport {
    pub params: Vec<FittedParam>,
    pub levels: Vec<LevelReport>,
    pub loss_before: f64,
    pub loss_after: f64,
    pub evaluations: usize,
    pub design: Design,
}

/// Pick what to fit when the user did not say: a global latency scale and
/// the capacity knob of the busiest resource at the highest load level.
pub fn default_params(
    design: &Design,
    levels: &[Measurement],
    opts: &CalibrateOptions,
) -> Result<Vec<FitParam>, String> {
    let top = levels.iter().map(|l| l.offered_rps).fold(0.0, f64::max);
    let (p, _) = predict(design, top, 10_000.0, Arrival::Uniform, opts)?;
    // capacity knob first: the coordinate scan fixes the knee, then the
    // global scale fixes latency at low load
    let mut specs = vec![];
    let node = design
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| n.kind != NodeKind::Client)
        .max_by(|a, b| p.node_utilization[a.0].total_cmp(&p.node_utilization[b.0]));
    let pool = design
        .edges
        .iter()
        .enumerate()
        .filter(|(_, e)| e.pool_size.is_some())
        .max_by(|a, b| p.pool_utilization[a.0].total_cmp(&p.pool_utilization[b.0]));
    let node_u = node.map(|(i, _)| p.node_utilization[i]).unwrap_or(0.0);
    match pool {
        Some((i, e)) if p.pool_utilization[i] > node_u => {
            specs.push(format!("{}->{}.pool", e.source, e.target))
        }
        _ => {
            if let Some((_, n)) = node {
                specs.push(match n.config.model {
                    ExecModel::Threads => format!("{}.concurrency", n.id),
                    ExecModel::Cpu => format!("{}.cpu", n.id),
                });
            }
        }
    }
    specs.push("*.latency".to_string());
    specs.iter().map(|s| parse_fit(s, design)).collect()
}

pub fn calibrate(
    design: &Design,
    levels: &[Measurement],
    params: &[FitParam],
    observations: &[Observation],
    opts: &CalibrateOptions,
) -> Result<CalibrationReport, String> {
    if levels.is_empty() {
        return Err("no measurements".into());
    }
    if params.is_empty() {
        return Err("nothing to fit".into());
    }
    let run_all = |d: &Design| -> Result<Vec<Predicted>, String> {
        levels
            .iter()
            .map(|m| predict(d, m.offered_rps, m.duration_ms, Arrival::Uniform, opts).map(|r| r.0))
            .collect()
    };
    let build = |u: &[f64]| {
        let space = Space { params };
        let mut d = design.clone();
        for (i, p) in params.iter().enumerate() {
            apply(&mut d, &p.target, space.to_value(i, u[i]));
        }
        d
    };
    let space = Space { params };
    let x0: Vec<f64> = params
        .iter()
        .enumerate()
        .map(|(i, p)| space.to_unit(i, p.init))
        .collect();
    let before = run_all(design)?;
    let loss_before = loss(levels, &before, observations);

    let mut evaluations = 0;
    let mut failure = None;
    let mut f = |u: &[f64]| -> f64 {
        evaluations += 1;
        match run_all(&build(u)) {
            Ok(p) => loss(levels, &p, observations),
            Err(e) => {
                failure.get_or_insert(e);
                f64::INFINITY
            }
        }
    };
    let (best, loss_after) = minimize(params.len(), x0, opts.max_evals, &mut f);
    if let Some(e) = failure {
        return Err(e);
    }
    let fitted = build(&best);
    let after = run_all(&fitted)?;
    Ok(CalibrationReport {
        params: params
            .iter()
            .enumerate()
            .map(|(i, p)| FittedParam {
                key: p.key.clone(),
                before: p.init,
                after: space.to_value(i, best[i]),
                multiplier: p.target.is_multiplier(),
                at_bound: best[i] <= 0.001 || best[i] >= 0.999,
            })
            .collect(),
        levels: levels
            .iter()
            .zip(before)
            .zip(after)
            .map(|((m, b), a)| LevelReport {
                measured: m.clone(),
                before: b,
                after: a,
            })
            .collect(),
        loss_before,
        loss_after,
        evaluations,
        design: fitted,
    })
}

/// Largest Poisson arrival rate the design sustains within `slo` (error
/// rate and p99), by bisection between `lo` and `hi`.
pub fn capacity(
    design: &Design,
    slo: Slo,
    lo: f64,
    hi: f64,
    opts: &CalibrateOptions,
) -> Result<f64, String> {
    let ok = |rps: f64| -> Result<bool, String> {
        let input = SimInput {
            design: design.clone(),
            scenario: Scenario {
                max_concurrent: None,
                ..scenario_for(rps, opts.max_sim_ms, Arrival::Poisson, opts, slo)
            },
        };
        let mut sim = Simulation::new(&input, false)?;
        sim.run_to_end()?;
        let s = sim.summary();
        Ok(s.error_rate <= slo.error_rate && s.p99_ms <= slo.p99_ms)
    };
    let (mut lo, mut hi) = (lo.max(1.0), hi.max(lo + 1.0));
    if !ok(lo)? {
        return Ok(0.0);
    }
    while ok(hi)? {
        lo = hi;
        hi *= 2.0;
        if hi > 1e7 {
            return Ok(lo);
        }
    }
    for _ in 0..10 {
        let mid = (lo + hi) / 2.0;
        if ok(mid)? {
            lo = mid;
        } else {
            hi = mid;
        }
        if hi - lo < lo * 0.02 {
            break;
        }
    }
    Ok(lo)
}

/// Write a k6-style summary for a simulated level (tests, demos).
pub fn synthesize_k6(
    design: &Design,
    steps: &[(f64, f64)],
    opts: &CalibrateOptions,
) -> Result<String, String> {
    let mut metrics = serde_json::Map::new();
    for &(rps, dur) in steps {
        let (_, s) = predict(
            design,
            rps,
            dur,
            Arrival::Uniform,
            &CalibrateOptions {
                max_sim_ms: dur,
                ..opts.clone()
            },
        )?;
        let tag = format!("{{scenario:rps{}_{}s}}", rps, dur / 1000.0);
        metrics.insert(
            format!("http_req_duration{tag}"),
            serde_json::json!({ "med": s.p50_ms, "p(95)": s.p95_ms, "p(99)": s.p99_ms }),
        );
        metrics.insert(
            format!("http_reqs{tag}"),
            serde_json::json!({ "count": s.total }),
        );
        metrics.insert(
            format!("http_req_failed{tag}"),
            serde_json::json!({ "value": s.error_rate }),
        );
        metrics.insert(
            format!("dropped_iterations{tag}"),
            serde_json::json!({ "count": s.dropped }),
        );
    }
    Ok(serde_json::json!({ "metrics": metrics }).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{EdgeSpec, NodeConfig, NodeSpec};

    fn design(cpu_ms: f64, db_ms: f64) -> Design {
        let mut to_db = EdgeSpec::new("api", "db", 0.5);
        to_db.pool_size = Some(10);
        Design {
            nodes: vec![
                NodeSpec {
                    id: "k6".into(),
                    kind: NodeKind::Client,
                    config: NodeConfig::default(),
                },
                NodeSpec {
                    id: "api".into(),
                    kind: NodeKind::Service,
                    config: NodeConfig {
                        model: ExecModel::Cpu,
                        cpu_lanes: 1,
                        queue_size: 0,
                        cpu_p50_ms: cpu_ms,
                        cpu_p99_ms: cpu_ms * 3.0,
                        calls_per_request: 2,
                        ..NodeConfig::default()
                    },
                },
                NodeSpec {
                    id: "db".into(),
                    kind: NodeKind::Database,
                    config: NodeConfig {
                        model: ExecModel::Cpu,
                        cpu_lanes: 4,
                        max_in_flight: 100,
                        cpu_p50_ms: db_ms / 2.0,
                        cpu_p99_ms: db_ms * 2.0,
                        io_p50_ms: db_ms / 2.0,
                        io_p99_ms: db_ms * 2.0,
                        ..NodeConfig::default()
                    },
                },
            ],
            edges: vec![EdgeSpec::new("k6", "api", 2.0), to_db],
        }
    }

    #[test]
    fn parses_step_names() {
        assert_eq!(parse_step_name("rps500_60s"), Some((500.0, 60_000.0)));
        assert_eq!(parse_step_name("rps12.5_30s"), Some((12.5, 30_000.0)));
        assert_eq!(parse_step_name("warmup"), None);
    }

    #[test]
    fn parses_a_single_level_summary_export() {
        let json = r#"{"metrics":{
            "http_req_duration":{"avg":12,"min":3,"med":10,"max":90,"p(90)":20,"p(95)":25,"p(99)":40},
            "http_reqs":{"count":6000,"rate":100},
            "iterations":{"count":6000,"rate":100},
            "dropped_iterations":{"count":600,"rate":10},
            "http_req_failed":{"passes":60,"fails":5940,"value":0.01}}}"#;
        let m = &parse_k6_summary(json, "x").unwrap()[0];
        assert!((m.duration_ms - 60_000.0).abs() < 1e-6);
        assert!((m.offered_rps - 110.0).abs() < 1e-6);
        assert!((m.ok_rps - 99.0).abs() < 1e-6);
        assert_eq!(m.p99_ms, Some(40.0));
    }

    #[test]
    fn recovers_cpu_cost_from_synthetic_k6_runs() {
        // ground truth: 3 ms of CPU per request on one Node process
        let opts = CalibrateOptions {
            max_sim_ms: 8_000.0,
            max_evals: 100,
            ..Default::default()
        };
        let truth = design(3.0, 2.0);
        let k6 = synthesize_k6(
            &truth,
            &[(60.0, 8_000.0), (200.0, 8_000.0), (300.0, 8_000.0)],
            &opts,
        )
        .unwrap();
        let levels = parse_k6_summary(&k6, "synthetic").unwrap();
        assert_eq!(levels.len(), 3);
        assert_eq!(levels[0].offered_rps, 60.0);

        // our guess was 1 ms
        let guess = design(1.0, 2.0);
        let params = default_params(&guess, &levels, &opts).unwrap();
        assert_eq!(
            params.iter().map(|p| p.key.as_str()).collect::<Vec<_>>(),
            ["api.cpu", "*.latency"]
        );
        let r = calibrate(
            &guess,
            &levels,
            &[parse_fit("api.cpu", &guess).unwrap()],
            &[],
            &opts,
        )
        .unwrap();
        let cpu = r.params[0].after;
        assert!((cpu - 3.0).abs() < 0.45, "fitted cpu multiplier = {cpu}");
        assert!(
            r.loss_after < r.loss_before / 10.0,
            "{} -> {}",
            r.loss_before,
            r.loss_after
        );

        // the automatic two-parameter fit also reproduces every level
        let r = calibrate(&guess, &levels, &params, &[], &opts).unwrap();
        for l in &r.levels {
            let (m, a) = (&l.measured, &l.after);
            assert!(
                (a.ok_rps / m.ok_rps - 1.0).abs() < 0.05,
                "{}: rps {} vs {}",
                m.name,
                a.ok_rps,
                m.ok_rps
            );
            let p99 = m.p99_ms.unwrap();
            assert!(
                (a.p99_ms / p99 - 1.0).abs() < 0.3,
                "{}: p99 {} vs {}",
                m.name,
                a.p99_ms,
                p99
            );
        }
    }

    #[test]
    fn capacity_bisection_matches_utilization_law() {
        // 1 lane, ~3.4 ms mean CPU (p50 3, p99 9) → ~290 rps saturation
        let opts = CalibrateOptions {
            max_sim_ms: 10_000.0,
            ..Default::default()
        };
        let cap = capacity(
            &design(3.0, 2.0),
            Slo {
                p99_ms: 200.0,
                error_rate: 0.01,
            },
            10.0,
            100.0,
            &opts,
        )
        .unwrap();
        assert!(cap > 200.0 && cap < 300.0, "capacity = {cap}");
    }
}
