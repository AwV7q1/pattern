//! Discrete-event simulation core.
//!
//! Model (per request):
//! 1. The client emits requests as a Poisson process following the scenario
//!    traffic phases (times a live multiplier).
//! 2. A request arriving at a node takes a concurrency slot if one is free,
//!    otherwise waits in the node's queue, otherwise is rejected.
//! 3. After local processing (lognormal latency) the node either answers or
//!    forwards the request to one downstream node while *keeping its slot*.
//!    Holding slots while waiting downstream is what produces realistic
//!    cascading failures when a dependency becomes slow.
//! 4. Responses travel back along the same edges. The client counts a
//!    request as failed if it errored or exceeded the timeout.
//! 5. `queue` nodes acknowledge immediately and process the message
//!    asynchronously with `instances * concurrency` consumers.
//!
//! Time is integer microseconds; the event heap is ordered by
//! `(time, sequence)` so simultaneous events resolve deterministically.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, VecDeque};

use serde::Serialize;

use crate::histogram::Histogram;
use crate::model::{NodeKind, SimInput, Slo};
use crate::rng::Rng;

pub type Time = u64; // microseconds

const Z99: f64 = 2.326_347_874; // z-score of the 99th percentile
const MAX_LATENCY_US: f64 = 60_000_000.0;
const MAX_PENDING_PARTICLE_FLOATS: usize = 4 * 500_000;
/// Particle kinds, written into the particle stream.
pub const PARTICLE_REQUEST: f32 = 0.0;
pub const PARTICLE_RESPONSE_OK: f32 = 1.0;
pub const PARTICLE_RESPONSE_ERR: f32 = 2.0;

fn ms_to_us(v: f64) -> Time {
    (v * 1000.0).max(0.0).round() as Time
}

fn us_to_ms(v: f64) -> f64 {
    v / 1000.0
}

#[derive(Clone, Copy, Debug)]
enum Ev {
    ClientArrival,
    Arrive { req: u32, node: u32 },
    LocalDone { req: u32, node: u32 },
    Respond { req: u32, node: u32, ok: bool },
}

struct Scheduled {
    t: Time,
    seq: u64,
    ev: Ev,
}

