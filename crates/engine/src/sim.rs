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
//! 7. `cpu` nodes (Node.js, Postgres) separate *in-flight* requests from
//!    *CPU lanes*: a request computes in slices around its downstream calls
//!    and only queues for a lane while computing. Waiting for a lane is the
//!    event-loop lag.
//! 8. Edges may carry a connection pool: calls wait for a free connection,
//!    and a connection stays busy until the callee answers.
//!
//! Time is integer microseconds; the event heap is ordered by
//! `(time, sequence)` so simultaneous events resolve deterministically.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, VecDeque};

use serde::Serialize;

use crate::histogram::Histogram;
use crate::model::{
    Arrival, Autoscale, Balance, CacheModel, ChaosAction, ScaleMetric, CircuitBreaker, ExecModel, NodeKind, Routing, SimInput,
    Slo,
};
use crate::rng::Rng;

pub type Time = u64; // microseconds

const Z99: f64 = 2.326_347_874; // z-score of the 99th percentile
const MAX_LATENCY_US: f64 = 60_000_000.0;
const MAX_PENDING_PARTICLE_FLOATS: usize = 4 * 500_000;
const NO_EDGE: u32 = u32::MAX;
/// Placeholder in a CPU queue for a pending GC pause.
const GC_JOB: u32 = u32::MAX;
/// Particle kinds, written into the particle stream.
pub const PARTICLE_REQUEST: f32 = 0.0;
pub const PARTICLE_RESPONSE_OK: f32 = 1.0;
pub const PARTICLE_RESPONSE_ERR: f32 = 2.0;
pub const PARTICLE_RETRY: f32 = 3.0;
/// Added to the kind of particles that belong to a traced request.
pub const PARTICLE_TRACED: f32 = 4.0;
const MAX_TRACE_EVENTS: usize = 20_000;

/// Time to push `kb` kilobytes through a `mbps` link, µs.
fn transfer_us(kb: f64, mbps: f64) -> Time {
    if kb <= 0.0 || mbps <= 0.0 {
        return 0;
    }
    (kb * 8000.0 / mbps).round() as Time
}

fn ms_to_us(v: f64) -> Time {
    (v * 1000.0).max(0.0).round() as Time
}

fn us_to_ms(v: f64) -> f64 {
    v / 1000.0
}

