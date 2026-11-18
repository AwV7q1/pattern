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
    /// Hedged request: call the first edge; if no answer after
    /// `hedgeAfterMs`, also call the next one. The first success wins, the
    /// losers keep loading their callee. A failure moves on to the next edge
    /// at once.
    Hedge,
    /// Call every edge at once, succeed once `quorum` answered OK (default:
    /// majority), fail once that is no longer possible.
    Quorum,
}

/// Key-level cache model: requests pick keys from a Zipf distribution, keys
/// are filled on a successful miss and expire after `ttlMs`. Replaces the
/// constant `hitRate` when present.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CacheModel {
    /// Distinct keys requested.
    pub keys: u32,
    /// Zipf exponent of key popularity (0 = uniform, ~1 = typical web).
    pub zipf: f64,
    /// Entries the cache holds (LRU eviction beyond).
    pub capacity: u32,
    /// Entry lifetime; 0 = never expires.
    pub ttl_ms: f64,
    /// Singleflight: concurrent misses on one key wait for a single fill.
    pub coalesce: bool,
    /// Serve an expired entry at once and refresh it in the background.
    pub stale_while_revalidate: bool,
    /// Start full (most popular keys, expiries spread over the TTL) instead
    /// of empty.
    pub warm: bool,
}

impl Default for CacheModel {
    fn default() -> Self {
        Self {
            keys: 10_000,
            zipf: 1.0,
            capacity: 1_000,
            ttl_ms: 60_000.0,
            coalesce: false,
            stale_while_revalidate: false,
            warm: false,
        }
    }
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
    /// Cache hit ratio (0..1), only used by `cache` nodes without `cache`.
    pub hit_rate: f64,
    /// `cache` nodes: key-level model (TTL, LRU, stampede, singleflight).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache: Option<CacheModel>,
    /// `hedge` routing: delay before calling the next edge.
    pub hedge_after_ms: f64,
    /// `quorum` routing: successes needed (0 = majority of the edges).
    pub quorum: u32,
    /// Cost per instance per hour (any currency unit).
    pub cost_per_hour: f64,
    /// Horizontal autoscaling (Kubernetes HPA); `instances` is the start count.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub autoscale: Option<Autoscale>,
    /// Shed requests that waited longer than this in the queue when their
    /// turn comes (the caller has likely given up). 0 = never.
    pub queue_timeout_ms: f64,
    /// AIMD concurrency limit per instance (Netflix concurrency-limits):
    /// requests beyond the current limit are rejected at once.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adaptive_limit: Option<AdaptiveLimit>,
}

/// Adaptive concurrency limit: +1 while latency stays under `targetMs` and
/// the limit is in use, ×`backoff` when a request is slower.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AdaptiveLimit {
    pub min: u32,
    pub max: u32,
    pub initial: u32,
    /// Local processing time above which the node counts as overloaded.
    pub target_ms: f64,
    pub backoff: f64,
}

impl Default for AdaptiveLimit {
    fn default() -> Self {
        Self {
            min: 5,
            max: 200,
            initial: 20,
            target_ms: 50.0,
            backoff: 0.9,
        }
    }
}

/// What the autoscaler follows.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ScaleMetric {
    /// Slot or CPU utilization (Kubernetes HPA).
    #[default]
    Utilization,
    /// Messages waiting in a queue (KEDA): replicas = backlog / target.
    QueueLength,
}

/// HPA-like autoscaler: every `eval_every_ms`, desired replicas =
/// `ceil(current × utilization / target)` within `[min, max]`, ignoring
/// changes within ±10 %. Scale-up is immediate but new instances take
/// `pod_start_ms` before receiving traffic; scale-down uses the highest
/// recommendation of the last `stabilization_ms`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Autoscale {
    pub min: u32,
    pub max: u32,
    /// Target utilization of slots (`threads`) or CPU (`cpu`), 0..1.
    pub target_utilization: f64,
    pub eval_every_ms: f64,
    pub stabilization_ms: f64,
    pub pod_start_ms: f64,
    pub metric: ScaleMetric,
    /// `queueLength`: node whose backlog is followed (default: this node).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_source: Option<String>,
    /// `queueLength`: messages per replica (KEDA `queueLength`).
    pub target_queue_per_instance: f64,
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
            metric: ScaleMetric::Utilization,
            queue_source: None,
            target_queue_per_instance: 100.0,
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
            cache: None,
            hedge_after_ms: 50.0,
            quorum: 0,
            cost_per_hour: 0.0,
            autoscale: None,
            queue_timeout_ms: 0.0,
            adaptive_limit: None,
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
    /// Caller-side token bucket: calls beyond it fail at once (429).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate_limit: Option<RateLimit>,
    /// Retries allowed only while they stay a fraction of the traffic
    /// (Finagle / gRPC retry budget), which stops retry storms.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_budget: Option<RetryBudget>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RateLimit {
    pub rps: f64,
    /// Bucket size: calls allowed back to back.
    pub burst: f64,
}

impl Default for RateLimit {
    fn default() -> Self {
        Self {
            rps: 1000.0,
            burst: 100.0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RetryBudget {
    /// Retries per first attempt (0.1 = at most +10 % load).
    pub ratio: f64,
    /// Retries always allowed per second, for low traffic.
    pub min_per_sec: f64,
}

impl Default for RetryBudget {
    fn default() -> Self {
        Self {
            ratio: 0.1,
            min_per_sec: 10.0,
        }
    }
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
            rate_limit: None,
            retry_budget: None,
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
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub node: String,
    /// More nodes hit at once (a whole zone).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<String>,
    /// `partition` / `heal`: the link between two nodes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge: Option<EdgeRef>,
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
    /// `cache` nodes with a key-level model: drop every entry (restart,
    /// deploy, `FLUSHALL`).
    Flush,
    /// The edge silently drops traffic both ways (only timeouts notice).
    Partition,
    /// End of a partition.
    Heal,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct EdgeRef {
    pub source: String,
    pub target: String,
}

/// Random outages, generated deterministically from `seed`: every
/// `everyMs` one of `targets` goes down for `downMs`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ChaosMonkey {
    pub every_ms: f64,
    pub down_ms: f64,
    /// Node ids; empty = every node except the client.
    pub targets: Vec<String>,
    pub seed: u64,
}

impl Default for ChaosMonkey {
    fn default() -> Self {
        Self {
            every_ms: 20_000.0,
            down_ms: 5_000.0,
            targets: Vec::new(),
            seed: 7,
        }
    }
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chaos_monkey: Option<ChaosMonkey>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SimInput {
    pub design: Design,
    pub scenario: Scenario,
}
