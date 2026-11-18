// Mirrors crates/engine/src/{model,sim,level}.rs (camelCase JSON).

export type NodeKind = 'client' | 'loadBalancer' | 'service' | 'cache' | 'database' | 'queue';
export const BUILDABLE: NodeKind[] = ['loadBalancer', 'service', 'cache', 'database', 'queue'];

export type ExecModel = 'threads' | 'cpu';
export type Balance = 'roundRobin' | 'leastConnections' | 'random';
/** Several outgoing edges: pick one (LB), call all one after another, or all at once. */
export type Routing = 'pick' | 'sequence' | 'parallel';

export interface NodeConfig {
  instances: number;
  balance: Balance;
  routing: Routing;
  /** `threads`: slot held for the whole request. `cpu`: event loop / CPU lanes. */
  model: ExecModel;
  concurrency: number;
  queueSize: number;
  latencyP50Ms: number;
  latencyP99Ms: number;
  cpuLanes: number;
  maxInFlight: number;
  cpuP50Ms: number;
  cpuP99Ms: number;
  ioP50Ms: number;
  ioP99Ms: number;
  callsPerRequest: number;
  contention: number;
  coherency: number;
  wakeupMs: number;
  gcPauseMs: number;
  gcEveryRequests: number;
  errorRate: number;
  hitRate: number;
  costPerHour: number;
  /** Kubernetes HPA-like autoscaling; `instances` is the start count. */
  autoscale?: Autoscale | null;
  /** Parallel stages: succeed once this many awaited branches did (0 = all). */
  quorum?: number;
  /** Cache nodes: simulate the keyspace (hit rate emerges) instead of `hitRate`. */
  cache?: CacheModel | null;
  /** Handlers sharing the node's instances, slots, CPU and pools; each makes its own calls. */
  endpoints?: Endpoint[];
}

/** One handler of a node (`POST /orders`). */
export interface Endpoint {
  name: string;
  /** The node's routing when absent. */
  routing?: Routing | null;
  /** Processing time relative to the node's latency / CPU. */
  work?: number;
  /** `pick` routing: calls per request; the node's when absent. */
  callsPerRequest?: number | null;
}

export interface CacheModel {
  /** Distinct keys requested. */
  keys: number;
  /** Zipf exponent of key popularity: 0 = uniform, ~1 = typical. */
  skew: number;
  /** 0 = never expires. */
  ttlMs: number;
  /** ±fraction applied to each TTL (0..1). */
  ttlJitter: number;
  /** Singleflight: concurrent misses on one key share one fetch. */
  coalesce: boolean;
  /** Start full instead of cold. */
  warm: boolean;
}

export const DEFAULT_CACHE_MODEL: CacheModel = { keys: 10000, skew: 1, ttlMs: 0, ttlJitter: 0, coalesce: false, warm: true };

export interface Autoscale {
  min: number;
  max: number;
  targetUtilization: number;
  evalEveryMs: number;
  stabilizationMs: number;
  podStartMs: number;
  /** `queueLength`: KEDA-style, replicas = ⌈backlog / targetQueueLength⌉. */
  metric?: 'utilization' | 'queueLength';
  /** Queue node whose backlog is watched; the node's own waiting requests when absent. */
  queue?: string | null;
  /** Backlog one replica should absorb. */
  targetQueueLength?: number;
}

export const DEFAULT_AUTOSCALE: Autoscale = {
  min: 2,
  max: 10,
  targetUtilization: 0.6,
  evalEveryMs: 15000,
  stabilizationMs: 60000,
  podStartMs: 10000,
};

export const DEFAULT_TARGET_QUEUE_LENGTH = 100;

export interface CircuitBreaker {
  failureThreshold: number;
  minRequests: number;
  windowMs: number;
  openMs: number;
}

/** Caller-side policy of an edge. */
export interface EdgePolicy {
  latencyMs: number;
  timeoutMs?: number | null;
  retries: number;
  backoffMs: number;
  jitter: boolean;
  circuitBreaker?: CircuitBreaker | null;
  /** Connections per caller process (Prisma `connection_limit`). */
  poolSize?: number | null;
  poolTimeoutMs?: number;
  /** `sequence` routing: lower first, equal orders run together. */
  order?: number;
  /** Do not wait for the answer (emit event, send email). */
  fireAndForget?: boolean;
  /** Hedged request: send a second copy if no answer after this many ms. */
  hedgeAfterMs?: number | null;
  /** Source endpoint whose handler makes this call; every endpoint when absent. */
  fromEndpoint?: string | null;
  /** Endpoint called on the target; the caller's path passes through when absent. */
  toEndpoint?: string | null;
  requestKb?: number;
  responseKb?: number;
  bandwidthMbps?: number;
}

