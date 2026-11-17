//! Discrete-event simulation core.
//!
//! Model:
//! 1. The client emits user requests as a Poisson process following the
//!    scenario traffic phases (times a live multiplier).
//! 2. Every hop is a *call*. A call arriving at a node takes a concurrency
//!    slot if one is free, otherwise waits in the node's queue, otherwise is
//!    rejected.
//! 3. After local processing (lognormal latency) the node either answers or
//!    makes one downstream call (round-robin over its edges) while *keeping
//!    its slot*. Holding slots while waiting is what produces cascading
//!    failures when a dependency becomes slow.
//! 4. The caller side of each edge applies its policy: timeout (the callee
//!    keeps working, so wasted work piles up), retries with exponential
//!    backoff, and a circuit breaker that fails fast while open.
//! 5. `queue` nodes acknowledge immediately and process the message
//!    asynchronously with `instances * concurrency` consumers.
//! 6. Scripted chaos events (node down/up, slowdown, error bursts) fire at
//!    fixed simulated times.
//!
//! Time is integer microseconds; the event heap is ordered by
//! `(time, sequence)` so simultaneous events resolve deterministically.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, VecDeque};

use serde::Serialize;

use crate::histogram::Histogram;
use crate::model::{ChaosAction, CircuitBreaker, NodeKind, SimInput, Slo};
use crate::rng::Rng;

pub type Time = u64; // microseconds

const Z99: f64 = 2.326_347_874; // z-score of the 99th percentile
const MAX_LATENCY_US: f64 = 60_000_000.0;
const MAX_PENDING_PARTICLE_FLOATS: usize = 4 * 500_000;
const NO_EDGE: u32 = u32::MAX;
/// Particle kinds, written into the particle stream.
pub const PARTICLE_REQUEST: f32 = 0.0;
pub const PARTICLE_RESPONSE_OK: f32 = 1.0;
pub const PARTICLE_RESPONSE_ERR: f32 = 2.0;
pub const PARTICLE_RETRY: f32 = 3.0;

fn ms_to_us(v: f64) -> Time {
    (v * 1000.0).max(0.0).round() as Time
}

fn us_to_ms(v: f64) -> f64 {
    v / 1000.0
}

#[derive(Clone, Copy, Debug)]
enum Ev {
    ClientArrival,
    /// A call reaches its target node.
    Arrive {
        call: u32,
        gen: u32,
    },
    LocalDone {
        call: u32,
        gen: u32,
    },
    /// The response of child `token` reaches caller `call`.
    Response {
        call: u32,
        gen: u32,
        token: u64,
        ok: bool,
    },
    Timeout {
        call: u32,
        gen: u32,
        token: u64,
    },
    Retry {
        call: u32,
        gen: u32,
    },
    Chaos {
        index: u32,
    },
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
    base_error_rate: f64,
    error_rate: f64,
    latency_factor: f64,
    hit_rate: f64,
    down: bool,
    out: Vec<u32>,
    rr: usize,
    // window accounting
    busy_area: f64,
    last_change: Time,
    rejected: u64,
    arrivals: u64,
}

