//! Input model shared with the UI (JSON, camelCase). Unknown fields such as
//! node `position` or `label` used only by the UI are ignored by serde.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    /// Traffic source. Exactly one per design.
    Client,
    /// Spreads requests round-robin over its outgoing edges.
    LoadBalancer,
    /// Processes a request, then calls one downstream (round-robin) if any.
    Service,
    /// Answers hits locally; forwards misses downstream.
    Cache,
    /// Usually a leaf; behaves like a service.
    Database,
    /// Fire-and-forget buffer: acknowledges immediately, delivers async.
    Queue,
}

/// How a node executes requests.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ExecModel {
    /// Thread-per-request (Java/Go pools, legacy default): a request holds
    /// one of `concurrency` slots for its whole life, including while it
    /// waits for downstream calls.
    #[default]
    Threads,
    /// CPU lanes + in-flight limit (Node.js event loop, Postgres backends):
    /// a request only needs a CPU lane while it computes (`cpuP50Ms`); while
    /// it waits for I/O or downstream calls it just counts against
    /// `maxInFlight`. CPU queueing shows up as event-loop lag.
    Cpu,
}

/// How calls are spread over the instances of a node. Each instance has
/// its own slots, queue and CPU lanes, like separate servers.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Balance {
    /// nginx / ALB default.
    #[default]
    RoundRobin,
    /// Fewest open requests (nginx `least_conn`, ALB least outstanding).
    LeastConnections,
    Random,
}

/// What a node does with several outgoing edges.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Routing {
    /// Each downstream call goes to ONE edge, round-robin (load balancer,
    /// replicas). The default, and always used by clients and LBs.
    #[default]
    Pick,
    /// Call every edge one after another (`await a(); await b();`), in edge
    /// `order`. Edges sharing an `order` run together.
    Sequence,
    /// Call every edge at once and wait for all (`Promise.all`): fails as
    /// soon as one fails, latency is the slowest branch.
    Parallel,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct NodeConfig {
    pub instances: u32,
    pub balance: Balance,
    /// Several outgoing edges: pick one, call all in sequence, or in parallel.
    pub routing: Routing,
    pub model: ExecModel,
    /// `threads`: concurrent requests per instance.
    pub concurrency: u32,
    /// Waiting requests per instance before rejecting (`cpu`: requests
    /// waiting for an in-flight slot, like the accept backlog).
    pub queue_size: u32,
    /// `threads`: local processing time (holds the slot).
    pub latency_p50_ms: f64,
    pub latency_p99_ms: f64,
    /// `cpu`: CPU lanes per instance (Node: cluster processes, DB: cores).
    pub cpu_lanes: u32,
    /// `cpu`: requests open at once per instance before queueing.
    pub max_in_flight: u32,
    /// `cpu`: CPU time per request, split evenly around downstream calls.
    pub cpu_p50_ms: f64,
    pub cpu_p99_ms: f64,
    /// `cpu`: local wait that does not use CPU (disk, unmodelled I/O),
    /// after the first CPU slice.
    pub io_p50_ms: f64,
    pub io_p99_ms: f64,
    /// Sequential downstream calls per request (e.g. N queries). Each picks
    /// the next edge round-robin and applies that edge's policy.
    pub calls_per_request: u32,
    /// Universal Scalability Law coefficients: with `N` requests active per
    /// instance, work takes `1 + contention*(N-1) + coherency*N*(N-1)` times
    /// longer (lock contention, cache-line ping-pong). 0 = linear scaling.
    pub contention: f64,
    pub coherency: f64,
    /// `cpu`: extra CPU to wake an idle process (epoll, timers, context
    /// switch), paid by a slice that finds its lane idle. When busy, slices
    /// run back to back and skip it, so CPU per request *falls* with load.
    pub wakeup_ms: f64,
    /// `cpu`: garbage-collector pause (stop-the-world) of one process, ms.
    /// 0 = no GC. A pause blocks one CPU lane, so requests behind it wait:
    /// p50 stays low while p99 grows, as with V8 or JVM GC.
    pub gc_pause_ms: f64,
    /// `cpu`: a pause every this many requests per instance (allocation
    /// driven, so pauses get more frequent with load).
    pub gc_every_requests: u32,
    /// Probability that a processed request fails (0..1).
    pub error_rate: f64,
    /// Cache hit ratio (0..1), only used by `cache` nodes.
    pub hit_rate: f64,
    /// Cost per instance per hour (any currency unit).
    pub cost_per_hour: f64,
    /// Horizontal autoscaling (Kubernetes HPA); `instances` is the start count.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub autoscale: Option<Autoscale>,
}