export const DEFAULT_POLICY: EdgePolicy = {
  latencyMs: 1,
  timeoutMs: null,
  retries: 0,
  backoffMs: 50,
  jitter: true,
  poolSize: null,
  poolTimeoutMs: 10000,
  order: 0,
  fireAndForget: false,
  hedgeAfterMs: null,
  requestKb: 0,
  responseKb: 0,
  bandwidthMbps: 1000,
};
export const DEFAULT_BREAKER: CircuitBreaker = { failureThreshold: 0.5, minRequests: 20, windowMs: 1000, openMs: 5000 };

export interface DesignNode {
  id: string;
  kind: NodeKind;
  label: string;
  position: { x: number; y: number };
  config?: Partial<NodeConfig>;
  /** Real-world technology (apps/web/src/tech/catalog.ts); the engine ignores it. */
  tech?: string;
  /** Canvas group (namespace, node pool…) it sits in; the engine ignores it. */
  group?: string;
}

export interface DesignEdge extends Partial<EdgePolicy> {
  source: string;
  target: string;
}

export interface ChaosEvent {
  atMs: number;
  node: string;
  action: 'down' | 'up' | 'latency' | 'errors' | 'flush';
  value?: number;
}

export interface Scenario {
  seed: number;
  durationMs?: number;
  timeoutMs: number;
  traffic: { atMs: number; rps: number }[];
  slo: { p99Ms: number; errorRate: number };
  windowMs: number;
  events?: ChaosEvent[];
  budgetPerHour?: number | null;
  arrival?: 'poisson' | 'uniform';
  maxConcurrent?: number | null;
  /** Request mix: each user request is one type, drawn by weight. */
  requests?: RequestType[];
  /** Async boundaries a message may cross before it is dropped (default 16). */
  maxAsyncHops?: number;
}

export interface RequestType {
  name: string;
  weight: number;
  /** Path the request enters with (an endpoint name). */
  endpoint?: string | null;
}

export interface Design {
  nodes: DesignNode[];
  edges: DesignEdge[];
}

export interface Preset {
  title: string;
  description: string;
  design: Design;
  scenario: Scenario;
}

export interface Level extends Preset {
  id: string;
  brief: string;
  hint?: string;
  palette: NodeKind[];
  locked: string[];
  maxInstances?: number;
  allowFireAndForget?: boolean;
}

export interface NodeWindow {
  utilization: number;
  inFlight: number;
  queue: number;
  cpuQueue: number;
  lagMs: number;
  arrivals: number;
  rejected: number;
  down: boolean;
  /** Instances receiving traffic (changes with autoscale). */
  instances: number;
  /** Autoscaled instances still starting. */
  starting: number;
  /** Keyspace caches only. */
  cache?: { hits: number; misses: number; coalesced: number; filled: number };
}

export interface EdgeWindow {
  calls: number;
  retries: number;
  timeouts: number;
  shortCircuits: number;
  /** Extra copies sent by hedging. */
  hedges?: number;
  breaker: 'closed' | 'open' | 'halfOpen';
  poolUtilization: number;
  poolWaitMs: number;
  poolTimeouts: number;
  bandwidthUtilization: number;
}

/** One step of a traced request (crates/engine/src/sim.rs `TraceEvent`). */
export interface TraceEvent {
  trace: number;
  /** `hedge`: a second copy of a slow attempt (edge `hedgeAfterMs`). */
  ev: 'begin' | 'send' | 'hedge' | 'arrive' | 'start' | 'reject' | 'reply' | 'recv' | 'timeout' | 'end';
  span: number;
  parent: number;
  node: number;
  edge: number | null;
  tMs: number;
  ok: boolean;
  attempt: number;
  waitMs: number;
  fireAndForget: boolean;
  /** Index into the node's `endpoints`, when it declares some. */
  endpoint?: number;
}

export interface WindowMetrics {
  tMs: number;
  rps: number;
  errorRps: number;
  okCount: number;
  errorCount: number;
  timeoutCount: number;
  asyncOk: number;
  asyncErr: number;
  retries: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  sloOk: boolean;
  /** Async messages dropped by the hop limit (an event loop). */
  loopDropped?: number;
  /** Per request type, same order as `scenario.requests`. */
  requests?: { rps: number; errorRps: number; p50Ms: number; p99Ms: number }[];
  nodes: NodeWindow[];
  edges: EdgeWindow[];
}