impl NodeRt {
    fn account(&mut self, now: Time) {
        self.busy_area += self.busy as f64 * now.saturating_sub(self.last_change) as f64;
        self.last_change = now;
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum CbState {
    Closed,
    Open { until: Time },
    HalfOpen { probing: bool },
}

struct Breaker {
    cfg: CircuitBreaker,
    state: CbState,
    window_start: Time,
    calls: u32,
    failures: u32,
}

struct EdgeRt {
    to: u32,
    latency: Time,
    timeout: Option<Time>,
    retries: u32,
    backoff: Time,
    jitter: bool,
    breaker: Option<Breaker>,
    // window accounting
    w_calls: u64,
    w_retries: u64,
    w_timeouts: u64,
    w_short_circuits: u64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Parent {
    /// Root call of a user request, owned by the client.
    User,
    /// Async message spawned by a queue node.
    Async,
    Call {
        id: u32,
        gen: u32,
    },
}

struct Call {
    gen: u32,
    node: u32,
    parent: Parent,
    /// Edge used to reach `node` (`NO_EDGE` for roots).
    edge: u32,
    /// Token the parent is waiting for.
    token: u64,
    /// Start of the user request / async message.
    start: Time,
    /// Retries spent on the current downstream hop.
    attempt: u32,
    /// Token of the outstanding child call, 0 if none.
    waiting: u64,
    out_edge: u32,
    last_timeout: bool,
}

#[derive(Default)]
struct Acc {
    ok: u64,
    err: u64,
    timeouts: u64,
    async_ok: u64,
    async_err: u64,
    retries: u64,
    hist: Histogram,
}

impl Acc {
    fn clear(&mut self) {
        self.ok = 0;
        self.err = 0;
        self.timeouts = 0;
        self.async_ok = 0;
        self.async_err = 0;
        self.retries = 0;
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
    /// Calls arriving per second (including retries).
    pub arrivals: f64,
    pub rejected: u64,
    pub down: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EdgeWindow {
    /// Calls sent per second (including retries).
    pub calls: f64,
    pub retries: u64,
    pub timeouts: u64,
    /// Calls rejected locally by an open breaker.
    pub short_circuits: u64,
    /// `closed`, `open` or `halfOpen` at the end of the window.
    pub breaker: &'static str,
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
    pub retries: u64,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
    pub slo_ok: bool,
    /// Same order as `design.nodes`.
    pub nodes: Vec<NodeWindow>,
    /// Same order as `design.edges`.
    pub edges: Vec<EdgeWindow>,
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
    pub retries: u64,
    pub error_rate: f64,
    pub throughput_rps: f64,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
    pub cost_per_hour: f64,
    pub slo: Slo,
    pub slo_pass: bool,
    /// Fraction of windows (with traffic) meeting the SLO.
    pub slo_window_ratio: f64,
    pub budget_per_hour: Option<f64>,
    /// Async messages still waiting in queue nodes at the end of the run.
    pub backlog: u64,
    /// Game rating 0..3, see [`Summary::rate`].
    pub stars: u8,
}

impl Summary {
    /// ★ SLO met over the whole run, ★★ and within budget (if any),
    /// ★★★ and at least 98% of windows met the SLO (survived the chaos) with
    /// no async backlog left over.
    fn rate(&mut self) {
        let within_budget = self
            .budget_per_hour
            .is_none_or(|b| self.cost_per_hour <= b + 1e-9);
        let resilient = self.slo_window_ratio >= 0.98 && self.backlog == 0;
        self.stars = match (self.slo_pass, within_budget, resilient) {
            (true, true, true) => 3,
            (true, true, false) => 2,
            (true, false, _) => 1,
            _ => 0,
        };
    }
}

struct ChaosRt {
    at: Time,
    node: u32,
    action: ChaosAction,
    value: f64,
}

pub struct Simulation {
    now: Time,
    seq: u64,
    heap: BinaryHeap<Scheduled>,
    rng: Rng,
    nodes: Vec<NodeRt>,
    edges: Vec<EdgeRt>,
    calls: Vec<Call>,
    free: Vec<u32>,
    next_token: u64,
    client: u32,
    traffic: Vec<(Time, f64)>,
    multiplier: f64,
    slo: Slo,
    budget: Option<f64>,
    window: Time,
    window_start: Time,
    windows_with_traffic: u64,
    windows_slo_ok: u64,
    duration: Option<Time>,
    cost_per_hour: f64,
    chaos: Vec<ChaosRt>,
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
                if n.kind != NodeKind::Client {
                    cost_per_hour += c.cost_per_hour * instances as f64;
                }
                let error_rate = c.error_rate.clamp(0.0, 1.0);
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
                    base_error_rate: error_rate,
                    error_rate,
                    latency_factor: 1.0,
                    hit_rate: c.hit_rate.clamp(0.0, 1.0),
                    down: false,
                    out: Vec::new(),
                    rr: 0,
                    busy_area: 0.0,
                    last_change: 0,
                    rejected: 0,
                    arrivals: 0,
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
            if to == from {
                return Err(format!("edge {i}: a node cannot call itself"));
            }
            nodes[from as usize].out.push(i as u32);
            let timeout = match e.timeout_ms {
                Some(t) if t > 0.0 => Some(ms_to_us(t)),
                Some(_) => None,
                None if from == client => Some(ms_to_us(sc.timeout_ms)),
                None => None,
            };
            edges.push(EdgeRt {
                to,
                latency: ms_to_us(e.latency_ms),
                timeout,
                retries: e.retries.min(10),
                backoff: ms_to_us(e.backoff_ms),
                jitter: e.jitter,
                breaker: e.circuit_breaker.map(|cfg| Breaker {
                    cfg,
                    state: CbState::Closed,
                    window_start: 0,
                    calls: 0,
                    failures: 0,
                }),
                w_calls: 0,
                w_retries: 0,
                w_timeouts: 0,
                w_short_circuits: 0,
            });
        }
        if nodes[client as usize].out.is_empty() {
            return Err("the client node has no outgoing edge".into());
        }
        check_acyclic(&nodes, &edges, design)?;

        let mut traffic: Vec<(Time, f64)> = sc
            .traffic
            .iter()
            .map(|p| (ms_to_us(p.at_ms), p.rps.max(0.0)))
            .collect();
        traffic.sort_by_key(|p| p.0);

        let mut chaos = Vec::with_capacity(sc.events.len());
        for (i, ev) in sc.events.iter().enumerate() {
            let node = *index
                .get(ev.node.as_str())
                .ok_or_else(|| format!("event {i}: unknown node '{}'", ev.node))?;
            if node == client {
                return Err(format!("event {i}: chaos cannot target the client"));
            }
            chaos.push(ChaosRt {
                at: ms_to_us(ev.at_ms),
                node,
                action: ev.action,
                value: ev.value,
            });
        }

        let mut sim = Simulation {
            now: 0,
            seq: 0,
            heap: BinaryHeap::new(),
            rng: Rng::new(sc.seed),
            nodes,
            edges,
            calls: Vec::new(),
            free: Vec::new(),
            next_token: 0,
            client,
            traffic,
            multiplier: 1.0,
            slo: sc.slo,
            budget: sc.budget_per_hour,
            window: ms_to_us(sc.window_ms).max(1000),
            window_start: 0,
            windows_with_traffic: 0,
            windows_slo_ok: 0,
            duration: sc.duration_ms.map(ms_to_us),
            cost_per_hour,
            chaos,
            win: Acc::default(),
            total: Acc::default(),
            windows_out: Vec::new(),
            emit_particles,
            particles: Vec::new(),
        };
        for i in 0..sim.chaos.len() {
            let at = sim.chaos[i].at;
            sim.schedule(at, Ev::Chaos { index: i as u32 });
        }
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
            for call in drained {
                self.settle(call, false);
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
        let mut s = Summary {
            duration_ms: self.now_ms(),
            total,
            ok: t.ok,
            errors: t.err,
            timeouts: t.timeouts,
            async_ok: t.async_ok,
            async_err: t.async_err,
            retries: t.retries,
            error_rate,
            throughput_rps: if secs > 0.0 { t.ok as f64 / secs } else { 0.0 },
            p50_ms: us_to_ms(t.hist.percentile(0.5)),
            p95_ms: us_to_ms(t.hist.percentile(0.95)),
            p99_ms,
            cost_per_hour: self.cost_per_hour,
            slo: self.slo,
            slo_pass: total > 0 && p99_ms <= self.slo.p99_ms && error_rate <= self.slo.error_rate,
            slo_window_ratio: if self.windows_with_traffic > 0 {
                self.windows_slo_ok as f64 / self.windows_with_traffic as f64
            } else {
                0.0
            },
            budget_per_hour: self.budget,
            backlog: self
                .nodes
                .iter()
                .filter(|n| n.kind == NodeKind::Queue)
                .map(|n| n.queue.len() as u64)
                .sum(),
            stars: 0,
        };
        s.rate();
        s
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

    fn alloc_call(&mut self, node: u32, parent: Parent, edge: u32, start: Time) -> u32 {
        self.next_token += 1;
        let token = self.next_token;
        let id = match self.free.pop() {
            Some(id) => id,
            None => {
                self.calls.push(Call {
                    gen: 0,
                    node: 0,
                    parent: Parent::User,
                    edge: NO_EDGE,
                    token: 0,
                    start: 0,
                    attempt: 0,
                    waiting: 0,
                    out_edge: NO_EDGE,
                    last_timeout: false,
                });
                (self.calls.len() - 1) as u32
            }
        };
        let c = &mut self.calls[id as usize];
        c.node = node;
        c.parent = parent;
        c.edge = edge;
        c.token = token;
        c.start = start;
        c.attempt = 0;
        c.waiting = 0;
        c.out_edge = NO_EDGE;
        c.last_timeout = false;
        id
    }

    fn free_call(&mut self, id: u32) {
        let c = &mut self.calls[id as usize];
        c.gen = c.gen.wrapping_add(1);
        self.free.push(id);
    }

    fn live(&self, call: u32, gen: u32) -> bool {
        self.calls[call as usize].gen == gen
    }

    fn sample_latency(&mut self, node: u32) -> Time {
        let n = &self.nodes[node as usize];
        let (mu, sigma, factor) = (n.mu, n.sigma, n.latency_factor);
        let v = if sigma <= 0.0 {
            libm::exp(mu)
        } else {
            self.rng.lognormal(mu, sigma)
        };
        (v * factor).clamp(1.0, MAX_LATENCY_US) as Time
    }

    fn handle(&mut self, ev: Ev) {
        match ev {
            Ev::ClientArrival => self.on_client_arrival(),
            Ev::Arrive { call, gen } => {
                if self.live(call, gen) {
                    self.on_arrive(call);
                }
            }
            Ev::LocalDone { call, gen } => {
                if self.live(call, gen) {
                    self.on_local_done(call);
                }
            }
            Ev::Response {
                call,
                gen,
                token,
                ok,
            } => self.on_response(call, gen, token, ok),
            Ev::Timeout { call, gen, token } => self.on_timeout(call, gen, token),
            Ev::Retry { call, gen } => {
                if self.live(call, gen) {
                    self.send_or_give_up(call);
                }
            }
            Ev::Chaos { index } => self.on_chaos(index as usize),
        }
    }

    fn on_client_arrival(&mut self) {
        let rps = self.current_rps();
        if rps > 0.0 {
            let root = self.alloc_call(self.client, Parent::User, NO_EDGE, self.now);
            self.send_or_give_up(root);
            let gap = (self.rng.exp(rps) * 1e6).max(1.0) as Time;
            self.schedule(self.now + gap, Ev::ClientArrival);
        } else {
            // idle: poll for traffic changes
            self.schedule(self.now + 100_000, Ev::ClientArrival);
        }
    }

    fn on_chaos(&mut self, index: usize) {
        let (node, action, value) = {
            let c = &self.chaos[index];
            (c.node, c.action, c.value)
        };
        match action {
            ChaosAction::Down => {
                let _ = self.set_node_down(node as usize, true);
            }
            ChaosAction::Up => {
                let _ = self.set_node_down(node as usize, false);
                let n = &mut self.nodes[node as usize];
                n.latency_factor = 1.0;
                n.error_rate = n.base_error_rate;
            }
            ChaosAction::Latency => self.nodes[node as usize].latency_factor = value.max(0.01),
            ChaosAction::Errors => self.nodes[node as usize].error_rate = value.clamp(0.0, 1.0),
        }
    }

    fn on_arrive(&mut self, call: u32) {
        let node = self.calls[call as usize].node;
        let n = &mut self.nodes[node as usize];
        n.arrivals += 1;
        let has_room = n.busy < n.capacity || n.queue.len() < n.queue_cap;
        if n.down || !has_room {
            n.rejected += 1;
            self.settle(call, false);
            return;
        }
        if n.kind == NodeKind::Queue {
            // Acknowledge the producer right away and continue the work as an
            // independent async message.
            self.notify_parent(call, true);
            let c = &mut self.calls[call as usize];
            c.parent = Parent::Async;
            c.start = self.now;
        }
        let n = &mut self.nodes[node as usize];
        if n.busy < n.capacity {
            n.account(self.now);
            n.busy += 1;
            self.start(call);
        } else {
            n.queue.push_back(call);
        }
    }

    fn start(&mut self, call: u32) {
        let node = self.calls[call as usize].node;
        let lat = self.sample_latency(node);
        let gen = self.calls[call as usize].gen;
        self.schedule(self.now + lat, Ev::LocalDone { call, gen });
    }

    fn on_local_done(&mut self, call: u32) {
        let node = self.calls[call as usize].node;
        let (down, error_rate, kind, hit_rate) = {
            let n = &self.nodes[node as usize];
            (n.down, n.error_rate, n.kind, n.hit_rate)
        };
        if down || (error_rate > 0.0 && self.rng.f64() < error_rate) {
            self.finish(call, false);
            return;
        }
        if kind == NodeKind::Cache && self.rng.f64() < hit_rate {
            self.finish(call, true);
            return;
        }
        match self.send(call) {
            Send::Sent => {}
            Send::NoEdge => self.finish(call, true),
            Send::Blocked => self.finish(call, false),
        }
    }

    /// Ask the circuit breaker of `edge` whether a call may go through.
    fn breaker_allows(&mut self, edge: u32) -> bool {
        let now = self.now;
        let Some(b) = self.edges[edge as usize].breaker.as_mut() else {
            return true;
        };
        if let CbState::Open { until } = b.state {
            if now < until {
                return false;
            }
            b.state = CbState::HalfOpen { probing: false };
        }
        match b.state {
            CbState::HalfOpen { probing: true } => false,
            CbState::HalfOpen { probing: false } => {
                b.state = CbState::HalfOpen { probing: true };
                true
            }
            _ => true,
        }
    }

    fn breaker_record(&mut self, edge: u32, ok: bool) {
        let now = self.now;
        let Some(b) = self.edges[edge as usize].breaker.as_mut() else {
            return;
        };
        match b.state {
            CbState::HalfOpen { .. } => {
                if ok {
                    b.state = CbState::Closed;
                    b.window_start = now;
                    b.calls = 0;
                    b.failures = 0;
                } else {
                    b.state = CbState::Open {
                        until: now + ms_to_us(b.cfg.open_ms),
                    };
                }
            }
            CbState::Closed => {
                if now.saturating_sub(b.window_start) >= ms_to_us(b.cfg.window_ms) {
                    b.window_start = now;
                    b.calls = 0;
                    b.failures = 0;
                }
                b.calls += 1;
                if !ok {
                    b.failures += 1;
                }
                if b.calls >= b.cfg.min_requests.max(1)
                    && b.failures as f64 >= b.cfg.failure_threshold * b.calls as f64
                {
                    b.state = CbState::Open {
                        until: now + ms_to_us(b.cfg.open_ms),
                    };
                }
            }
            CbState::Open { .. } => {} // late responses don't matter
        }
    }

    /// Make the next downstream call for `call` (round-robin, skipping edges
    /// whose breaker is open).
    fn send(&mut self, call: u32) -> Send {
        let node = self.calls[call as usize].node;
        let k = self.nodes[node as usize].out.len();
        if k == 0 {
            return Send::NoEdge;
        }
        let start = self.nodes[node as usize].rr;
        self.nodes[node as usize].rr = start.wrapping_add(1);
        let mut chosen = None;
        for i in 0..k {
            let e = self.nodes[node as usize].out[(start + i) % k];
            if self.breaker_allows(e) {
                chosen = Some(e);
                break;
            }
            self.edges[e as usize].w_short_circuits += 1;
        }
        let Some(edge) = chosen else {
            return Send::Blocked;
        };

        let (gen, start_t, attempt) = {
            let c = &self.calls[call as usize];
            (c.gen, c.start, c.attempt)
        };
        let (to, lat, timeout) = {
            let e = &mut self.edges[edge as usize];
            e.w_calls += 1;
            (e.to, e.latency, e.timeout)
        };
        let child = self.alloc_call(to, Parent::Call { id: call, gen }, edge, start_t);
        let token = self.calls[child as usize].token;
        let child_gen = self.calls[child as usize].gen;
        let c = &mut self.calls[call as usize];
        c.waiting = token;
        c.out_edge = edge;
        self.schedule(
            self.now + lat,
            Ev::Arrive {
                call: child,
                gen: child_gen,
            },
        );
        if let Some(t) = timeout {
            self.schedule(self.now + t, Ev::Timeout { call, gen, token });
        }
        let kind = if attempt > 0 {
            PARTICLE_RETRY
        } else {
            PARTICLE_REQUEST
        };
        self.emit(edge, lat, kind);
        Send::Sent
    }

    fn send_or_give_up(&mut self, call: u32) {
        if !matches!(self.send(call), Send::Sent) {
            self.downstream_done(call, false);
        }
    }

    fn on_response(&mut self, call: u32, gen: u32, token: u64, ok: bool) {
        if !self.live(call, gen) || self.calls[call as usize].waiting != token {
            return; // caller already gave up on this attempt
        }
        let edge = self.calls[call as usize].out_edge;
        self.calls[call as usize].waiting = 0;
        self.breaker_record(edge, ok);
        if ok {
            self.downstream_done(call, true);
        } else {
            self.calls[call as usize].last_timeout = false;
            self.downstream_failed(call);
        }
    }

    fn on_timeout(&mut self, call: u32, gen: u32, token: u64) {
        if !self.live(call, gen) || self.calls[call as usize].waiting != token {
            return;
        }
        let edge = self.calls[call as usize].out_edge;
        self.calls[call as usize].waiting = 0;
        self.calls[call as usize].last_timeout = true;
        self.edges[edge as usize].w_timeouts += 1;
        self.breaker_record(edge, false);
        self.downstream_failed(call);
    }

    fn downstream_failed(&mut self, call: u32) {
        let (edge, attempt, gen) = {
            let c = &self.calls[call as usize];
            (c.out_edge, c.attempt, c.gen)
        };
        let (retries, backoff, jitter) = {
            let e = &self.edges[edge as usize];
            (e.retries, e.backoff, e.jitter)
        };
        if attempt >= retries {
            self.downstream_done(call, false);
            return;
        }
        self.calls[call as usize].attempt = attempt + 1;
        self.edges[edge as usize].w_retries += 1;
        self.win.retries += 1;
        self.total.retries += 1;
        let mut wait = backoff as f64 * (1u64 << attempt.min(16)) as f64;
        if jitter {
            wait *= 0.5 + self.rng.f64();
        }
        self.schedule(self.now + wait as Time, Ev::Retry { call, gen });
    }

    /// The downstream part of `call` is over: answer its own caller.
    fn downstream_done(&mut self, call: u32, ok: bool) {
        if self.calls[call as usize].node == self.client {
            self.settle(call, ok);
        } else {
            self.finish(call, ok);
        }
    }

    /// Release the slot held by `call` and answer its caller.
    fn finish(&mut self, call: u32, ok: bool) {
        let node = self.calls[call as usize].node;
        let n = &mut self.nodes[node as usize];
        if let Some(next) = n.queue.pop_front() {
            // slot handed directly to the next waiting call
            self.start(next);
        } else {
            n.account(self.now);
            n.busy -= 1;
        }
        self.settle(call, ok);
    }

    /// Schedule the response of `call` back to its parent call, if any.
    fn notify_parent(&mut self, call: u32, ok: bool) {
        let c = &self.calls[call as usize];
        if let Parent::Call { id, gen } = c.parent {
            let (edge, token) = (c.edge, c.token);
            let lat = self.edges[edge as usize].latency;
            self.schedule(
                self.now + lat,
                Ev::Response {
                    call: id,
                    gen,
                    token,
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
    }

    /// Final outcome of `call`: report it and recycle the call.
    fn settle(&mut self, call: u32, ok: bool) {
        match self.calls[call as usize].parent {
            Parent::User => self.complete_user(call, ok),
            Parent::Async => {
                for acc in [&mut self.win, &mut self.total] {
                    if ok {
                        acc.async_ok += 1;
                    } else {
                        acc.async_err += 1;
                    }
                }
            }
            Parent::Call { .. } => self.notify_parent(call, ok),
        }
        self.free_call(call);
    }

    fn complete_user(&mut self, call: u32, ok: bool) {
        let c = &self.calls[call as usize];
        let latency = self.now - c.start;
        let timed_out = !ok && c.last_timeout;
        for acc in [&mut self.win, &mut self.total] {
            if ok {
                acc.ok += 1;
            } else {
                acc.err += 1;
            }
            if timed_out {
                acc.timeouts += 1;
            }
            acc.hist.record(latency);
        }
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
                        arrivals: n.arrivals as f64 / secs,
                        rejected: n.rejected,
                        down: n.down,
                    };
                    n.busy_area = 0.0;
                    n.rejected = 0;
                    n.arrivals = 0;
                    w
                })
                .collect();
            let edges = self
                .edges
                .iter_mut()
                .map(|e| {
                    let breaker = match e.breaker.as_ref().map(|b| b.state) {
                        Some(CbState::Open { until }) if until > end => "open",
                        Some(CbState::Open { .. }) | Some(CbState::HalfOpen { .. }) => "halfOpen",
                        _ => "closed",
                    };
                    let w = EdgeWindow {
                        calls: e.w_calls as f64 / secs,
                        retries: e.w_retries,
                        timeouts: e.w_timeouts,
                        short_circuits: e.w_short_circuits,
                        breaker,
                    };
                    e.w_calls = 0;
                    e.w_retries = 0;
                    e.w_timeouts = 0;
                    e.w_short_circuits = 0;
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
            let slo_ok =
                count == 0 || (p99_ms <= self.slo.p99_ms && err_rate <= self.slo.error_rate);
            if count > 0 {
                self.windows_with_traffic += 1;
                if slo_ok {
                    self.windows_slo_ok += 1;
                }
            }
            self.windows_out.push(WindowMetrics {
                t_ms: us_to_ms(end as f64),
                rps: w.ok as f64 / secs,
                error_rps: w.err as f64 / secs,
                ok_count: w.ok,
                error_count: w.err,
                timeout_count: w.timeouts,
                async_ok: w.async_ok,
                async_err: w.async_err,
                retries: w.retries,
                p50_ms: us_to_ms(w.hist.percentile(0.5)),
                p95_ms: us_to_ms(w.hist.percentile(0.95)),
                p99_ms,
                slo_ok,
                nodes,
                edges,
            });
            self.win.clear();
            self.window_start = end;
        }
    }
}

enum Send {
    Sent,
    /// The node has no downstream: it answers itself.
    NoEdge,
    /// Every downstream breaker is open.
    Blocked,
}

/// Synchronous calls must not loop back, or a request could never finish.
fn check_acyclic(
    nodes: &[NodeRt],
    edges: &[EdgeRt],
    design: &crate::model::Design,
) -> Result<(), String> {
    // 0 = unvisited, 1 = on stack, 2 = done
    let mut state = vec![0u8; nodes.len()];
    for root in 0..nodes.len() {
        if state[root] != 0 {
            continue;
        }
        let mut stack = vec![(root, 0usize)];
        state[root] = 1;
        while let Some(top) = stack.last_mut() {
            let (n, i) = *top;
            if let Some(&e) = nodes[n].out.get(i) {
                top.1 += 1;
                let to = edges[e as usize].to as usize;
                match state[to] {
                    0 => {
                        state[to] = 1;
                        stack.push((to, 0));
                    }
                    1 => {
                        return Err(format!(
                            "cycle detected through '{}' -> '{}'",
                            design.nodes[n].id, design.nodes[to].id
                        ))
                    }
                    _ => {}
                }
            } else {
                state[n] = 2;
                stack.pop();
            }
        }
    }
    Ok(())
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
        EdgeSpec::new(s, t, 1.0)
    }

    fn scenario(rps: f64, duration_ms: f64) -> Scenario {
        Scenario {
            seed: 1,
            duration_ms: Some(duration_ms),
            timeout_ms: 2000.0,
            traffic: vec![TrafficPhase { at_ms: 0.0, rps }],
            slo: Slo::default(),
            window_ms: 1000.0,
            events: vec![],
            budget_per_hour: None,
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

    fn api_db(db_p50: f64, api_to_db: EdgeSpec, rps: f64) -> SimInput {
        SimInput {
            design: Design {
                nodes: vec![
                    node("c", NodeKind::Client, NodeConfig::default()),
                    node(
                        "api",
                        NodeKind::Service,
                        NodeConfig {
                            concurrency: 400,
                            queue_size: 100,
                            latency_p50_ms: 2.0,
                            latency_p99_ms: 2.0,
                            ..NodeConfig::default()
                        },
                    ),
                    node(
                        "db",
                        NodeKind::Database,
                        NodeConfig {
                            concurrency: 20,
                            queue_size: 2000,
                            latency_p50_ms: db_p50,
                            latency_p99_ms: db_p50,
                            ..NodeConfig::default()
                        },
                    ),
                ],
                edges: vec![edge("c", "api"), api_to_db],
            },
            scenario: scenario(rps, 10_000.0),
        }
    }

    fn arrivals(input: &SimInput, node: usize) -> f64 {
        let mut sim = Simulation::new(input, false).unwrap();
        sim.run_to_end().unwrap();
        let ws = sim.take_windows();
        ws.iter().map(|w| w.nodes[node].arrivals).sum::<f64>() / ws.len() as f64
    }

    #[test]
    fn retries_amplify_load_on_a_struggling_dependency() {
        // DB capacity = 20 / 10 ms = 2000/s; offered 1500/s, but a 30 ms
        // timeout with 3 retries turns queueing delay into extra load.
        let plain = EdgeSpec {
            timeout_ms: Some(30.0),
            ..edge("api", "db")
        };
        let retrying = EdgeSpec {
            retries: 3,
            backoff_ms: 5.0,
            ..plain.clone()
        };
        let base = arrivals(&api_db(10.0, plain, 1900.0), 2);
        let storm = arrivals(&api_db(10.0, retrying.clone(), 1900.0), 2);
        assert!(storm > base * 1.2, "base {base}/s vs storm {storm}/s");
        let s = run(&api_db(10.0, retrying, 1900.0));
        assert!(s.retries > 0);
    }

    #[test]
    fn timeouts_fail_fast_instead_of_waiting() {
        let slow = |timeout: Option<f64>| {
            api_db(
                500.0,
                EdgeSpec {
                    timeout_ms: timeout,
                    ..edge("api", "db")
                },
                20.0,
            )
        };
        let s = run(&slow(Some(50.0)));
        assert_eq!(s.ok, 0);
        assert!(s.p99_ms < 60.0, "p99 = {}", s.p99_ms);
        let s = run(&slow(None));
        assert!(s.p50_ms > 500.0, "p50 = {}", s.p50_ms);
    }

    #[test]
    fn circuit_breaker_short_circuits_a_dead_dependency() {
        let cb = EdgeSpec {
            circuit_breaker: Some(CircuitBreaker::default()),
            ..edge("api", "db")
        };
        let mut input = api_db(5.0, cb, 200.0);
        input.scenario.events = vec![ChaosEvent {
            at_ms: 2000.0,
            node: "db".into(),
            action: ChaosAction::Down,
            value: 0.0,
        }];
        let mut sim = Simulation::new(&input, false).unwrap();
        sim.run_to_end().unwrap();
        let ws = sim.take_windows();
        assert_eq!(ws[1].edges[1].breaker, "closed");
        assert!(ws[4].edges[1].short_circuits > 100, "{:?}", ws[4].edges[1]);
        // while open almost nothing reaches the dead DB
        assert!(ws[4].nodes[2].arrivals < 5.0, "{:?}", ws[4].nodes[2]);
    }

    #[test]
    fn chaos_events_apply_at_their_time() {
        let mut input = single_service(100.0, 100, 10.0);
        input.scenario.events = vec![
            ChaosEvent {
                at_ms: 3000.0,
                node: "svc".into(),
                action: ChaosAction::Errors,
                value: 1.0,
            },
            ChaosEvent {
                at_ms: 6000.0,
                node: "svc".into(),
                action: ChaosAction::Up,
                value: 0.0,
            },
        ];
        let mut sim = Simulation::new(&input, false).unwrap();
        sim.step(9000.0);
        let ws = sim.take_windows();
        assert_eq!(ws[1].error_count, 0);
        assert_eq!(ws[4].ok_count, 0);
        assert_eq!(ws[7].error_count, 0);
    }

    #[test]
    fn stars_reflect_slo_budget_and_resilience() {
        let mut input = single_service(100.0, 100, 10.0);
        input.scenario.budget_per_hour = Some(1.0);
        assert_eq!(run(&input).stars, 3);
        input.design.nodes[1].config.cost_per_hour = 2.0;
        assert_eq!(run(&input).stars, 1);
        let overloaded = single_service(500.0, 10, 100.0);
        assert_eq!(run(&overloaded).stars, 0);
    }

    #[test]
    fn rejects_cycles() {
        let mut input = api_db(1.0, edge("api", "db"), 10.0);
        input.design.edges.push(edge("db", "api"));
        let err = Simulation::new(&input, false).err().unwrap();
        assert!(err.contains("cycle"), "{err}");
    }
}