/// Lognormal `(mu, sigma)` in µs from a p50 and p99 in ms.
fn lognormal_params(p50_ms: f64, p99_ms: f64) -> (f64, f64) {
    let p50 = (p50_ms * 1000.0).max(1.0);
    let p99 = (p99_ms * 1000.0).max(p50);
    (libm::log(p50), (libm::log(p99) - libm::log(p50)) / Z99)
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
    /// The response of child `token` reaches caller `call` over `edge`.
    Response {
        call: u32,
        gen: u32,
        token: u64,
        edge: u32,
        ok: bool,
    },
    /// A CPU slice of a `cpu` node finished.
    CpuDone {
        call: u32,
        gen: u32,
    },
    /// Local non-CPU wait of a `cpu` node finished.
    IoDone {
        call: u32,
        gen: u32,
    },
    /// A GC pause on instance `inst` of `node` ended.
    GcDone {
        node: u32,
        inst: u32,
    },
    /// Gave up waiting for a pooled connection.
    PoolTimeout {
        call: u32,
        gen: u32,
        token: u64,
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
    /// Autoscaler evaluation of `node`.
    Autoscale {
        node: u32,
    },
    /// A started instance of `node` passed its readiness delay.
    PodReady {
        node: u32,
    },
    /// A branch of a `sequence`/`parallel` fork of `call` is over.
    BranchDone {
        call: u32,
        gen: u32,
        fork: u64,
        ok: bool,
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

/// One server of a node.
#[derive(Default)]
struct Inst {
    busy: u32,
    queue: VecDeque<u32>,
    cpu_busy: u32,
    cpu_queue: VecDeque<u32>,
    /// Requests since the last GC pause.
    gc_count: u32,
}

/// Autoscaler state of one node.
struct HpaRt {
    cfg: Autoscale,
    /// `queueLength`: node whose backlog drives the scaling.
    queue_node: usize,
    /// Busy and capacity areas since the last evaluation.
    busy: f64,
    cap: f64,
    /// Recent recommendations `(at, replicas)` for scale-down stabilization.
    history: VecDeque<(Time, usize)>,
}

const NO_KEY: u32 = u32::MAX;

/// Keyspace of a cache node (`config.cache`).
struct CacheRt {
    cfg: CacheModel,
    /// Cumulative Zipf popularity (empty for a uniform keyspace).
    cdf: Vec<f64>,
    /// Expiry of each key; 0 = not cached, `Time::MAX` = no TTL.
    expires: Vec<Time>,
    /// Coalescing: key → calls waiting for its in-flight fetch.
    inflight: HashMap<u32, Vec<(u32, u32)>>,
    hits: u64,
    misses: u64,
    coalesced: u64,
}

impl CacheRt {
    fn new(cfg: CacheModel) -> Self {
        let k = cfg.keys.clamp(1, 1_000_000) as usize;
        let skew = cfg.skew.max(0.0);
        let cdf = if skew > 0.0 {
            let mut acc = 0.0;
            let mut cdf: Vec<f64> = (0..k)
                .map(|i| {
                    acc += 1.0 / libm::pow(i as f64 + 1.0, skew);
                    acc
                })
                .collect();
            for c in &mut cdf {
                *c /= acc;
            }
            cdf
        } else {
            Vec::new()
        };
        Self {
            cfg,
            cdf,
            expires: vec![0; k],
            inflight: HashMap::new(),
            hits: 0,
            misses: 0,
            coalesced: 0,
        }
    }

    fn key(&self, u: f64) -> u32 {
        let k = self.expires.len();
        let i = if self.cdf.is_empty() {
            (u * k as f64) as usize
        } else {
            self.cdf.partition_point(|&c| c < u)
        };
        i.min(k - 1) as u32
    }

    /// Expiry of a key filled now; `u` spreads it by ±`ttl_jitter`.
    fn expiry(&self, now: Time, u: f64) -> Time {
        if self.cfg.ttl_ms <= 0.0 {
            return Time::MAX;
        }
        let spread = 1.0 + self.cfg.ttl_jitter.clamp(0.0, 1.0) * (2.0 * u - 1.0);
        now + ms_to_us(self.cfg.ttl_ms * spread).max(1)
    }
}

struct NodeRt {
    kind: NodeKind,
    model: ExecModel,
    balance: Balance,
    instances: f64,
    /// Instances receiving new work (ready); later ones only drain.
    ready: usize,
    /// Desired instances, including those still starting.
    active: usize,
    /// Ready times of instances still starting, oldest first. A `PodReady`
    /// event only counts if it matches the front: pods cancelled by a
    /// scale-down are dropped from the back, so their events become no-ops.
    pending: VecDeque<Time>,
    hpa: Option<HpaRt>,
    cache: Option<CacheRt>,
    cost: f64,
    /// Instance-time (active × µs), for the cost of autoscaled nodes.
    inst_area: f64,
    /// Capacity × time, so utilization stays right when capacity changes.
    cap_area: f64,
    cpu_cap_area: f64,
    /// Processes per instance, for per-process connection pools.
    processes: u32,
    insts: Vec<Inst>,
    next_inst: usize,
    /// Per instance: `threads` slots or `cpu` in-flight permits.
    slots: u32,
    queue_cap: usize,
    lanes: u32,
    /// Totals over instances, for utilization.
    capacity: u32,
    busy: u32,
    cpu_cap: u32,
    cpu_busy: u32,
    mu: f64,
    sigma: f64,
    cpu_mu: f64,
    cpu_sigma: f64,
    io: Option<(f64, f64)>,
    calls: u32,
    contention: f64,
    coherency: f64,
    gc_pause: Time,
    gc_every: u32,
    wakeup: Time,
    base_error_rate: f64,
    error_rate: f64,
    latency_factor: f64,
    hit_rate: f64,
    down: bool,
    out: Vec<u32>,
    rr: usize,
    routing: Routing,
    /// `sequence`/`parallel`: edges called at each step (equal `order` together).
    stages: Vec<Vec<u32>>,
    // window accounting
    busy_area: f64,
    last_change: Time,
    cpu_area: f64,
    cpu_last: Time,
    lag_sum: f64,
    lag_n: u64,
    rejected: u64,
    arrivals: u64,
}

impl NodeRt {
    fn account(&mut self, now: Time) {
        let dt = now.saturating_sub(self.last_change) as f64;
        self.busy_area += self.busy as f64 * dt;
        self.cap_area += self.capacity as f64 * dt;
        self.inst_area += self.active as f64 * dt;
        if self.model == ExecModel::Threads {
            if let Some(h) = self.hpa.as_mut() {
                h.busy += self.busy as f64 * dt;
                h.cap += self.capacity as f64 * dt;
            }
        }
        self.last_change = now;
    }

    fn account_cpu(&mut self, now: Time) {
        let dt = now.saturating_sub(self.cpu_last) as f64;
        self.cpu_area += self.cpu_busy as f64 * dt;
        self.cpu_cap_area += self.cpu_cap as f64 * dt;
        if self.model == ExecModel::Cpu {
            if let Some(h) = self.hpa.as_mut() {
                h.busy += self.cpu_busy as f64 * dt;
                h.cap += self.cpu_cap as f64 * dt;
            }
        }
        self.cpu_last = now;
    }

    /// Downstream calls a request makes here.
    fn effective_calls(&self) -> u32 {
        if self.out.is_empty() {
            0
        } else if self.routing == Routing::Pick {
            self.calls
        } else {
            self.stages.len() as u32
        }
    }

    /// USL slowdown with the number of active requests on instance `i`.
    fn usl(&self, i: usize) -> f64 {
        if self.contention <= 0.0 && self.coherency <= 0.0 {
            return 1.0;
        }
        let n = (self.insts[i].busy as f64).max(1.0);
        1.0 + self.contention * (n - 1.0) + self.coherency * n * (n - 1.0)
    }

    fn queued(&self) -> usize {
        self.insts.iter().map(|i| i.queue.len()).sum()
    }

    fn cpu_queued(&self) -> usize {
        self.insts.iter().map(|i| i.cpu_queue.len()).sum()
    }
}

struct PoolRt {
    cap: u32,
    /// Connections per caller instance (pool size × processes).
    per_inst: u32,
    busy: u32,
    timeout: Time,
    /// `(call, gen, wait token, enqueued at)`; stale entries are skipped.
    waiters: VecDeque<(u32, u32, u64, Time)>,
    area: f64,
    last_change: Time,
    wait_sum: f64,
    wait_n: u64,
    timeouts: u64,
}

impl PoolRt {
    fn account(&mut self, now: Time) {
        self.area += self.busy as f64 * now.saturating_sub(self.last_change) as f64;
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
    pool: Option<PoolRt>,
    fire_and_forget: bool,
    /// Transfer time of a request / response body on the link.
    req_tx: Time,
    res_tx: Time,
    /// When the link is free again in each direction.
    req_free: Time,
    res_free: Time,
    w_req_busy: f64,
    w_res_busy: f64,
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
    /// Async message spawned by a queue node, or a fire-and-forget branch.
    Async,
    Call {
        id: u32,
        gen: u32,
    },
    /// Branch of fork `fork` of call `id` (`sequence`/`parallel` routing).
    Fork {
        id: u32,
        gen: u32,
        fork: u64,
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
    /// Downstream calls completed so far.
    step: u32,
    /// CPU time of each slice (`cpu` nodes).
    slice: Time,
    /// When the call started waiting for a CPU lane.
    enq: Time,
    /// Token while waiting for a pooled connection, 0 otherwise.
    pool_wait: u64,
    /// Instance of `node` serving the call.
    inst: u32,
    /// Branch of a fork: lives at its parent's node, calls `fixed_edge`
    /// with that edge's policy, and holds no slot.
    branch: bool,
    fixed_edge: u32,
    /// Current fork token and branches still awaited.
    fork: u64,
    pending: u32,
    /// Trace id (0 = not traced) and span id reported as parent of children.
    trace: u32,
    span: u64,
    /// When the call started waiting for a pooled connection.
    pool_since: Time,
    /// Cache miss being fetched for this key (`NO_KEY` otherwise).
    key: u32,
}

#[derive(Default)]
struct Acc {
    ok: u64,
    err: u64,
    timeouts: u64,
    async_ok: u64,
    async_err: u64,
    retries: u64,
    dropped: u64,
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
        self.dropped = 0;
        self.hist.clear();
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodeWindow {
    /// Time-weighted fraction of busy slots during the window (0..1).
    /// `cpu` nodes: fraction of busy CPU lanes.
    pub utilization: f64,
    /// Average requests open at the node (Little's law: rps × latency).
    pub in_flight: f64,
    /// Queue length at the end of the window.
    pub queue: usize,
    /// `cpu` nodes: requests waiting for a CPU lane at the end of the window.
    pub cpu_queue: usize,
    /// `cpu` nodes: average wait for a CPU lane (event-loop lag), ms.
    pub lag_ms: f64,
    /// Calls arriving per second (including retries).
    pub arrivals: f64,
    pub rejected: u64,
    pub down: bool,
    /// Instances receiving traffic at the end of the window.
    pub instances: u32,
    /// Autoscaled instances still starting (not ready yet).
    pub starting: u32,
    /// Keyspace caches: hits, misses and misses that joined an in-flight fetch.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache: Option<CacheWindow>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CacheWindow {
    pub hits: u64,
    pub misses: u64,
    pub coalesced: u64,
    /// Keys cached at the end of the window.
    pub filled: u32,
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
    /// Pooled edges: fraction of connections busy (0..1).
    pub pool_utilization: f64,
    /// Pooled edges: average wait for a connection, ms.
    pub pool_wait_ms: f64,
    /// Pooled edges: attempts that gave up waiting for a connection.
    pub pool_timeouts: u64,
    /// Busiest direction of the link, fraction of time transferring bodies.
    pub bandwidth_utilization: f64,
}

/// One step in the life of a traced request (see [`Simulation::trace_next`]).
/// A span is one call over one edge; `span` ids are unique for the run.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraceEvent {
    pub trace: u32,
    /// `begin` (root), `send`, `arrive`, `start` (got a slot), `reject`,
    /// `reply` (callee answers), `recv` (caller got it), `timeout`, `end`.
    pub ev: &'static str,
    pub span: u64,
    /// Span of the caller (0 for the root).
    pub parent: u64,
    pub node: u32,
    pub edge: Option<u32>,
    pub t_ms: f64,
    pub ok: bool,
    pub attempt: u32,
    /// `send`: time spent waiting for a pooled connection.
    pub wait_ms: f64,
    /// `send`: the caller does not wait for the answer.
    pub fire_and_forget: bool,
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
    /// Requests the load generator skipped (`maxConcurrent` reached).
    pub dropped: u64,
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
    pub dropped: u64,
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
    arrival: Arrival,
    max_concurrent: Option<u32>,
    user_in_flight: u32,
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
    trace_budget: u32,
    next_trace: u32,
    traces: Vec<TraceEvent>,
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

        for n in &design.nodes {
            if let Some(q) = n.config.autoscale.as_ref().and_then(|a| a.queue.as_deref()) {
                if !index.contains_key(q) {
                    return Err(format!("node '{}': autoscale.queue '{}' is not a node", n.id, q));
                }
            }
        }

        let mut cost_per_hour = 0.0;
        let mut nodes: Vec<NodeRt> = design
            .nodes
            .iter()
            .enumerate()
            .map(|(i, n)| {
                let c = &n.config;
                let (mu, sigma) = lognormal_params(c.latency_p50_ms, c.latency_p99_ms);
                let (cpu_mu, cpu_sigma) = lognormal_params(c.cpu_p50_ms, c.cpu_p99_ms);
                let io = (c.io_p50_ms > 0.0).then(|| lognormal_params(c.io_p50_ms, c.io_p99_ms));
                let hpa = c.autoscale.clone().filter(|_| n.kind != NodeKind::Client).map(|a| {
                    let min = a.min.max(1);
                    Autoscale {
                        min,
                        max: a.max.max(min),
                        ..a
                    }
                });
                let instances = match &hpa {
                    Some(a) => c.instances.clamp(a.min, a.max),
                    None => c.instances.max(1),
                };
                let allocated = hpa.as_ref().map_or(instances, |a| a.max.max(instances));
                if n.kind != NodeKind::Client {
                    cost_per_hour += c.cost_per_hour * instances as f64;
                }
                let error_rate = c.error_rate.clamp(0.0, 1.0);
                let model = if n.kind == NodeKind::Client {
                    ExecModel::Threads
                } else {
                    c.model
                };
                let per_instance = match model {
                    ExecModel::Threads => c.concurrency.max(1),
                    ExecModel::Cpu => c.max_in_flight.max(1),
                };
                let slots = if n.kind == NodeKind::Client {
                    0
                } else {
                    per_instance
                };
                NodeRt {
                    kind: n.kind,
                    model,
                    balance: c.balance,
                    instances: instances as f64,
                    ready: instances as usize,
                    pending: VecDeque::new(),
                    active: instances as usize,
                    hpa: hpa.map(|cfg| HpaRt {
                        queue_node: cfg
                            .queue
                            .as_deref()
                            .and_then(|q| index.get(q).copied())
                            .map_or(i, |q| q as usize),
                        cfg,
                        busy: 0.0,
                        cap: 0.0,
                        history: VecDeque::new(),
                    }),
                    cache: c.cache.filter(|_| n.kind == NodeKind::Cache).map(|cfg| {
                        let mut rt = CacheRt::new(cfg);
                        if cfg.warm {
                            // filled before the run; with a TTL and no jitter they all expire together
                            for i in 0..rt.expires.len() {
                                let u = ((i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 11) as f64 / (1u64 << 53) as f64;
                                rt.expires[i] = rt.expiry(0, u);
                            }
                        }
                        rt
                    }),
                    cost: c.cost_per_hour,
                    inst_area: 0.0,
                    cap_area: 0.0,
                    cpu_cap_area: 0.0,
                    insts: (0..allocated).map(|_| Inst::default()).collect(),
                    next_inst: 0,
                    slots,
                    lanes: c.cpu_lanes.max(1),
                    processes: match model {
                        ExecModel::Threads => 1,
                        ExecModel::Cpu => c.cpu_lanes.max(1),
                    },
                    capacity: instances.saturating_mul(slots),
                    busy: 0,
                    queue_cap: c.queue_size as usize,
                    mu,
                    sigma,
                    cpu_cap: instances.saturating_mul(c.cpu_lanes.max(1)),
                    cpu_busy: 0,
                    cpu_mu,
                    cpu_sigma,
                    io,
                    calls: match n.kind {
                        NodeKind::Service | NodeKind::Database => c.calls_per_request.clamp(1, 100),
                        _ => 1,
                    },
                    contention: c.contention.max(0.0),
                    coherency: c.coherency.max(0.0),
                    gc_pause: ms_to_us(c.gc_pause_ms),
                    wakeup: ms_to_us(c.wakeup_ms),
                    gc_every: if model == ExecModel::Cpu && c.gc_pause_ms > 0.0 {
                        c.gc_every_requests
                    } else {
                        0
                    },
                    base_error_rate: error_rate,
                    error_rate,
                    latency_factor: 1.0,
                    hit_rate: c.hit_rate.clamp(0.0, 1.0),
                    down: false,
                    out: Vec::new(),
                    rr: 0,
                    routing: match n.kind {
                        NodeKind::Client | NodeKind::LoadBalancer => Routing::Pick,
                        _ => c.routing,
                    },
                    stages: Vec::new(),
                    busy_area: 0.0,
                    last_change: 0,
                    cpu_area: 0.0,
                    cpu_last: 0,
                    lag_sum: 0.0,
                    lag_n: 0,
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
            let pool = e.pool_size.filter(|p| *p > 0).map(|p| {
                let src = &nodes[from as usize];
                let per_inst = p.saturating_mul(src.processes);
                PoolRt {
                    cap: per_inst.saturating_mul(src.ready as u32),
                    per_inst,
                    busy: 0,
                    timeout: ms_to_us(e.pool_timeout_ms.max(1.0)),
                    waiters: VecDeque::new(),
                    area: 0.0,
                    last_change: 0,
                    wait_sum: 0.0,
                    wait_n: 0,
                    timeouts: 0,
                }
            });
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
                pool,
                fire_and_forget: e.fire_and_forget,
                req_tx: transfer_us(e.request_kb, e.bandwidth_mbps),
                res_tx: transfer_us(e.response_kb, e.bandwidth_mbps),
                req_free: 0,
                res_free: 0,
                w_req_busy: 0.0,
                w_res_busy: 0.0,
                w_calls: 0,
                w_retries: 0,
                w_timeouts: 0,
                w_short_circuits: 0,
            });
        }
        for n in nodes.iter_mut().filter(|n| n.routing != Routing::Pick) {
            // (order, edge), sorted; equal orders form one stage
            let mut out: Vec<(u32, u32)> = n
                .out
                .iter()
                .map(|&e| match n.routing {
                    Routing::Sequence => (design.edges[e as usize].order, e),
                    _ => (0, e),
                })
                .collect();
            out.sort();
            let mut last = None;
            for (order, e) in out {
                if last == Some(order) {
                    n.stages.last_mut().expect("stage").push(e);
                } else {
                    n.stages.push(vec![e]);
                    last = Some(order);
                }
            }
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
            arrival: sc.arrival,
            max_concurrent: sc.max_concurrent,
            user_in_flight: 0,
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
            trace_budget: 0,
            next_trace: 0,
            traces: Vec::new(),
        };
        for i in 0..sim.chaos.len() {
            let at = sim.chaos[i].at;
            sim.schedule(at, Ev::Chaos { index: i as u32 });
        }
        for i in 0..sim.nodes.len() {
            if let Some(h) = &sim.nodes[i].hpa {
                let every = ms_to_us(h.cfg.eval_every_ms.max(100.0));
                sim.schedule(every, Ev::Autoscale { node: i as u32 });
            }
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
            let drained: Vec<u32> = n.insts.iter_mut().flat_map(|i| i.queue.drain(..)).collect();
            n.rejected += drained.len() as u64;
            for call in drained {
                self.settle(call, false);
            }
        }
        Ok(())
    }

    /// Evict every key of a keyspace cache (FLUSHALL); no-op for other nodes.
    pub fn flush_cache(&mut self, node: usize) -> Result<(), String> {
        let n = self.nodes.get_mut(node).ok_or("node index out of range")?;
        if let Some(c) = n.cache.as_mut() {
            c.expires.fill(0);
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
            dropped: t.dropped,
            error_rate,
            throughput_rps: if secs > 0.0 { t.ok as f64 / secs } else { 0.0 },
            p50_ms: us_to_ms(t.hist.percentile(0.5)),
            p95_ms: us_to_ms(t.hist.percentile(0.95)),
            p99_ms,
            cost_per_hour: self.average_cost_per_hour(),
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
                .map(|n| n.queued() as u64)
                .sum(),
            stars: 0,
        };
        s.rate();
        s
    }

    // ---------------------------------------------------------------- internals

    /// Configured cost, with autoscaled nodes counted at their average size.
    fn average_cost_per_hour(&self) -> f64 {
        if self.now == 0 || self.nodes.iter().all(|n| n.hpa.is_none()) {
            return self.cost_per_hour;
        }
        self.nodes
            .iter()
            .filter(|n| n.kind != NodeKind::Client)
            .map(|n| match n.hpa {
                Some(_) => {
                    let area = n.inst_area + n.active as f64 * self.now.saturating_sub(n.last_change) as f64;
                    n.cost * area / self.now as f64
                }
                None => n.cost * n.instances,
            })
            .sum()
    }

    /// HPA evaluation: replicas = ceil(ready × utilization / target), unready
    /// instances counted as idle, ±10 % tolerance, stabilized scale-down.
    fn on_autoscale(&mut self, node: usize) {
        let now = self.now;
        let n = &mut self.nodes[node];
        n.account(now);
        n.account_cpu(now);
        let (ready, active) = (n.ready, n.active);
        let Some(h) = n.hpa.as_mut() else { return };
        let util = if h.cap > 0.0 { h.busy / h.cap } else { 0.0 };
        h.busy = 0.0;
        h.cap = 0.0;
        let cfg = h.cfg.clone();
        let queue_node = h.queue_node;
        // (current ratio to target, replicas wanted)
        let (ratio, wanted) = match cfg.metric {
            ScaleMetric::Utilization => {
                let target = cfg.target_utilization.clamp(0.01, 1.0);
                (
                    util * ready as f64 / active.max(1) as f64 / target,
                    (ready as f64 * util / target).ceil(),
                )
            }
            ScaleMetric::QueueLength => {
                // KEDA polls the broker: the backlog right now, not an average
                let backlog = self.nodes[queue_node].queued() as f64;
                let target = cfg.target_queue_length.max(1.0);
                (backlog / (active.max(1) as f64 * target), (backlog / target).ceil())
            }
        };
        let desired = if (ratio - 1.0).abs() <= 0.1 { active } else { wanted as usize }
            .clamp(cfg.min as usize, cfg.max as usize);
        let Some(h) = self.nodes[node].hpa.as_mut() else { return };
        let stab = ms_to_us(cfg.stabilization_ms.max(0.0));
        h.history.push_back((now, desired));
        while h.history.front().is_some_and(|(t, _)| now.saturating_sub(*t) > stab) {
            h.history.pop_front();
        }
        let floor = h.history.iter().map(|x| x.1).max().unwrap_or(desired);
        if desired > active {
            let start = ms_to_us(cfg.pod_start_ms.max(0.0));
            for _ in active..desired {
                self.nodes[node].pending.push_back(now + start);
                self.schedule(now + start, Ev::PodReady { node: node as u32 });
            }
            self.nodes[node].active = desired;
        } else if floor < active {
            let n = &mut self.nodes[node];
            n.active = floor;
            n.ready = n.ready.min(floor);
            // cancel the most recently started pods first
            while n.ready + n.pending.len() > n.active {
                n.pending.pop_back();
            }
            self.resize(node);
        }
        let every = ms_to_us(cfg.eval_every_ms.max(100.0));
        self.schedule(now + every, Ev::Autoscale { node: node as u32 });
    }

    fn on_pod_ready(&mut self, node: usize) {
        let now = self.now;
        let n = &mut self.nodes[node];
        if n.pending.front() != Some(&now) {
            return; // this pod was cancelled by a scale-down
        }
        n.pending.pop_front();
        n.account(now);
        n.account_cpu(now);
        n.ready += 1;
        self.resize(node);
    }

    /// Capacity and caller-side pools follow the number of ready instances.
    fn resize(&mut self, node: usize) {
        let now = self.now;
        let n = &mut self.nodes[node];
        n.account(now);
        n.account_cpu(now);
        n.capacity = (n.ready as u32).saturating_mul(n.slots);
        n.cpu_cap = (n.ready as u32).saturating_mul(n.lanes);
        let ready = n.ready as u32;
        let out = n.out.clone();
        for e in out {
            let mut granted = Vec::new();
            let Some(pool) = self.edges[e as usize].pool.as_mut() else { continue };
            pool.account(now);
            pool.cap = pool.per_inst.saturating_mul(ready).max(1);
            // more connections: hand them to callers already waiting
            while pool.busy < pool.cap {
                let Some((call, gen, token, at)) = pool.waiters.pop_front() else { break };
                let c = &mut self.calls[call as usize];
                if c.gen != gen || c.pool_wait != token {
                    continue; // timed out meanwhile
                }
                c.pool_wait = 0;
                pool.busy += 1;
                pool.wait_sum += (now - at) as f64;
                pool.wait_n += 1;
                granted.push(call);
            }
            for call in granted {
                self.dispatch(call, e);
            }
        }
    }

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

    fn emit(&mut self, edge: u32, latency: Time, kind: f32, traced: bool) {
        if self.emit_particles && self.particles.len() < MAX_PENDING_PARTICLE_FLOATS {
            self.particles.extend_from_slice(&[
                edge as f32,
                (self.now as f64 / 1e6) as f32,
                (latency as f64 / 1e6) as f32,
                if traced { kind + PARTICLE_TRACED } else { kind },
            ]);
        }
    }

    /// Delay for a body crossing `edge` now: wait for the link (bodies go
    /// one after another, FIFO), transfer, then propagation latency.
    fn link_delay(&mut self, edge: u32, response: bool) -> Time {
        let now = self.now;
        let e = &mut self.edges[edge as usize];
        let (tx, free, busy) = if response {
            (e.res_tx, &mut e.res_free, &mut e.w_res_busy)
        } else {
            (e.req_tx, &mut e.req_free, &mut e.w_req_busy)
        };
        if tx == 0 {
            return e.latency;
        }
        let begin = (*free).max(now);
        *free = begin + tx;
        *busy += tx as f64;
        *free - now + e.latency
    }

    /// Trace the next `n` user requests (see [`TraceEvent`]).
    pub fn trace_next(&mut self, n: u32) {
        self.trace_budget = self.trace_budget.saturating_add(n);
    }

    pub fn take_traces(&mut self) -> Vec<TraceEvent> {
        std::mem::take(&mut self.traces)
    }

    #[allow(clippy::too_many_arguments)]
    fn record(
        &mut self,
        call: u32,
        ev: &'static str,
        span: u64,
        parent: u64,
        edge: u32,
        ok: bool,
        wait: Time,
    ) {
        let c = &self.calls[call as usize];
        if c.trace == 0 || self.traces.len() >= MAX_TRACE_EVENTS {
            return;
        }
        let edge = (edge != NO_EDGE).then_some(edge);
        let ff = edge.is_some_and(|e| self.edges[e as usize].fire_and_forget);
        self.traces.push(TraceEvent {
            trace: c.trace,
            ev,
            span,
            parent,
            node: c.node,
            edge,
            t_ms: us_to_ms(self.now as f64),
            ok,
            attempt: c.attempt,
            wait_ms: us_to_ms(wait as f64),
            fire_and_forget: ff && ev == "send",
        });
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
                    step: 0,
                    slice: 0,
                    enq: 0,
                    pool_wait: 0,
                    inst: 0,
                    branch: false,
                    fixed_edge: NO_EDGE,
                    fork: 0,
                    pending: 0,
                    trace: 0,
                    span: 0,
                    pool_since: 0,
                    key: NO_KEY,
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
        c.step = 0;
        c.slice = 0;
        c.enq = 0;
        c.pool_wait = 0;
        c.inst = 0;
        c.branch = false;
        c.fixed_edge = NO_EDGE;
        c.fork = 0;
        c.pending = 0;
        c.trace = 0;
        c.span = token;
        c.pool_since = 0;
        c.key = NO_KEY;
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

    fn sample(&mut self, mu: f64, sigma: f64) -> f64 {
        if sigma <= 0.0 {
            libm::exp(mu)
        } else {
            self.rng.lognormal(mu, sigma)
        }
    }

    /// Local processing time of a `threads` node.
    fn sample_latency(&mut self, node: u32, inst: usize) -> Time {
        let n = &self.nodes[node as usize];
        let (mu, sigma, factor) = (n.mu, n.sigma, n.latency_factor * n.usl(inst));
        let v = self.sample(mu, sigma);
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
                edge,
                ok,
            } => {
                self.release_pool(edge);
                self.on_response(call, gen, token, ok);
            }
            Ev::CpuDone { call, gen } => {
                if self.live(call, gen) {
                    self.on_cpu_done(call);
                }
            }
            Ev::IoDone { call, gen } => {
                if self.live(call, gen) {
                    self.proceed(call);
                }
            }
            Ev::PoolTimeout { call, gen, token } => self.on_pool_timeout(call, gen, token),
            Ev::GcDone { node, inst } => self.release_lane(node, inst as usize),
            Ev::Timeout { call, gen, token } => self.on_timeout(call, gen, token),
            Ev::Retry { call, gen } => {
                if self.live(call, gen) {
                    self.send_or_give_up(call);
                }
            }
            Ev::Chaos { index } => self.on_chaos(index as usize),
            Ev::Autoscale { node } => self.on_autoscale(node as usize),
            Ev::PodReady { node } => self.on_pod_ready(node as usize),
            Ev::BranchDone {
                call,
                gen,
                fork,
                ok,
            } => self.on_branch_done(call, gen, fork, ok),
        }
    }

    fn on_client_arrival(&mut self) {
        let rps = self.current_rps();
        if rps > 0.0 {
            if self
                .max_concurrent
                .is_some_and(|cap| self.user_in_flight >= cap)
            {
                self.win.dropped += 1;
                self.total.dropped += 1;
            } else {
                self.user_in_flight += 1;
                let root = self.alloc_call(self.client, Parent::User, NO_EDGE, self.now);
                if self.trace_budget > 0 {
                    self.trace_budget -= 1;
                    self.next_trace += 1;
                    self.calls[root as usize].trace = self.next_trace;
                    let span = self.calls[root as usize].span;
                    self.record(root, "begin", span, 0, NO_EDGE, true, 0);
                }
                self.send_or_give_up(root);
            }
            let gap = match self.arrival {
                Arrival::Poisson => self.rng.exp(rps),
                Arrival::Uniform => 1.0 / rps,
            };
            let gap = (gap * 1e6).max(1.0) as Time;
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
                // a restarted cache comes back empty
                if let Some(c) = n.cache.as_mut() {
                    c.expires.fill(0);
                }
            }
            ChaosAction::Flush => {
                if let Some(c) = self.nodes[node as usize].cache.as_mut() {
                    c.expires.fill(0);
                }
            }
            ChaosAction::Latency => self.nodes[node as usize].latency_factor = value.max(0.01),
            ChaosAction::Errors => self.nodes[node as usize].error_rate = value.clamp(0.0, 1.0),
        }
    }

    fn on_arrive(&mut self, call: u32) {
        let node = self.calls[call as usize].node;
        let n = &mut self.nodes[node as usize];
        n.arrivals += 1;
        let k = n.ready.clamp(1, n.insts.len());
        let inst = match n.balance {
            _ if k == 1 => 0,
            Balance::RoundRobin => {
                n.next_inst = (n.next_inst + 1) % k;
                n.next_inst
            }
            Balance::LeastConnections => {
                let start = n.next_inst;
                n.next_inst = (n.next_inst + 1) % k;
                (0..k)
                    .map(|j| (start + j) % k)
                    .min_by_key(|&i| n.insts[i].busy as usize + n.insts[i].queue.len())
                    .unwrap_or(0)
            }
            Balance::Random => (self.rng.f64() * k as f64) as usize % k,
        };
        self.calls[call as usize].inst = inst as u32;
        let span = self.calls[call as usize].span;
        self.record(call, "arrive", span, 0, NO_EDGE, true, 0);
        let n = &mut self.nodes[node as usize];
        let slot = &n.insts[inst];
        let has_room = slot.busy < n.slots || slot.queue.len() < n.queue_cap;
        if n.down || !has_room {
            n.rejected += 1;
            self.record(call, "reject", span, 0, NO_EDGE, false, 0);
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
        if n.insts[inst].busy < n.slots {
            n.account(self.now);
            n.busy += 1;
            n.insts[inst].busy += 1;
            self.start(call);
        } else {
            n.insts[inst].queue.push_back(call);
        }
    }

    /// The call got its slot (`threads`) or in-flight permit (`cpu`).
    fn start(&mut self, call: u32) {
        let span = self.calls[call as usize].span;
        self.record(call, "start", span, 0, NO_EDGE, true, 0);
        let c = &self.calls[call as usize];
        let (node, gen, inst) = (c.node, c.gen, c.inst as usize);
        match self.nodes[node as usize].model {
            ExecModel::Threads => {
                let lat = self.sample_latency(node, inst);
                self.schedule(self.now + lat, Ev::LocalDone { call, gen });
            }
            ExecModel::Cpu => {
                let n = &self.nodes[node as usize];
                let (mu, sigma, slices) = (n.cpu_mu, n.cpu_sigma, n.effective_calls() + 1);
                let total = self.sample(mu, sigma);
                self.calls[call as usize].slice = (total / slices as f64).max(1.0) as Time;
                self.maybe_gc(node, inst);
                self.request_cpu(call);
            }
        }
    }

    /// Run the next CPU slice of `call`, or wait for a lane.
    fn request_cpu(&mut self, call: u32) {
        let c = &self.calls[call as usize];
        let (node, inst) = (c.node, c.inst as usize);
        let n = &mut self.nodes[node as usize];
        if n.insts[inst].cpu_busy < n.lanes {
            n.account_cpu(self.now);
            n.cpu_busy += 1;
            n.insts[inst].cpu_busy += 1;
            let wake = n.wakeup;
            self.run_slice(call, wake);
        } else {
            n.insts[inst].cpu_queue.push_back(call);
            self.calls[call as usize].enq = self.now;
        }
    }

    /// `extra`: wake-up cost when the slice found its lane idle.
    fn run_slice(&mut self, call: u32, extra: Time) {
        let c = &self.calls[call as usize];
        let (node, gen, slice, inst) = (c.node, c.gen, c.slice, c.inst as usize);
        let n = &self.nodes[node as usize];
        let work = (slice + extra) as f64;
        let d = (work * n.latency_factor * n.usl(inst)).clamp(1.0, MAX_LATENCY_US) as Time;
        self.schedule(self.now + d, Ev::CpuDone { call, gen });
    }

    /// Count a request on `inst`; every `gc_every` requests one process
    /// stops the world. The pause jumps the queue (it preempts in reality).
    fn maybe_gc(&mut self, node: u32, inst: usize) {
        let n = &mut self.nodes[node as usize];
        if n.gc_every == 0 {
            return;
        }
        let i = &mut n.insts[inst];
        i.gc_count += 1;
        if i.gc_count < n.gc_every {
            return;
        }
        i.gc_count = 0;
        if i.cpu_busy < n.lanes {
            n.account_cpu(self.now);
            n.cpu_busy += 1;
            n.insts[inst].cpu_busy += 1;
            self.run_gc(node, inst);
        } else {
            i.cpu_queue.push_front(GC_JOB);
        }
    }

    fn run_gc(&mut self, node: u32, inst: usize) {
        let pause = self.nodes[node as usize].gc_pause as f64 * (0.5 + self.rng.f64());
        self.schedule(
            self.now + (pause as Time).max(1),
            Ev::GcDone {
                node,
                inst: inst as u32,
            },
        );
    }

    /// A CPU lane of `inst` is free: hand it to the next waiting slice.
    fn release_lane(&mut self, node: u32, inst: usize) {
        let next = self.nodes[node as usize].insts[inst].cpu_queue.pop_front();
        match next {
            Some(GC_JOB) => self.run_gc(node, inst),
            Some(next) => {
                let lag = self.now - self.calls[next as usize].enq;
                let n = &mut self.nodes[node as usize];
                n.lag_sum += lag as f64;
                n.lag_n += 1;
                self.run_slice(next, 0);
            }
            None => {
                let n = &mut self.nodes[node as usize];
                n.account_cpu(self.now);
                n.cpu_busy -= 1;
                n.insts[inst].cpu_busy -= 1;
            }
        }
    }

    fn on_cpu_done(&mut self, call: u32) {
        let (node, inst) = (
            self.calls[call as usize].node,
            self.calls[call as usize].inst as usize,
        );
        self.release_lane(node, inst);
        if self.calls[call as usize].step > 0 {
            self.proceed(call);
            return;
        }
        // first slice: decide failure, then the local non-CPU wait
        let (down, error_rate, io, factor) = {
            let n = &self.nodes[node as usize];
            (n.down, n.error_rate, n.io, n.latency_factor)
        };
        if down || (error_rate > 0.0 && self.rng.f64() < error_rate) {
            self.finish(call, false);
            return;
        }
        match io {
            Some((mu, sigma)) => {
                let d = (self.sample(mu, sigma) * factor).clamp(1.0, MAX_LATENCY_US) as Time;
                let gen = self.calls[call as usize].gen;
                self.schedule(self.now + d, Ev::IoDone { call, gen });
            }
            None => self.proceed(call),
        }
    }

    /// Make the next downstream call, or answer once all calls are done.
    fn proceed(&mut self, call: u32) {
        let node = self.calls[call as usize].node;
        let calls = self.nodes[node as usize].effective_calls();
        if self.calls[call as usize].step >= calls {
            self.finish(call, true);
            return;
        }
        self.calls[call as usize].attempt = 0;
        if self.nodes[node as usize].routing != Routing::Pick {
            self.fork(call);
            return;
        }
        match self.send(call) {
            Send::Sent => {}
            Send::NoEdge => self.finish(call, true),
            Send::Blocked => self.finish(call, false),
        }
    }

    /// `sequence`/`parallel`: call every edge of the current stage through
    /// its own branch (each with the edge's retry/timeout/pool policy) and
    /// continue once all awaited branches answered.
    fn fork(&mut self, call: u32) {
        let (node, step, gen, start, inst, trace, span) = {
            let c = &self.calls[call as usize];
            (
                c.node,
                c.step as usize,
                c.gen,
                c.start,
                c.inst,
                c.trace,
                c.span,
            )
        };
        let stage = self.nodes[node as usize].stages[step].clone();
        self.next_token += 1;
        let fork = self.next_token;
        let mut awaited = 0;
        for edge in stage {
            let fire_and_forget = self.edges[edge as usize].fire_and_forget;
            let parent = if fire_and_forget {
                Parent::Async
            } else {
                awaited += 1;
                Parent::Fork {
                    id: call,
                    gen,
                    fork,
                }
            };
            let b = self.alloc_call(
                node,
                parent,
                NO_EDGE,
                if fire_and_forget { self.now } else { start },
            );
            let c = &mut self.calls[b as usize];
            c.branch = true;
            c.fixed_edge = edge;
            c.inst = inst;
            c.trace = trace;
            c.span = span;
            self.send_or_give_up(b);
        }
        let c = &mut self.calls[call as usize];
        c.fork = fork;
        c.pending = awaited;
        if awaited == 0 {
            c.fork = 0;
            self.downstream_ok(call);
        }
    }

    fn on_branch_done(&mut self, call: u32, gen: u32, fork: u64, ok: bool) {
        if !self.live(call, gen) || self.calls[call as usize].fork != fork {
            return; // the fork already failed fast
        }
        let c = &mut self.calls[call as usize];
        if !ok {
            c.fork = 0;
            self.downstream_done(call, false);
            return;
        }
        c.pending -= 1;
        if c.pending == 0 {
            c.fork = 0;
            self.downstream_ok(call);
        }
    }

    /// A downstream call succeeded.
    fn downstream_ok(&mut self, call: u32) {
        let node = self.calls[call as usize].node;
        if self.calls[call as usize].branch {
            self.settle(call, true);
            return;
        }
        if node == self.client {
            self.settle(call, true);
            return;
        }
        self.calls[call as usize].step += 1;
        match self.nodes[node as usize].model {
            ExecModel::Threads => self.proceed(call),
            ExecModel::Cpu => self.request_cpu(call),
        }
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
        if self.nodes[node as usize].cache.is_some() {
            self.cache_lookup(call);
            return;
        }
        if kind == NodeKind::Cache && self.rng.f64() < hit_rate {
            self.finish(call, true);
            return;
        }
        self.proceed(call);
    }

    /// Keyspace cache: hit, join an in-flight fetch, or fetch downstream.
    fn cache_lookup(&mut self, call: u32) {
        let node = self.calls[call as usize].node as usize;
        let u = self.rng.f64();
        let now = self.now;
        let gen = self.calls[call as usize].gen;
        let c = self.nodes[node].cache.as_mut().expect("cache node");
        let key = c.key(u);
        if c.expires[key as usize] > now {
            c.hits += 1;
            self.finish(call, true);
            return;
        }
        c.misses += 1;
        if c.cfg.coalesce {
            if let Some(waiters) = c.inflight.get_mut(&key) {
                // keeps its slot until the leader's fetch answers
                waiters.push((call, gen));
                c.coalesced += 1;
                return;
            }
            c.inflight.insert(key, Vec::new());
        }
        self.calls[call as usize].key = key;
        self.proceed(call);
    }

    /// A miss fetch of `key` ended: fill the key and answer coalesced waiters.
    fn cache_filled(&mut self, node: usize, key: u32, ok: bool) {
        let u = if ok { self.rng.f64() } else { 0.0 };
        let now = self.now;
        let Some(c) = self.nodes[node].cache.as_mut() else { return };
        if ok {
            c.expires[key as usize] = c.expiry(now, u);
        }
        let waiters = if c.cfg.coalesce { c.inflight.remove(&key).unwrap_or_default() } else { Vec::new() };
        for (w, gen) in waiters {
            if self.live(w, gen) {
                self.finish(w, ok);
            }
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
        let fixed = self.calls[call as usize].fixed_edge;
        let mut chosen = None;
        if fixed != NO_EDGE {
            if self.breaker_allows(fixed) {
                chosen = Some(fixed);
            } else {
                self.edges[fixed as usize].w_short_circuits += 1;
            }
        } else {
            let start = self.nodes[node as usize].rr;
            self.nodes[node as usize].rr = start.wrapping_add(1);
            for i in 0..k {
                let e = self.nodes[node as usize].out[(start + i) % k];
                if self.breaker_allows(e) {
                    chosen = Some(e);
                    break;
                }
                self.edges[e as usize].w_short_circuits += 1;
            }
        }
        let Some(edge) = chosen else {
            return Send::Blocked;
        };
        self.calls[call as usize].out_edge = edge;
        let now = self.now;
        let gen = self.calls[call as usize].gen;
        let mut wait = None;
        if let Some(pool) = self.edges[edge as usize].pool.as_mut() {
            if pool.busy >= pool.cap {
                self.next_token += 1;
                let token = self.next_token;
                pool.waiters.push_back((call, gen, token, now));
                wait = Some((token, pool.timeout));
            } else {
                pool.account(now);
                pool.busy += 1;
                pool.wait_n += 1;
            }
        }
        if let Some((token, timeout)) = wait {
            self.calls[call as usize].pool_wait = token;
            self.calls[call as usize].pool_since = now;
            self.schedule(now + timeout, Ev::PoolTimeout { call, gen, token });
            return Send::Sent;
        }
        self.dispatch(call, edge);
        Send::Sent
    }

    /// Send the child call of `call` over `edge` (connection already held).
    fn dispatch(&mut self, call: u32, edge: u32) {
        let (gen, start_t, attempt) = {
            let c = &self.calls[call as usize];
            (c.gen, c.start, c.attempt)
        };
        let (to, timeout) = {
            let e = &mut self.edges[edge as usize];
            e.w_calls += 1;
            (e.to, e.timeout)
        };
        let lat = self.link_delay(edge, false);
        let child = self.alloc_call(to, Parent::Call { id: call, gen }, edge, start_t);
        let token = self.calls[child as usize].token;
        let child_gen = self.calls[child as usize].gen;
        self.calls[call as usize].waiting = token;
        let (trace, span, since) = {
            let c = &mut self.calls[call as usize];
            let since = std::mem::take(&mut c.pool_since);
            (c.trace, c.span, since)
        };
        self.calls[child as usize].trace = trace;
        if trace != 0 {
            let wait = if since > 0 { self.now - since } else { 0 };
            self.record(call, "send", token, span, edge, true, wait);
            // the event is about the child span, at the target node
            if let Some(ev) = self.traces.last_mut() {
                ev.node = to;
            }
        }
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
        self.emit(edge, lat, kind, trace != 0);
    }

    /// A pooled connection on `edge` is free again: hand it to the next
    /// caller still waiting for it.
    fn release_pool(&mut self, edge: u32) {
        let now = self.now;
        let Some(pool) = self.edges[edge as usize].pool.as_mut() else {
            return;
        };
        pool.account(now);
        pool.busy -= 1;
        let mut next = None;
        while let Some((call, gen, token, at)) = pool.waiters.pop_front() {
            let c = &mut self.calls[call as usize];
            if c.gen != gen || c.pool_wait != token {
                continue; // timed out meanwhile
            }
            c.pool_wait = 0;
            pool.busy += 1;
            pool.wait_sum += (now - at) as f64;
            pool.wait_n += 1;
            next = Some(call);
            break;
        }
        if let Some(call) = next {
            self.dispatch(call, edge);
        }
    }

    fn on_pool_timeout(&mut self, call: u32, gen: u32, token: u64) {
        if !self.live(call, gen) || self.calls[call as usize].pool_wait != token {
            return;
        }
        let c = &mut self.calls[call as usize];
        c.pool_wait = 0;
        c.last_timeout = false;
        let edge = c.out_edge;
        if let Some(pool) = self.edges[edge as usize].pool.as_mut() {
            pool.timeouts += 1;
        }
        self.downstream_failed(call);
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
        let span = self.calls[call as usize].span;
        self.record(call, "recv", token, span, edge, ok, 0);
        self.breaker_record(edge, ok);
        if ok {
            self.downstream_ok(call);
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
        let span = self.calls[call as usize].span;
        self.record(call, "timeout", token, span, edge, false, 0);
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
        if self.calls[call as usize].branch || self.calls[call as usize].node == self.client {
            self.settle(call, ok);
        } else {
            self.finish(call, ok);
        }
    }

    /// Release the slot held by `call` and answer its caller.
    fn finish(&mut self, call: u32, ok: bool) {
        let (node, inst) = (
            self.calls[call as usize].node,
            self.calls[call as usize].inst as usize,
        );
        let key = std::mem::replace(&mut self.calls[call as usize].key, NO_KEY);
        let n = &mut self.nodes[node as usize];
        if let Some(next) = n.insts[inst].queue.pop_front() {
            // slot handed directly to the next waiting call
            self.start(next);
        } else {
            n.account(self.now);
            n.busy -= 1;
            n.insts[inst].busy -= 1;
        }
        self.settle(call, ok);
        if key != NO_KEY {
            self.cache_filled(node as usize, key, ok);
        }
    }

    /// Schedule the response of `call` back to its parent call, if any.
    fn notify_parent(&mut self, call: u32, ok: bool) {
        let c = &self.calls[call as usize];
        if let Parent::Call { id, gen } = c.parent {
            let (edge, token, traced) = (c.edge, c.token, c.trace != 0);
            self.record(call, "reply", token, 0, edge, ok, 0);
            let lat = self.link_delay(edge, true);
            self.schedule(
                self.now + lat,
                Ev::Response {
                    call: id,
                    gen,
                    token,
                    edge,
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
                traced,
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
            Parent::Fork { id, gen, fork } => self.schedule(
                self.now,
                Ev::BranchDone {
                    call: id,
                    gen,
                    fork,
                    ok,
                },
            ),
        }
        self.free_call(call);
    }

    fn complete_user(&mut self, call: u32, ok: bool) {
        self.user_in_flight = self.user_in_flight.saturating_sub(1);
        let span = self.calls[call as usize].span;
        self.record(call, "end", span, 0, NO_EDGE, ok, 0);
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
                    n.account_cpu(end);
                    let span = self.window as f64;
                    let utilization = match n.model {
                        _ if n.slots == 0 => 0.0,
                        ExecModel::Threads if n.cap_area > 0.0 => n.busy_area / n.cap_area,
                        ExecModel::Cpu if n.cpu_cap_area > 0.0 => n.cpu_area / n.cpu_cap_area,
                        _ => 0.0,
                    }
                    .min(1.0);
                    let w = NodeWindow {
                        utilization,
                        in_flight: n.busy_area / span,
                        queue: n.queued(),
                        cpu_queue: n.cpu_queued(),
                        lag_ms: if n.lag_n > 0 {
                            us_to_ms(n.lag_sum / n.lag_n as f64)
                        } else {
                            0.0
                        },
                        arrivals: n.arrivals as f64 / secs,
                        rejected: n.rejected,
                        down: n.down,
                        instances: n.ready as u32,
                        starting: n.active.saturating_sub(n.ready) as u32,
                        cache: n.cache.as_mut().map(|c| {
                            let w = CacheWindow {
                                hits: c.hits,
                                misses: c.misses,
                                coalesced: c.coalesced,
                                filled: c.expires.iter().filter(|&&e| e > end).count() as u32,
                            };
                            c.hits = 0;
                            c.misses = 0;
                            c.coalesced = 0;
                            w
                        }),
                    };
                    n.busy_area = 0.0;
                    n.cpu_area = 0.0;
                    n.cap_area = 0.0;
                    n.cpu_cap_area = 0.0;
                    n.lag_sum = 0.0;
                    n.lag_n = 0;
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
                    let (pool_utilization, pool_wait_ms, pool_timeouts) = match e.pool.as_mut() {
                        Some(p) => {
                            p.account(end);
                            let r = (
                                (p.area / (p.cap as f64 * self.window as f64)).min(1.0),
                                if p.wait_n > 0 {
                                    us_to_ms(p.wait_sum / p.wait_n as f64)
                                } else {
                                    0.0
                                },
                                p.timeouts,
                            );
                            p.area = 0.0;
                            p.wait_sum = 0.0;
                            p.wait_n = 0;
                            p.timeouts = 0;
                            r
                        }
                        None => (0.0, 0.0, 0),
                    };
                    let w = EdgeWindow {
                        calls: e.w_calls as f64 / secs,
                        retries: e.w_retries,
                        timeouts: e.w_timeouts,
                        short_circuits: e.w_short_circuits,
                        breaker,
                        pool_utilization,
                        pool_wait_ms,
                        pool_timeouts,
                        bandwidth_utilization: (e.w_req_busy.max(e.w_res_busy)
                            / self.window as f64)
                            .min(1.0),
                    };
                    e.w_req_busy = 0.0;
                    e.w_res_busy = 0.0;
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
                dropped: w.dropped,
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
            arrival: Arrival::Poisson,
            max_concurrent: None,
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

    /// One service of 10 slots × 50 ms (200 rps per instance) with an HPA,
    /// 300 rps then a spike to 1200 rps at 20 s and back at 80 s.
    fn autoscaled(hpa: Autoscale) -> SimInput {
        let mut input = single_service(300.0, 10, 50.0);
        let svc = &mut input.design.nodes[1].config;
        svc.instances = 2;
        svc.queue_size = 20;
        svc.cost_per_hour = 1.0;
        svc.autoscale = Some(hpa);
        input.scenario.duration_ms = Some(200_000.0);
        input.scenario.traffic = vec![
            TrafficPhase { at_ms: 0.0, rps: 300.0 },
            TrafficPhase { at_ms: 20_000.0, rps: 1200.0 },
            TrafficPhase { at_ms: 80_000.0, rps: 300.0 },
        ];
        input
    }

    fn instance_series(input: &SimInput) -> (Vec<WindowMetrics>, Summary) {
        let mut sim = Simulation::new(input, false).unwrap();
        sim.run_to_end().unwrap();
        (sim.take_windows(), sim.summary())
    }

    #[test]
    fn hpa_scales_up_after_a_delay_and_back_down_after_stabilization() {
        let hpa = Autoscale {
            min: 2,
            max: 12,
            target_utilization: 0.6,
            eval_every_ms: 5_000.0,
            stabilization_ms: 30_000.0,
            pod_start_ms: 8_000.0,
            ..Autoscale::default()
        };
        let (ws, summary) = instance_series(&autoscaled(hpa));
        let at = |s: usize| ws[s].nodes[1].instances;
        // steady at 300 rps: 2 instances are 75 % busy, within reach of the target
        assert!(at(15) <= 3, "before the spike: {}", at(15));
        // the spike starts at 20 s; the first evaluation is at 25 s and new
        // instances need 8 s more: nothing new is ready before 33 s
        assert!(at(30) <= 3, "pods cannot be ready yet: {}", at(30));
        assert!(ws[22].nodes[1].rejected > 0 || ws[24].nodes[1].rejected > 0, "spike overloads before scaling");
        // 1200 rps needs 6 instances at 100 %, ~10 at 60 %
        assert!(at(70) >= 7, "scaled up during the spike: {}", at(70));
        assert!(ws.iter().all(|w| w.nodes[1].instances <= 12), "never above max");
        assert_eq!(ws[70].nodes[1].rejected, 0, "no drops once scaled");
        // back to 300 rps at 80 s: scale-down waits for the 30 s stabilization window
        assert!(at(95) >= 7, "still large right after the spike: {}", at(95));
        assert!(at(190) <= 3, "scaled back down: {}", at(190));
        // average cost is between the min and max fleet
        assert!(summary.cost_per_hour > 2.0 && summary.cost_per_hour < 12.0, "cost {}", summary.cost_per_hour);
    }

    #[test]
    fn hpa_never_goes_below_min_and_counts_starting_instances() {
        let hpa = Autoscale {
            min: 3,
            max: 4,
            target_utilization: 0.5,
            eval_every_ms: 2_000.0,
            stabilization_ms: 0.0,
            pod_start_ms: 3_000.0,
            ..Autoscale::default()
        };
        let (ws, _) = instance_series(&autoscaled(hpa));
        assert!(ws.iter().all(|w| w.nodes[1].instances >= 3 && w.nodes[1].instances <= 4));
        // the start count is clamped into [min, max]
        assert_eq!(ws[0].nodes[1].instances, 3);
        assert!(ws.iter().any(|w| w.nodes[1].starting > 0), "starting pods are reported");
    }

    /// Producers push 1000 msg/s for 30 s into a queue drained by workers of
    /// 200 msg/s each (10 slots × 50 ms), then stop.
    fn queue_workers(autoscale: Option<Autoscale>) -> SimInput {
        let mut input = SimInput {
            design: Design {
                nodes: vec![
                    node("c", NodeKind::Client, NodeConfig::default()),
                    node(
                        "q",
                        NodeKind::Queue,
                        NodeConfig {
                            concurrency: 200,
                            queue_size: 1_000_000,
                            latency_p50_ms: 0.3,
                            latency_p99_ms: 1.0,
                            ..NodeConfig::default()
                        },
                    ),
                    node(
                        "worker",
                        NodeKind::Service,
                        NodeConfig {
                            concurrency: 10,
                            queue_size: 200,
                            latency_p50_ms: 50.0,
                            latency_p99_ms: 50.0,
                            cost_per_hour: 1.0,
                            autoscale,
                            ..NodeConfig::default()
                        },
                    ),
                ],
                edges: vec![edge("c", "q"), edge("q", "worker")],
            },
            scenario: scenario(1000.0, 90_000.0),
        };
        input.scenario.timeout_ms = 600_000.0;
        input.scenario.traffic.push(TrafficPhase { at_ms: 30_000.0, rps: 0.0 });
        input
    }

    #[test]
    fn keda_scales_workers_on_the_queue_backlog_and_drains_it() {
        let keda = Autoscale {
            min: 1,
            max: 10,
            eval_every_ms: 2_000.0,
            stabilization_ms: 10_000.0,
            pod_start_ms: 3_000.0,
            metric: ScaleMetric::QueueLength,
            queue: Some("q".into()),
            target_queue_length: 500.0,
            ..Autoscale::default()
        };
        let (ws, summary) = instance_series(&queue_workers(Some(keda)));
        let workers = |s: usize| ws[s].nodes[2].instances;
        let backlog = |s: usize| ws[s].nodes[1].queue;
        assert_eq!(workers(1), 1);
        // 800 msg/s pile up; the first poll (2 s) sees ~1600 → 4 replicas, ready at 5 s
        assert!(backlog(1) > 500, "backlog builds: {}", backlog(1));
        assert!(workers(4) == 1 && workers(8) >= 5, "scaled on the backlog after the pod start: {} {}", workers(4), workers(8));
        assert_eq!(backlog(15), 0, "drained while traffic continues");
        // an empty queue reads as "no work": after the stabilization window the
        // fleet shrinks below the 5 workers 1000 msg/s needs and the backlog
        // comes back (the classic flapping of pure queue-length scaling)
        assert!((16..30).any(|s| workers(s) < 5 && backlog(s) > 0), "flaps under steady load");
        // once producers stop, the backlog drains and the fleet goes back to min
        assert_eq!(summary.backlog, 0, "drained by the end");
        assert_eq!(workers(85), 1, "back to min once the queue is empty");
        assert!(ws.iter().all(|w| w.nodes[2].instances <= 10));

        // the same workers without autoscaling never catch up
        let fixed = run(&queue_workers(None));
        assert!(fixed.backlog > 5_000, "1 worker leaves a backlog: {}", fixed.backlog);
    }

    #[test]
    fn keda_queue_must_be_a_node() {
        let keda = Autoscale {
            metric: ScaleMetric::QueueLength,
            queue: Some("nope".into()),
            ..Autoscale::default()
        };
        let err = Simulation::new(&queue_workers(Some(keda)), false).err().unwrap();
        assert!(err.contains("autoscale.queue 'nope'"), "{err}");
    }

    /// Users → cache (keyspace) → DB of ~2000 rps (20 slots × 10 ms).
    fn keyspace(rps: f64, cache: CacheModel) -> SimInput {
        SimInput {
            design: Design {
                nodes: vec![
                    node("c", NodeKind::Client, NodeConfig::default()),
                    node(
                        "cache",
                        NodeKind::Cache,
                        NodeConfig {
                            concurrency: 20_000,
                            queue_size: 0,
                            latency_p50_ms: 0.5,
                            latency_p99_ms: 0.5,
                            cache: Some(cache),
                            ..NodeConfig::default()
                        },
                    ),
                    node(
                        "db",
                        NodeKind::Database,
                        NodeConfig {
                            concurrency: 20,
                            queue_size: 200,
                            latency_p50_ms: 10.0,
                            latency_p99_ms: 10.0,
                            ..NodeConfig::default()
                        },
                    ),
                ],
                edges: vec![edge("c", "cache"), edge("cache", "db")],
            },
            scenario: scenario(rps, 40_000.0),
        }
    }

    fn hit_ratio(w: &WindowMetrics) -> f64 {
        let c = w.nodes[1].cache.unwrap();
        c.hits as f64 / (c.hits + c.misses).max(1) as f64
    }

    #[test]
    fn cold_cache_warms_up_hot_keys_first() {
        let cold = CacheModel { keys: 20_000, skew: 1.0, warm: false, ..CacheModel::default() };
        let (ws, _) = instance_series(&keyspace(1500.0, cold));
        // Zipf: the few hot keys are filled within the first second
        assert!(hit_ratio(&ws[0]) > 0.2 && hit_ratio(&ws[0]) < 0.8, "first second {}", hit_ratio(&ws[0]));
        assert!(hit_ratio(&ws[10]) > hit_ratio(&ws[1]), "keeps warming");
        assert!(hit_ratio(&ws[39]) > 0.85, "warm after 40 s: {}", hit_ratio(&ws[39]));
        let filled = |s: usize| ws[s].nodes[1].cache.unwrap().filled;
        assert!(filled(39) > filled(5) && filled(39) <= 20_000);
        // DB load follows the misses
        assert!(ws[0].nodes[2].arrivals > ws[39].nodes[2].arrivals * 3.0);
    }

    fn flush_at_10s(cache: CacheModel) -> (Vec<WindowMetrics>, Summary) {
        let mut input = keyspace(5000.0, cache);
        input.scenario.duration_ms = Some(20_000.0);
        input.scenario.events = vec![ChaosEvent { at_ms: 10_000.0, node: "cache".into(), action: ChaosAction::Flush, value: 0.0 }];
        instance_series(&input)
    }

    #[test]
    fn flush_of_hot_keys_stampedes_the_db_unless_misses_are_coalesced() {
        // an expensive query (200 ms, so the DB serves only 100 rps) behind 100 hot keys
        let hot = |coalesce: bool| {
            let mut input = keyspace(5000.0, CacheModel { keys: 100, skew: 0.0, coalesce, ..CacheModel::default() });
            input.design.nodes[2].config.latency_p50_ms = 200.0;
            input.design.nodes[2].config.latency_p99_ms = 200.0;
            input.scenario.duration_ms = Some(20_000.0);
            input.scenario.events = vec![ChaosEvent { at_ms: 10_000.0, node: "cache".into(), action: ChaosAction::Flush, value: 0.0 }];
            instance_series(&input)
        };
        let (plain, plain_sum) = hot(false);
        let (merged, merged_sum) = hot(true);
        assert!(hit_ratio(&plain[9]) > 0.999 && plain[9].nodes[2].arrivals == 0.0, "warm before the flush");
        // FLUSHALL: every request for a key misses until its fetch is back, so
        // ~1000 requests in the first 200 ms all go to a DB that serves 100 rps
        assert!(plain[10].nodes[2].arrivals > 500.0, "herd: {} DB calls", plain[10].nodes[2].arrivals);
        assert!(plain[10].nodes[2].rejected > 100, "DB overloaded: {}", plain[10].nodes[2].rejected);
        // singleflight: one fetch per key, everyone else waits for it
        assert!(merged[10].nodes[2].arrivals <= 100.0, "{} DB calls", merged[10].nodes[2].arrivals);
        assert!(merged[10].nodes[1].cache.unwrap().coalesced > 100);
        assert_eq!(merged_sum.errors, 0);
        assert!(plain_sum.errors > 100, "{}", plain_sum.errors);
    }

    #[test]
    fn coalescing_does_not_save_a_cold_long_tail() {
        // 100k keys, mild skew: after a flush most misses are for *different* keys
        let tail = |coalesce: bool| flush_at_10s(CacheModel { keys: 100_000, skew: 0.5, coalesce, ..CacheModel::default() });
        let (plain, _) = tail(false);
        let (merged, _) = tail(true);
        assert!(hit_ratio(&plain[10]) < 0.1, "cold: {}", hit_ratio(&plain[10]));
        for w in [&plain[10], &merged[10]] {
            assert!(w.nodes[2].rejected > 1000, "the DB is overloaded either way: {}", w.nodes[2].rejected);
        }
        assert!(merged[10].nodes[1].cache.unwrap().coalesced < 200);
        // it warms back up, slowly
        assert!(hit_ratio(&plain[19]) > hit_ratio(&plain[11]));
    }

    #[test]
    fn keys_filled_together_expire_together_without_ttl_jitter() {
        let worst_misses = |jitter: f64| {
            let cache = CacheModel { keys: 2_000, skew: 0.0, ttl_ms: 15_000.0, ttl_jitter: jitter, ..CacheModel::default() };
            let (ws, _) = instance_series(&keyspace(3000.0, cache));
            let misses = |s: usize| ws[s].nodes[1].cache.unwrap().misses;
            ((5..40).map(misses).max().unwrap(), misses(5))
        };
        let (wave, before) = worst_misses(0.0);
        let (spread, _) = worst_misses(0.5);
        // all 2000 keys were warmed at t = 0 and expire at 15 s
        assert!(before < 50, "warm before the TTL: {before}");
        assert!(wave > 1500, "expiry wave: {wave} misses in one second");
        assert!(spread * 3 < wave, "jitter spreads the wave: {spread} vs {wave}");
    }

    #[test]
    fn keyspace_cache_is_deterministic_and_validated_like_others() {
        let cache = CacheModel { keys: 5_000, ttl_ms: 5_000.0, ttl_jitter: 0.2, coalesce: true, ..CacheModel::default() };
        let a = run(&keyspace(2000.0, cache));
        let b = run(&keyspace(2000.0, cache));
        assert_eq!(a, b);
        // a plain cache keeps its fixed hit rate and reports no keyspace window
        let mut plain = keyspace(2000.0, cache);
        plain.design.nodes[1].config.cache = None;
        plain.design.nodes[1].config.hit_rate = 0.9;
        let (ws, _) = instance_series(&plain);
        assert!(ws[5].nodes[1].cache.is_none());
    }

    #[test]
    fn hpa_cancelled_pods_do_not_make_later_pods_ready_early() {
        let hpa = Autoscale {
            min: 1,
            max: 10,
            target_utilization: 0.6,
            eval_every_ms: 1_000.0,
            stabilization_ms: 0.0,
            pod_start_ms: 5_000.0,
            ..Autoscale::default()
        };
        let mut input = autoscaled(hpa);
        input.design.nodes[1].config.instances = 1;
        input.scenario.duration_ms = Some(14_000.0);
        // overload (scale-up at 1 s, pod due at 6 s), idle (cancelled at 3 s),
        // overload again (scale-up at 5 s, pod due at 10 s)
        input.scenario.traffic = vec![
            TrafficPhase { at_ms: 0.0, rps: 1200.0 },
            TrafficPhase { at_ms: 2_000.0, rps: 0.0 },
            TrafficPhase { at_ms: 3_500.0, rps: 1200.0 },
        ];
        let (ws, _) = instance_series(&input);
        // window `i` covers [i, i+1) s; events at exactly i s show from window i
        let w = |i: usize| (ws[i].nodes[1].instances, ws[i].nodes[1].starting);
        assert_eq!(w(1), (1, 1), "a pod starts after the first evaluation");
        assert_eq!(w(3), (1, 0), "it is cancelled once traffic stops");
        assert_eq!(w(5), (1, 1), "a new pod starts at 5 s");
        for i in 6..10 {
            assert_eq!(w(i).0, 1, "the cancelled pod's event (6 s) must not ready the new pod early, window {i}");
        }
        assert_eq!(w(10).0, 2, "the new pod is ready after its own 5 s start delay");
    }

    #[test]
    fn without_autoscale_results_are_unchanged() {
        let input = single_service(300.0, 10, 50.0);
        let (ws, s) = instance_series(&input);
        assert!(ws.iter().all(|w| w.nodes[1].instances == 1 && w.nodes[1].starting == 0));
        assert_eq!(s.cost_per_hour, 0.0);
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

    // ------------------------------------------------------------ cpu model

    fn node_api(cpu_ms: f64, lanes: u32, calls: u32) -> NodeConfig {
        NodeConfig {
            model: ExecModel::Cpu,
            cpu_lanes: lanes,
            max_in_flight: 10_000,
            queue_size: 0,
            cpu_p50_ms: cpu_ms,
            cpu_p99_ms: cpu_ms,
            calls_per_request: calls,
            ..NodeConfig::default()
        }
    }

    fn api_db_cpu(api: NodeConfig, db_ms: f64, pool: Option<u32>, rps: f64) -> SimInput {
        let mut to_db = edge("api", "db");
        to_db.pool_size = pool;
        to_db.pool_timeout_ms = 500.0;
        SimInput {
            design: Design {
                nodes: vec![
                    node("c", NodeKind::Client, NodeConfig::default()),
                    node("api", NodeKind::Service, api),
                    node(
                        "db",
                        NodeKind::Database,
                        NodeConfig {
                            concurrency: 100_000,
                            latency_p50_ms: db_ms,
                            latency_p99_ms: db_ms,
                            ..NodeConfig::default()
                        },
                    ),
                ],
                edges: vec![edge("c", "api"), to_db],
            },
            scenario: scenario(rps, 10_000.0),
        }
    }

    fn windows(input: &SimInput) -> Vec<WindowMetrics> {
        let mut sim = Simulation::new(input, false).unwrap();
        sim.run_to_end().unwrap();
        sim.take_windows()
    }

    #[test]
    fn event_loop_waits_for_io_without_using_cpu() {
        // 1 ms CPU, 100 ms DB: 500 rps keeps ~50 requests open but needs only
        // half a CPU lane. A 10-thread pool would collapse; the event loop
        // does not.
        let s = run(&api_db_cpu(node_api(1.0, 1, 1), 100.0, None, 500.0));
        assert_eq!(s.errors, 0);
        assert!(s.p99_ms < 115.0, "p99 = {}", s.p99_ms);
        let w = windows(&api_db_cpu(node_api(1.0, 1, 1), 100.0, None, 500.0));
        let api = &w[5].nodes[1];
        assert!(
            (api.utilization - 0.5).abs() < 0.08,
            "cpu = {}",
            api.utilization
        );
        assert!(
            (api.in_flight - 51.0).abs() < 8.0,
            "open = {}",
            api.in_flight
        );

        let threads = NodeConfig {
            concurrency: 10,
            queue_size: 10,
            latency_p50_ms: 1.0,
            latency_p99_ms: 1.0,
            ..NodeConfig::default()
        };
        let t = run(&api_db_cpu(threads, 100.0, None, 500.0));
        assert!(t.error_rate > 0.5, "threads err = {}", t.error_rate);
    }

    #[test]
    fn cpu_saturation_shows_as_event_loop_lag() {
        // 4 ms CPU on one lane = 250 rps max.
        let ok = windows(&api_db_cpu(node_api(4.0, 1, 1), 2.0, None, 150.0));
        let hot = windows(&api_db_cpu(node_api(4.0, 1, 1), 2.0, None, 240.0));
        let lag = |w: &[WindowMetrics]| w[5..].iter().map(|w| w.nodes[1].lag_ms).sum::<f64>() / 5.0;
        assert!(lag(&ok) < 5.0, "lag at 60% = {}", lag(&ok));
        assert!(lag(&hot) > 3.0 * lag(&ok), "lag at 96% = {}", lag(&hot));
        // two cluster processes double the capacity
        let s = run(&api_db_cpu(node_api(4.0, 2, 1), 2.0, None, 400.0));
        assert!(s.p99_ms < 60.0, "p99 with 2 lanes = {}", s.p99_ms);
        let s = run(&api_db_cpu(node_api(4.0, 1, 1), 2.0, None, 400.0));
        assert!(s.error_rate > 0.2, "1 lane at 160% = {}", s.error_rate);
    }

    #[test]
    fn sequential_calls_multiply_downstream_load() {
        let input = api_db_cpu(node_api(1.0, 1, 3), 2.0, None, 100.0);
        let s = run(&input);
        assert_eq!(s.errors, 0);
        // 3 sequential DB round trips of ~4 ms each
        assert!(s.p50_ms > 13.0 && s.p50_ms < 18.0, "p50 = {}", s.p50_ms);
        let db = arrivals(&input, 2);
        assert!((db - 300.0).abs() < 30.0, "db arrivals = {db}");
    }

    #[test]
    fn connection_pool_caps_throughput() {
        // 5 connections * (1 / ~12 ms) ≈ 415 queries/s.
        let ok = run(&api_db_cpu(node_api(0.5, 1, 1), 10.0, Some(5), 250.0));
        assert_eq!(ok.errors, 0);
        let hot = windows(&api_db_cpu(node_api(0.5, 1, 1), 10.0, Some(5), 700.0));
        let last = hot.last().unwrap();
        assert!(last.edges[1].pool_utilization > 0.95);
        assert!(last.edges[1].pool_timeouts > 0, "pool timeouts expected");
        assert!(last.error_count > 100, "errors = {}", last.error_count);
        // the rest of the system is idle: the pool is the bottleneck
        assert!(last.nodes[1].utilization < 0.5);
        // a pool per process: 2 lanes double the connections
        let two = run(&api_db_cpu(node_api(0.5, 2, 1), 10.0, Some(5), 700.0));
        assert!(
            two.error_rate < 0.01,
            "2 processes err = {}",
            two.error_rate
        );
    }

    #[test]
    fn usl_contention_lowers_peak_throughput() {
        let mk = |contention: f64| {
            let mut input = single_service(900.0, 20, 20.0);
            input.design.nodes[1].config.contention = contention;
            input
        };
        // 20 slots / 20 ms = 1000 rps linear; with contention 0.05 at N=20
        // work is ~1.95x slower, so ~510 rps.
        let linear = run(&mk(0.0));
        let contended = run(&mk(0.05));
        assert!(linear.error_rate < 0.01, "linear = {}", linear.error_rate);
        assert!(
            contended.error_rate > 0.3,
            "contended = {}",
            contended.error_rate
        );
    }

    #[test]
    fn uniform_arrivals_and_load_generator_cap() {
        let mut input = single_service(100.0, 100, 50.0);
        input.scenario.arrival = Arrival::Uniform;
        let s = run(&input);
        // exactly 2000 sent, the last ~50 ms still in flight at the end
        assert!((1990..=2000).contains(&s.total), "total = {}", s.total);
        // a 2-VU generator can only keep 2 requests of 51 ms in flight
        input.scenario.max_concurrent = Some(2);
        let s = run(&input);
        assert!(s.dropped > 0 && s.errors == 0);
        assert!(s.throughput_rps < 40.0, "rps = {}", s.throughput_rps);
    }

    #[test]
    fn instances_queue_separately_and_balancing_matters() {
        // 4 servers × 1 slot, very uneven work (p50 5 ms, p99 100 ms), ~75% busy.
        let mk = |instances: u32, concurrency: u32, balance: Balance| {
            let mut input = single_service(260.0, concurrency, 5.0);
            let c = &mut input.design.nodes[1].config;
            c.instances = instances;
            c.latency_p99_ms = 100.0;
            c.queue_size = 1000;
            c.balance = balance;
            input
        };
        let rr = run(&mk(4, 1, Balance::RoundRobin));
        let lc = run(&mk(4, 1, Balance::LeastConnections));
        let pooled = run(&mk(1, 4, Balance::RoundRobin)); // one shared queue
                                                          // a shared queue beats least-connections beats blind round-robin
        assert!(
            pooled.p99_ms < lc.p99_ms,
            "{} vs {}",
            pooled.p99_ms,
            lc.p99_ms
        );
        assert!(
            lc.p99_ms < rr.p99_ms * 0.8,
            "{} vs {}",
            lc.p99_ms,
            rr.p99_ms
        );
    }

    #[test]
    fn gc_pauses_fatten_the_tail_not_the_median() {
        let base = api_db_cpu(node_api(0.5, 1, 1), 1.0, None, 400.0);
        let mut gc = base.clone();
        gc.design.nodes[1].config.gc_pause_ms = 20.0;
        gc.design.nodes[1].config.gc_every_requests = 400; // one per second
        let (a, b) = (run(&base), run(&gc));
        assert!(
            (b.p50_ms - a.p50_ms).abs() < 0.5,
            "p50 {} vs {}",
            a.p50_ms,
            b.p50_ms
        );
        assert!(
            b.p99_ms > a.p99_ms + 5.0,
            "p99 {} vs {}",
            a.p99_ms,
            b.p99_ms
        );
    }

    #[test]
    fn wakeup_cost_makes_cpu_per_request_fall_with_load() {
        let mk = |rps: f64| {
            let mut api = node_api(0.3, 1, 0);
            api.wakeup_ms = 0.5;
            let mut input = api_db_cpu(api, 1.0, None, rps);
            input.design.edges.pop(); // api is a leaf
            input.design.nodes.pop();
            input.scenario.arrival = Arrival::Uniform;
            windows(&input)[5].nodes[1].utilization / rps * 1000.0 // CPU ms per request
        };
        let (low, high) = (mk(100.0), mk(2000.0));
        assert!(low > 0.7, "idle: every request pays the wake-up, {low}");
        assert!(high < 0.5, "busy: requests run back to back, {high}");
    }

    /// api -> {auth 20ms, db 30ms, mail 50ms} with the given routing.
    fn fan_out(routing: Routing, mail_async: bool) -> SimInput {
        let leaf = |ms: f64| NodeConfig {
            latency_p50_ms: ms,
            latency_p99_ms: ms,
            concurrency: 1000,
            ..NodeConfig::default()
        };
        let mut mail = edge("api", "mail");
        mail.fire_and_forget = mail_async;
        mail.order = 3;
        let mut db = edge("api", "db");
        db.order = 2;
        let mut auth = edge("api", "auth");
        auth.order = 1;
        SimInput {
            design: Design {
                nodes: vec![
                    node("c", NodeKind::Client, NodeConfig::default()),
                    node(
                        "api",
                        NodeKind::Service,
                        NodeConfig {
                            routing,
                            ..leaf(1.0)
                        },
                    ),
                    node("db", NodeKind::Database, leaf(30.0)),
                    node("mail", NodeKind::Service, leaf(50.0)),
                    node("auth", NodeKind::Service, leaf(20.0)),
                ],
                // declared out of order on purpose: `order` decides
                edges: vec![edge("c", "api"), mail, db, auth],
            },
            scenario: scenario(50.0, 10_000.0),
        }
    }

    #[test]
    fn routing_pick_sequence_parallel() {
        // pick: one of the three per request; network 2 ms per hop
        let pick = run(&fan_out(Routing::Pick, false));
        assert!(pick.p99_ms < 60.0 && pick.p50_ms < 40.0, "pick {pick:?}");
        // sequence: 20 + 30 + 50 + 3 round trips
        let seq = run(&fan_out(Routing::Sequence, false));
        assert!(
            (seq.p50_ms - 109.0).abs() < 4.0,
            "sequence p50 = {}",
            seq.p50_ms
        );
        // parallel: the slowest branch
        let par = run(&fan_out(Routing::Parallel, false));
        assert!(
            (par.p50_ms - 59.0).abs() < 4.0,
            "parallel p50 = {}",
            par.p50_ms
        );
        // every leaf gets every request in sequence/parallel
        for input in [
            fan_out(Routing::Sequence, false),
            fan_out(Routing::Parallel, false),
        ] {
            let ws = windows(&input);
            let w = &ws[5];
            for leaf in 2..5 {
                assert!(
                    (w.nodes[leaf].arrivals - 50.0).abs() < 20.0,
                    "{:?}",
                    w.nodes[leaf]
                );
            }
        }
    }

    #[test]
    fn fire_and_forget_is_not_awaited() {
        let s = run(&fan_out(Routing::Sequence, true));
        // auth + db only; mail is sent but not waited for
        assert!((s.p50_ms - 57.0).abs() < 4.0, "p50 = {}", s.p50_ms);
        assert!(s.async_ok > 400, "async ok = {}", s.async_ok);
    }

    #[test]
    fn parallel_fails_fast() {
        let mut input = fan_out(Routing::Parallel, false);
        input.design.nodes[4].config.error_rate = 1.0; // auth (20 ms) always fails
        let s = run(&input);
        assert_eq!(s.ok, 0);
        // failure surfaces after auth answers, without waiting for mail (50 ms)
        assert!(s.p50_ms < 30.0, "p50 = {}", s.p50_ms);
    }

    #[test]
    fn big_payloads_queue_on_the_link() {
        let mk = |kb: f64, rps: f64| {
            let mut input = single_service(rps, 1000, 1.0);
            input.design.edges[0].response_kb = kb;
            input.design.edges[0].bandwidth_mbps = 100.0;
            input
        };
        // 100 KB at 100 Mbps = 8 ms per response
        let one = run(&mk(100.0, 20.0));
        assert!((one.p50_ms - 11.0).abs() < 1.5, "p50 = {}", one.p50_ms);
        // 110 responses/s * 8 ms = 88% of the link: queueing on the wire
        let busy = windows(&mk(100.0, 110.0));
        let w = &busy[10];
        assert!(w.edges[0].bandwidth_utilization > 0.75, "{:?}", w.edges[0]);
        assert!(w.p99_ms > 40.0, "p99 = {}", w.p99_ms);
    }

    #[test]
    fn traces_record_the_request_tree() {
        let input = fan_out(Routing::Parallel, true);
        let mut sim = Simulation::new(&input, true).unwrap();
        sim.trace_next(1);
        sim.step(2000.0);
        let t = sim.take_traces();
        let sends: Vec<_> = t.iter().filter(|e| e.ev == "send").collect();
        assert_eq!(sends.len(), 4, "{t:#?}");
        let root = t.iter().find(|e| e.ev == "begin").unwrap().span;
        let api = sends.iter().find(|e| e.parent == root).unwrap().span;
        assert_eq!(sends.iter().filter(|e| e.parent == api).count(), 3);
        assert!(sends.iter().any(|e| e.fire_and_forget));
        let end = t.iter().find(|e| e.ev == "end").unwrap();
        assert!(end.ok && end.t_ms > 30.0);
        // every send gets an arrive and a reply
        for s in &sends {
            assert!(t.iter().any(|e| e.ev == "reply" && e.span == s.span));
        }
        // traced particles are flagged
        let p = sim.take_particles();
        assert!(p.chunks(4).any(|q| q[3] >= PARTICLE_TRACED));
        // only one request traced
        assert!(t.iter().all(|e| e.trace == 1));
    }
}