impl PartialEq for Scheduled {
    fn eq(&self, other: &Self) -> bool {
        self.t == other.t && self.seq == other.seq
    }
}
impl Eq for Scheduled {}
impl PartialOrd for Scheduled {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Scheduled {
    // Reversed so BinaryHeap (a max-heap) pops the earliest event first.
    fn cmp(&self, other: &Self) -> Ordering {
        other.t.cmp(&self.t).then_with(|| other.seq.cmp(&self.seq))
    }
}

struct NodeRt {
    kind: NodeKind,
    capacity: u32,
    busy: u32,
    queue: VecDeque<u32>,
    queue_cap: usize,
    mu: f64,
    sigma: f64,
    error_rate: f64,
    hit_rate: f64,
    down: bool,
    out: Vec<u32>,
    rr: usize,
    // window accounting
    busy_area: f64,
    last_change: Time,
    rejected: u64,
}

impl NodeRt {
    fn account(&mut self, now: Time) {
        self.busy_area += self.busy as f64 * now.saturating_sub(self.last_change) as f64;
        self.last_change = now;
    }
}

struct EdgeRt {
    to: u32,
    latency: Time,
}

#[derive(Default)]
struct Req {
    start: Time,
    /// Return path: (node to respond to, edge used to get here).
    stack: Vec<(u32, u32)>,
}

#[derive(Default)]
struct Acc {
    ok: u64,
    err: u64,
    timeouts: u64,
    async_ok: u64,
    async_err: u64,
    hist: Histogram,
}

impl Acc {
    fn clear(&mut self) {
        self.ok = 0;
        self.err = 0;
        self.timeouts = 0;
        self.async_ok = 0;
        self.async_err = 0;
        self.hist.clear();
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodeWindow {
    /// Time-weighted fraction of busy slots during the window (0..1).
    pub utilization: f64,
    /// Queue length at the end of the window.
    pub queue: usize,
    pub rejected: u64,
    pub down: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowMetrics {
    /// End of the window, in ms of simulated time.
    pub t_ms: f64,
    pub rps: f64,
    pub error_rps: f64,
    pub ok_count: u64,
    pub error_count: u64,
    pub timeout_count: u64,
    pub async_ok: u64,
    pub async_err: u64,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
    pub slo_ok: bool,
    /// Same order as `design.nodes`.
    pub nodes: Vec<NodeWindow>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub duration_ms: f64,
    pub total: u64,
    pub ok: u64,
    pub errors: u64,
    pub timeouts: u64,
    pub async_ok: u64,
    pub async_err: u64,
    pub error_rate: f64,
    pub throughput_rps: f64,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
    pub cost_per_hour: f64,
    pub slo: Slo,
    pub slo_pass: bool,
}

pub struct Simulation {
    now: Time,
    seq: u64,
    heap: BinaryHeap<Scheduled>,
    rng: Rng,
    nodes: Vec<NodeRt>,
    edges: Vec<EdgeRt>,
    reqs: Vec<Req>,
    free: Vec<u32>,
    client: u32,
    traffic: Vec<(Time, f64)>,
    multiplier: f64,
    timeout: Time,
    slo: Slo,
    window: Time,
    window_start: Time,
    duration: Option<Time>,
    cost_per_hour: f64,
    win: Acc,
    total: Acc,
    windows_out: Vec<WindowMetrics>,
    emit_particles: bool,
    particles: Vec<f32>,
}

impl Simulation {
    pub fn new(input: &SimInput, emit_particles: bool) -> Result<Self, String> {
        let design = &input.design;
        let sc = &input.scenario;

        let mut index: HashMap<&str, u32> = HashMap::new();
        for (i, n) in design.nodes.iter().enumerate() {
            if index.insert(n.id.as_str(), i as u32).is_some() {
                return Err(format!("duplicate node id '{}'", n.id));
            }
        }
        let clients: Vec<u32> = design
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.kind == NodeKind::Client)
            .map(|(i, _)| i as u32)
            .collect();
        if clients.len() != 1 {
            return Err(format!(
                "design needs exactly one client node, found {}",
                clients.len()
            ));
        }
        let client = clients[0];

        let mut cost_per_hour = 0.0;
        let mut nodes: Vec<NodeRt> = design
            .nodes
            .iter()
            .map(|n| {
                let c = &n.config;
                let p50 = (c.latency_p50_ms * 1000.0).max(1.0);
                let p99 = (c.latency_p99_ms * 1000.0).max(p50);
                let instances = c.instances.max(1);
                cost_per_hour += c.cost_per_hour * instances as f64;
                NodeRt {
                    kind: n.kind,
                    capacity: if n.kind == NodeKind::Client {
                        0
                    } else {
                        instances * c.concurrency.max(1)
                    },
                    busy: 0,
                    queue: VecDeque::new(),
                    queue_cap: (instances * c.queue_size) as usize,
                    mu: libm::log(p50),
                    sigma: (libm::log(p99) - libm::log(p50)) / Z99,
                    error_rate: c.error_rate.clamp(0.0, 1.0),
                    hit_rate: c.hit_rate.clamp(0.0, 1.0),
                    down: false,
                    out: Vec::new(),
                    rr: 0,
                    busy_area: 0.0,
                    last_change: 0,
                    rejected: 0,
                }
            })
            .collect();

        let mut edges = Vec::with_capacity(design.edges.len());
        for (i, e) in design.edges.iter().enumerate() {
            let from = *index
                .get(e.source.as_str())
                .ok_or_else(|| format!("edge {i}: unknown source '{}'", e.source))?;
            let to = *index
                .get(e.target.as_str())
                .ok_or_else(|| format!("edge {i}: unknown target '{}'", e.target))?;
            if to == client {
                return Err(format!("edge {i}: the client cannot be an edge target"));
            }
            nodes[from as usize].out.push(i as u32);
            edges.push(EdgeRt {
                to,
                latency: ms_to_us(e.latency_ms),
            });
        }
        if nodes[client as usize].out.is_empty() {
            return Err("the client node has no outgoing edge".into());
        }

        let mut traffic: Vec<(Time, f64)> = sc
            .traffic
            .iter()
            .map(|p| (ms_to_us(p.at_ms), p.rps.max(0.0)))
            .collect();
        traffic.sort_by_key(|p| p.0);

        let mut sim = Simulation {
            now: 0,
            seq: 0,
            heap: BinaryHeap::new(),
            rng: Rng::new(sc.seed),
            nodes,
            edges,
            reqs: Vec::new(),
            free: Vec::new(),
            client,
            traffic,
            multiplier: 1.0,
            timeout: ms_to_us(sc.timeout_ms),
            slo: sc.slo,
            window: ms_to_us(sc.window_ms).max(1000),
            window_start: 0,
            duration: sc.duration_ms.map(ms_to_us),
            cost_per_hour,
            win: Acc::default(),
            total: Acc::default(),
            windows_out: Vec::new(),
            emit_particles,
            particles: Vec::new(),
        };
        sim.schedule(0, Ev::ClientArrival);
        Ok(sim)
    }

    // ---------------------------------------------------------------- public API

    pub fn now_ms(&self) -> f64 {
        us_to_ms(self.now as f64)
    }

    /// Advance simulated time up to `until_ms`, processing every event due.
    pub fn step(&mut self, until_ms: f64) {
        let until = ms_to_us(until_ms);
        while let Some(top) = self.heap.peek() {
            if top.t > until {
                break;
            }
            let s = self.heap.pop().expect("peeked");
            self.flush_windows(s.t);
            self.now = s.t;
            self.handle(s.ev);
        }
        self.flush_windows(until);
        self.now = self.now.max(until);
    }

    pub fn run_to_end(&mut self) -> Result<(), String> {
        let end = self
            .duration
            .ok_or("scenario.durationMs is required for headless runs")?;
        self.step(us_to_ms(end as f64));
        Ok(())
    }

    /// Replace the traffic schedule with a constant rate.
    pub fn set_rps(&mut self, rps: f64) {
        self.traffic = vec![(0, rps.max(0.0))];
    }

    pub fn set_traffic_multiplier(&mut self, m: f64) {
        self.multiplier = m.max(0.0);
    }

    /// Chaos: take a node down (fail fast) or bring it back.
    pub fn set_node_down(&mut self, node: usize, down: bool) -> Result<(), String> {
        let n = self.nodes.get_mut(node).ok_or("node index out of range")?;
        if n.kind == NodeKind::Client {
            return Err("the client cannot be taken down".into());
        }
        n.down = down;
        if down {
            let drained: Vec<u32> = n.queue.drain(..).collect();
            n.rejected += drained.len() as u64;
            for req in drained {
                self.respond_up(req, false);
            }
        }
        Ok(())
    }

    /// Particle events since the last call, 4 floats each:
    /// `[edge index, start time (s), duration (s), kind]`.
    pub fn take_particles(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.particles)
    }

    pub fn take_windows(&mut self) -> Vec<WindowMetrics> {
        std::mem::take(&mut self.windows_out)
    }

    pub fn summary(&self) -> Summary {
        let t = &self.total;
        let total = t.ok + t.err;
        let error_rate = if total > 0 {
            t.err as f64 / total as f64
        } else {
            0.0
        };
        let p99_ms = us_to_ms(t.hist.percentile(0.99));
        let secs = self.now as f64 / 1e6;
        Summary {
            duration_ms: self.now_ms(),
            total,
            ok: t.ok,
            errors: t.err,
            timeouts: t.timeouts,
            async_ok: t.async_ok,
            async_err: t.async_err,
            error_rate,
            throughput_rps: if secs > 0.0 { t.ok as f64 / secs } else { 0.0 },
            p50_ms: us_to_ms(t.hist.percentile(0.5)),
            p95_ms: us_to_ms(t.hist.percentile(0.95)),
            p99_ms,
            cost_per_hour: self.cost_per_hour,
            slo: self.slo,
            slo_pass: total > 0 && p99_ms <= self.slo.p99_ms && error_rate <= self.slo.error_rate,
        }
    }

    // ---------------------------------------------------------------- internals

    fn schedule(&mut self, t: Time, ev: Ev) {
        self.seq += 1;
        self.heap.push(Scheduled {
            t,
            seq: self.seq,
            ev,
        });
    }

    fn current_rps(&self) -> f64 {
        let base = self
            .traffic
            .iter()
            .take_while(|(at, _)| *at <= self.now)
            .last()
            .map(|p| p.1)
            .unwrap_or(0.0);
        base * self.multiplier
    }

    fn emit(&mut self, edge: u32, latency: Time, kind: f32) {
        if self.emit_particles && self.particles.len() < MAX_PENDING_PARTICLE_FLOATS {
            self.particles.extend_from_slice(&[
                edge as f32,
                (self.now as f64 / 1e6) as f32,
                (latency as f64 / 1e6) as f32,
                kind,
            ]);
        }
    }

    fn alloc_req(&mut self) -> u32 {
        let id = match self.free.pop() {
            Some(id) => id,
            None => {
                self.reqs.push(Req::default());
                (self.reqs.len() - 1) as u32
            }
        };
        let r = &mut self.reqs[id as usize];
        r.start = self.now;
        r.stack.clear();
        id
    }

    fn sample_latency(&mut self, node: u32) -> Time {
        let n = &self.nodes[node as usize];
        let (mu, sigma) = (n.mu, n.sigma);
        let v = if sigma <= 0.0 {
            libm::exp(mu)
        } else {
            self.rng.lognormal(mu, sigma)
        };
        v.clamp(1.0, MAX_LATENCY_US) as Time
    }

    fn handle(&mut self, ev: Ev) {
        match ev {
            Ev::ClientArrival => self.on_client_arrival(),
            Ev::Arrive { req, node } => self.on_arrive(req, node),
            Ev::LocalDone { req, node } => self.on_local_done(req, node),
            Ev::Respond { req, node, ok } => {
                if node == self.client {
                    self.complete(req, ok);
                } else {
                    self.finish(req, node, ok);
                }
            }
        }
    }

    fn on_client_arrival(&mut self) {
        let rps = self.current_rps();
        if rps > 0.0 {
            let req = self.alloc_req();
            self.forward(req, self.client);
            let gap = (self.rng.exp(rps) * 1e6).max(1.0) as Time;
            self.schedule(self.now + gap, Ev::ClientArrival);
        } else {
            // idle: poll for traffic changes
            self.schedule(self.now + 100_000, Ev::ClientArrival);
        }
    }

    fn on_arrive(&mut self, req: u32, node: u32) {
        let n = &mut self.nodes[node as usize];
        let has_room = n.busy < n.capacity || n.queue.len() < n.queue_cap;
        if n.down || !has_room {
            n.rejected += 1;
            self.respond_up(req, false);
            return;
        }
        let req = if n.kind == NodeKind::Queue {
            // Acknowledge the producer right away and continue the work as an
            // independent async message.
            self.respond_up(req, true);
            self.alloc_req()
        } else {
            req
        };
        let n = &mut self.nodes[node as usize];
        if n.busy < n.capacity {
            n.account(self.now);
            n.busy += 1;
            self.start(req, node);
        } else {
            n.queue.push_back(req);
        }
    }

    fn start(&mut self, req: u32, node: u32) {
        let lat = self.sample_latency(node);
        self.schedule(self.now + lat, Ev::LocalDone { req, node });
    }

    fn on_local_done(&mut self, req: u32, node: u32) {
        let (down, error_rate, kind, hit_rate) = {
            let n = &self.nodes[node as usize];
            (n.down, n.error_rate, n.kind, n.hit_rate)
        };
        if down || (error_rate > 0.0 && self.rng.f64() < error_rate) {
            self.finish(req, node, false);
            return;
        }
        if kind == NodeKind::Cache && self.rng.f64() < hit_rate {
            self.finish(req, node, true);
            return;
        }
        if !self.forward(req, node) {
            self.finish(req, node, true);
        }
    }

    /// Send `req` from `from` to its next downstream node (round-robin).
    /// Returns false if `from` has no outgoing edge.
    fn forward(&mut self, req: u32, from: u32) -> bool {
        let n = &mut self.nodes[from as usize];
        if n.out.is_empty() {
            return false;
        }
        let edge = n.out[n.rr % n.out.len()];
        n.rr = n.rr.wrapping_add(1);
        let (to, lat) = {
            let e = &self.edges[edge as usize];
            (e.to, e.latency)
        };
        self.reqs[req as usize].stack.push((from, edge));
        self.schedule(self.now + lat, Ev::Arrive { req, node: to });
        self.emit(edge, lat, PARTICLE_REQUEST);
        true
    }

    /// Release `node`'s slot held by `req` and send the response upstream.
    fn finish(&mut self, req: u32, node: u32, ok: bool) {
        let n = &mut self.nodes[node as usize];
        if let Some(next) = n.queue.pop_front() {
            // slot handed directly to the next waiting request
            self.start(next, node);
        } else {
            n.account(self.now);
            n.busy -= 1;
        }
        self.respond_up(req, ok);
    }

    fn respond_up(&mut self, req: u32, ok: bool) {
        match self.reqs[req as usize].stack.pop() {
            Some((parent, edge)) => {
                let lat = self.edges[edge as usize].latency;
                self.schedule(
                    self.now + lat,
                    Ev::Respond {
                        req,
                        node: parent,
                        ok,
                    },
                );
                self.emit(
                    edge,
                    lat,
                    if ok {
                        PARTICLE_RESPONSE_OK
                    } else {
                        PARTICLE_RESPONSE_ERR
                    },
                );
            }
            None => {
                // async message (spawned by a queue node) fully processed
                for acc in [&mut self.win, &mut self.total] {
                    if ok {
                        acc.async_ok += 1;
                    } else {
                        acc.async_err += 1;
                    }
                }
                self.free.push(req);
            }
        }
    }

    fn complete(&mut self, req: u32, ok: bool) {
        let latency = self.now - self.reqs[req as usize].start;
        let timed_out = latency > self.timeout;
        let ok = ok && !timed_out;
        let recorded = latency.min(self.timeout);
        for acc in [&mut self.win, &mut self.total] {
            if ok {
                acc.ok += 1;
            } else {
                acc.err += 1;
            }
            if timed_out {
                acc.timeouts += 1;
            }
            acc.hist.record(recorded);
        }
        self.free.push(req);
    }

    fn flush_windows(&mut self, t: Time) {
        while t >= self.window_start + self.window {
            let end = self.window_start + self.window;
            let secs = self.window as f64 / 1e6;
            let nodes = self
                .nodes
                .iter_mut()
                .map(|n| {
                    n.account(end);
                    let utilization = if n.capacity > 0 {
                        (n.busy_area / (n.capacity as f64 * self.window as f64)).min(1.0)
                    } else {
                        0.0
                    };
                    let w = NodeWindow {
                        utilization,
                        queue: n.queue.len(),
                        rejected: n.rejected,
                        down: n.down,
                    };
                    n.busy_area = 0.0;
                    n.rejected = 0;
                    w
                })
                .collect();
            let w = &self.win;
            let count = w.ok + w.err;
            let err_rate = if count > 0 {
                w.err as f64 / count as f64
            } else {
                0.0
            };
            let p99_ms = us_to_ms(w.hist.percentile(0.99));
            self.windows_out.push(WindowMetrics {
                t_ms: us_to_ms(end as f64),
                rps: w.ok as f64 / secs,
                error_rps: w.err as f64 / secs,
                ok_count: w.ok,
                error_count: w.err,
                timeout_count: w.timeouts,
                async_ok: w.async_ok,
                async_err: w.async_err,
                p50_ms: us_to_ms(w.hist.percentile(0.5)),
                p95_ms: us_to_ms(w.hist.percentile(0.95)),
                p99_ms,
                slo_ok: count == 0
                    || (p99_ms <= self.slo.p99_ms && err_rate <= self.slo.error_rate),
                nodes,
            });
            self.win.clear();
            self.window_start = end;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    fn node(id: &str, kind: NodeKind, config: NodeConfig) -> NodeSpec {
        NodeSpec {
            id: id.into(),
            kind,
            config,
        }
    }

    fn edge(s: &str, t: &str) -> EdgeSpec {
        EdgeSpec {
            source: s.into(),
            target: t.into(),
            latency_ms: 1.0,
        }
    }

    fn scenario(rps: f64, duration_ms: f64) -> Scenario {
        Scenario {
            seed: 1,
            duration_ms: Some(duration_ms),
            timeout_ms: 2000.0,
            traffic: vec![TrafficPhase { at_ms: 0.0, rps }],
            slo: Slo::default(),
            window_ms: 1000.0,
        }
    }

    fn single_service(rps: f64, concurrency: u32, latency_ms: f64) -> SimInput {
        SimInput {
            design: Design {
                nodes: vec![
                    node("c", NodeKind::Client, NodeConfig::default()),
                    node(
                        "svc",
                        NodeKind::Service,
                        NodeConfig {
                            concurrency,
                            queue_size: 50,
                            latency_p50_ms: latency_ms,
                            latency_p99_ms: latency_ms,
                            ..NodeConfig::default()
                        },
                    ),
                ],
                edges: vec![edge("c", "svc")],
            },
            scenario: scenario(rps, 20_000.0),
        }
    }

    fn run(input: &SimInput) -> Summary {
        let mut sim = Simulation::new(input, false).unwrap();
        sim.run_to_end().unwrap();
        sim.summary()
    }

    #[test]
    fn deterministic_for_same_seed() {
        let input = single_service(500.0, 10, 15.0);
        assert_eq!(run(&input), run(&input));
    }

    #[test]
    fn low_load_latency_is_network_plus_processing() {
        let s = run(&single_service(10.0, 100, 10.0));
        // 1 ms there + 10 ms processing + 1 ms back
        assert!((s.p50_ms - 12.0).abs() < 0.3, "p50 = {}", s.p50_ms);
        assert_eq!(s.errors, 0);
    }

    #[test]
    fn overload_produces_errors() {
        // capacity = 10 slots / 100 ms = 100 rps; offered 500 rps
        let s = run(&single_service(500.0, 10, 100.0));
        assert!(s.error_rate > 0.7, "error_rate = {}", s.error_rate);
        assert!(
            (s.throughput_rps - 100.0).abs() < 10.0,
            "throughput = {}",
            s.throughput_rps
        );
    }

    #[test]
    fn node_down_fails_fast() {
        let input = single_service(100.0, 100, 10.0);
        let mut sim = Simulation::new(&input, false).unwrap();
        sim.set_node_down(1, true).unwrap();
        sim.step(5_000.0);
        let s = sim.summary();
        assert_eq!(s.ok, 0);
        assert!(s.errors > 0);
        assert!(
            s.p99_ms < 5.0,
            "failures should be fast, p99 = {}",
            s.p99_ms
        );
    }

    #[test]
    fn slow_dependency_cascades_upstream() {
        // API holds its slot while waiting for the DB, so a slow DB exhausts
        // the API's concurrency even though the API itself is fast.
        let db = |p50: f64| NodeConfig {
            concurrency: 1000,
            latency_p50_ms: p50,
            latency_p99_ms: p50,
            ..NodeConfig::default()
        };
        let mk = |db_latency: f64| SimInput {
            design: Design {
                nodes: vec![
                    node("c", NodeKind::Client, NodeConfig::default()),
                    node(
                        "api",
                        NodeKind::Service,
                        NodeConfig {
                            concurrency: 50,
                            queue_size: 10,
                            latency_p50_ms: 2.0,
                            latency_p99_ms: 2.0,
                            ..NodeConfig::default()
                        },
                    ),
                    node("db", NodeKind::Database, db(db_latency)),
                ],
                edges: vec![edge("c", "api"), edge("api", "db")],
            },
            scenario: scenario(1000.0, 10_000.0),
        };
        let healthy = run(&mk(5.0)); // api needs ~1000 * 9 ms = 9 slots
        let slow = run(&mk(200.0)); // api needs ~1000 * 204 ms = 204 slots > 50
        assert!(
            healthy.error_rate < 0.001,
            "healthy = {}",
            healthy.error_rate
        );
        assert!(slow.error_rate > 0.5, "slow = {}", slow.error_rate);
    }

    #[test]
    fn queue_acknowledges_fast_and_levels_load() {
        let input = SimInput {
            design: Design {
                nodes: vec![
                    node("c", NodeKind::Client, NodeConfig::default()),
                    node(
                        "q",
                        NodeKind::Queue,
                        NodeConfig {
                            concurrency: 5,
                            queue_size: 1_000_000,
                            latency_p50_ms: 0.1,
                            latency_p99_ms: 0.1,
                            ..NodeConfig::default()
                        },
                    ),
                    node(
                        "worker",
                        NodeKind::Service,
                        NodeConfig {
                            concurrency: 100,
                            latency_p50_ms: 50.0,
                            latency_p99_ms: 50.0,
                            ..NodeConfig::default()
                        },
                    ),
                ],
                edges: vec![edge("c", "q"), edge("q", "worker")],
            },
            scenario: scenario(200.0, 10_000.0),
        };
        let s = run(&input);
        assert_eq!(s.errors, 0);
        assert!(
            s.p99_ms < 3.0,
            "producer only waits for the ack, p99 = {}",
            s.p99_ms
        );
        // 5 consumers * (1 / ~52 ms) ≈ 96 msg/s drained, the rest piles up
        assert!(
            s.async_ok > 800 && s.async_ok < 1100,
            "async_ok = {}",
            s.async_ok
        );
    }

    #[test]
    fn rejects_invalid_designs() {
        let mut input = single_service(10.0, 1, 1.0);
        input.design.edges.push(edge("svc", "nope"));
        assert!(Simulation::new(&input, false).is_err());
    }
}