export interface Summary {
  durationMs: number;
  total: number;
  ok: number;
  errors: number;
  timeouts: number;
  retries: number;
  dropped: number;
  errorRate: number;
  throughputRps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  costPerHour: number;
  slo: { p99Ms: number; errorRate: number };
  sloPass: boolean;
  sloWindowRatio: number;
  budgetPerHour: number | null;
  backlog: number;
  loopDropped?: number;
  requests?: RequestSummary[];
  stars: number;
}

export interface RequestSummary {
  name: string;
  total: number;
  ok: number;
  errors: number;
  timeouts: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export const DEFAULT_CONFIG: NodeConfig = {
  instances: 1,
  balance: 'roundRobin',
  routing: 'pick',
  model: 'threads',
  concurrency: 100,
  queueSize: 100,
  latencyP50Ms: 1,
  latencyP99Ms: 5,
  cpuLanes: 1,
  maxInFlight: 10000,
  cpuP50Ms: 1,
  cpuP99Ms: 5,
  ioP50Ms: 0,
  ioP99Ms: 0,
  callsPerRequest: 1,
  contention: 0,
  coherency: 0,
  wakeupMs: 0,
  gcPauseMs: 0,
  gcEveryRequests: 0,
  errorRate: 0,
  hitRate: 0,
  costPerHour: 0,
};

// ---------------------------------------------------------------- sizing (crates/engine/src/sizing.rs)

export interface Plan {
  name: string;
  vcpu: number;
  ramGb: number;
  pricePerMonth: number;
  dedicated: boolean;
}

export interface SizingSpec {
  traffic: {
    peakRps: number;
    dailyActiveUsers: number;
    requestsPerUser: number;
    peakFactor: number;
    burstFactor: number;
  };
  app: {
    cpuMsP50: number;
    cpuMsP99: number;
    queriesPerRequest: number;
    ramMbPerProcess: number;
    poolPerProcess: number;
  };
  db: {
    queryMsP50: number;
    queryMsP99: number;
    cpuFraction: number;
    maxConnections: number;
    hotDataGb: number;
  };
  cpuSpeedRatio: number;
  responseKb: number;
  clientLatencyMs: number;
  slo: { p99Ms: number; errorRate: number };
  targetUtilization: number;
  redundancy: boolean;
  plans: Plan[];
  loadBalancerPerMonth: number;
  opsPerServerMonth: number;
  maxAppServers: number;
  simSeconds: number;
  maxSimulated: number;
  seed: number;
}

export interface SizingCheck {
  name: string;
  rps: number;
  required: boolean;
  pass: boolean;
  p50Ms: number;
  p99Ms: number;
  errorRate: number;
  appUtilization: number;
  dbUtilization: number;
  poolUtilization: number;
  eventLoopLagMs: number;
}

export interface SizingCandidate {
  appPlan: Plan;
  appServers: number;
  dbPlan: Plan;
  monthlyCost: number;
  poolPerProcess: number;
  appUtilization: number;
  dbUtilization: number;
  analyticOk: boolean;
  checks: SizingCheck[];
  simulated: boolean;
  pass: boolean;
}

export interface SizingReport {
  analytic: {
    peakRps: number;
    designRps: number;
    appCpuMs: number;
    appCoresBusy: number;
    appCoresNeeded: number;
    appRamGbPerCore: number;
    dbCoresBusy: number;
    dbCoresNeeded: number;
    dbConnectionsBusy: number;
    bandwidthMbps: number;
    monthlyTrafficGb: number;
  };
  candidates: SizingCandidate[];
  recommended: number | null;
  ruleOfThumb: number | null;
  notes: string[];
  input: { design: Design; scenario: Scenario } | null;
}

// ----------------------------------------------------------- calibration (crates/engine/src/calibrate.rs)

export interface Measurement {
  name: string;
  offeredRps: number;
  durationMs: number;
  okRps: number;
  errorRate: number;
  droppedRps: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface Predicted {
  okRps: number;
  errorRate: number;
  droppedRps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  nodeUtilization: number[];
  nodeInFlight: number[];
  nodeLagMs: number[];
  poolUtilization: number[];
}

export interface CalibrationResult {
  report: {
    params: { key: string; before: number; after: number; multiplier: boolean; atBound: boolean }[];
    levels: { measured: Measurement; before: Predicted; after: Predicted }[];
    lossBefore: number;
    lossAfter: number;
    evaluations: number;
    design: Design;
  };
  fit: string[];
  capacityRps: number;
  slo: { p99Ms: number; errorRate: number };
}