/// HPA-like autoscaler: every `eval_every_ms`, desired replicas =
/// `ceil(current × utilization / target)` within `[min, max]`, ignoring
/// changes within ±10 %. Scale-up is immediate but new instances take
/// `pod_start_ms` before receiving traffic; scale-down uses the highest
/// recommendation of the last `stabilization_ms`.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Autoscale {
    pub min: u32,
    pub max: u32,
    /// Target utilization of slots (`threads`) or CPU (`cpu`), 0..1.
    pub target_utilization: f64,
    pub eval_every_ms: f64,
    pub stabilization_ms: f64,
    pub pod_start_ms: f64,
}

impl Default for Autoscale {
    fn default() -> Self {
        Self {
            min: 1,
            max: 10,
            target_utilization: 0.6,
            eval_every_ms: 15_000.0,
            stabilization_ms: 60_000.0,
            pod_start_ms: 10_000.0,
        }
    }
}

impl Default for NodeConfig {
    fn default() -> Self {
        Self {
            instances: 1,
            balance: Balance::RoundRobin,
            routing: Routing::Pick,
            concurrency: 100,
            queue_size: 100,
            latency_p50_ms: 1.0,
            latency_p99_ms: 5.0,
            model: ExecModel::Threads,
            cpu_lanes: 1,
            max_in_flight: 10_000,
            cpu_p50_ms: 1.0,
            cpu_p99_ms: 5.0,
            io_p50_ms: 0.0,
            io_p99_ms: 0.0,
            calls_per_request: 1,
            contention: 0.0,
            coherency: 0.0,
            wakeup_ms: 0.0,
            gc_pause_ms: 0.0,
            gc_every_requests: 0,
            error_rate: 0.0,
            hit_rate: 0.0,
            cost_per_hour: 0.0,
            autoscale: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NodeSpec {
    pub id: String,
    pub kind: NodeKind,
    #[serde(default)]
    pub config: NodeConfig,
}

fn default_edge_latency() -> f64 {
    1.0
}

/// Circuit breaker guarding calls over one edge (caller side).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CircuitBreaker {
    /// Open when the failure ratio in the rolling window reaches this (0..1).
    pub failure_threshold: f64,
    /// Minimum calls in the window before the ratio is evaluated.
    pub min_requests: u32,
    /// Rolling window length.
    pub window_ms: f64,
    /// How long the breaker stays open before letting a probe through.
    pub open_ms: f64,
}

impl Default for CircuitBreaker {
    fn default() -> Self {
        Self {
            failure_threshold: 0.5,
            min_requests: 20,
            window_ms: 1000.0,
            open_ms: 5000.0,
        }
    }
}

fn default_backoff() -> f64 {
    50.0
}
fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EdgeSpec {
    pub source: String,
    pub target: String,
    /// One-way network latency in ms.
    #[serde(default = "default_edge_latency")]
    pub latency_ms: f64,
    /// Caller gives up after this many ms (the callee keeps working).
    /// `None` = wait forever, except on the client edge which defaults to
    /// `scenario.timeoutMs`.
    #[serde(default)]
    pub timeout_ms: Option<f64>,
    /// Extra attempts after a failure or timeout.
    #[serde(default)]
    pub retries: u32,
    /// Base backoff; attempt `n` waits `backoffMs * 2^(n-1)`.
    #[serde(default = "default_backoff")]
    pub backoff_ms: f64,
    /// Randomise backoff in [0.5, 1.5) to de-synchronise retries.
    #[serde(default = "default_true")]
    pub jitter: bool,
    #[serde(default)]
    pub circuit_breaker: Option<CircuitBreaker>,
    /// Connection pool per caller process (Prisma/TypeORM/HikariCP). Total
    /// connections = poolSize * source instances * processes (`cpuLanes` for
    /// `cpu` nodes, 1 otherwise). A connection stays busy until the callee
    /// answers, even when the caller already timed out.
    #[serde(default)]
    pub pool_size: Option<u32>,
    /// Give up waiting for a free connection after this long (Prisma
    /// `pool_timeout`, default 10 s). Counts as a failed attempt.
    #[serde(default = "default_pool_timeout")]
    pub pool_timeout_ms: f64,
    /// Position of this call when the source node uses `sequence` routing
    /// (lower first; equal orders run together). Ignored by `pick`.
    #[serde(default)]
    pub order: u32,
    /// `sequence`/`parallel`: send without waiting for the answer (emit an
    /// event, send an email). Its outcome is counted as async.
    #[serde(default)]
    pub fire_and_forget: bool,
    /// Request and response body sizes in KB. With `bandwidthMbps` they add
    /// a transfer time, and big bodies queue behind each other on the link.
    #[serde(default)]
    pub request_kb: f64,
    #[serde(default)]
    pub response_kb: f64,
    /// Link capacity per direction (full duplex), shared by all calls.
    #[serde(default = "default_bandwidth")]
    pub bandwidth_mbps: f64,
}

fn default_bandwidth() -> f64 {
    1000.0
}

fn default_pool_timeout() -> f64 {
    10_000.0
}

impl EdgeSpec {
    pub fn new(source: &str, target: &str, latency_ms: f64) -> Self {
        Self {
            source: source.into(),
            target: target.into(),
            latency_ms,
            timeout_ms: None,
            retries: 0,
            backoff_ms: default_backoff(),
            jitter: true,
            circuit_breaker: None,
            pool_size: None,
            pool_timeout_ms: default_pool_timeout(),
            order: 0,
            fire_and_forget: false,
            request_kb: 0.0,
            response_kb: 0.0,
            bandwidth_mbps: default_bandwidth(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Design {
    pub nodes: Vec<NodeSpec>,
    pub edges: Vec<EdgeSpec>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrafficPhase {
    pub at_ms: f64,
    pub rps: f64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Slo {
    pub p99_ms: f64,
    pub error_rate: f64,
}

impl Default for Slo {
    fn default() -> Self {
        Self {
            p99_ms: 200.0,
            error_rate: 0.01,
        }
    }
}

/// Scripted fault injected at a given simulated time.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChaosEvent {
    pub at_ms: f64,
    /// Node id.
    pub node: String,
    pub action: ChaosAction,
    /// `latency`: multiplier on processing time; `errors`: error rate.
    #[serde(default)]
    pub value: f64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChaosAction {
    /// Node fails fast and drops its queue.
    Down,
    /// Node recovers; latency and error overrides are cleared.
    Up,
    /// Processing becomes `value` times slower.
    Latency,
    /// Error rate becomes `value`.
    Errors,
}

fn default_timeout() -> f64 {
    2000.0
}
fn default_window() -> f64 {
    1000.0
}

/// How the client spaces user requests.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Arrival {
    /// Independent users (exponential gaps). Real traffic.
    #[default]
    Poisson,
    /// Fixed gaps, like k6 `constant-arrival-rate`.
    Uniform,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    #[serde(default)]
    pub seed: u64,
    /// Required for headless runs; interactive runs ignore it.
    #[serde(default)]
    pub duration_ms: Option<f64>,
    /// Client-side timeout: slower requests count as errors.
    #[serde(default = "default_timeout")]
    pub timeout_ms: f64,
    /// Step function of request rate over time.
    pub traffic: Vec<TrafficPhase>,
    #[serde(default)]
    pub slo: Slo,
    #[serde(default = "default_window")]
    pub window_ms: f64,
    #[serde(default)]
    pub events: Vec<ChaosEvent>,
    /// Game levels: cost ceiling used for star rating.
    #[serde(default)]
    pub budget_per_hour: Option<f64>,
    #[serde(default)]
    pub arrival: Arrival,
    /// Load generator limit (k6 `maxVUs`): new requests are dropped, not
    /// failed, while this many are in flight.
    #[serde(default)]
    pub max_concurrent: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SimInput {
    pub design: Design,
    pub scenario: Scenario,
}
