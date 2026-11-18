// Mirrors crates/engine/src/{model,sim,level}.rs (camelCase JSON).

export type NodeKind = 'client' | 'loadBalancer' | 'service' | 'cache' | 'database' | 'queue';
export const BUILDABLE: NodeKind[] = ['loadBalancer', 'service', 'cache', 'database', 'queue'];

export type ExecModel = 'threads' | 'cpu';
export type Balance = 'roundRobin' | 'leastConnections' | 'random';
/** Several outgoing edges: pick one (LB), call all one after another, all at once, hedge, or quorum. */
export type Routing = 'pick' | 'sequence' | 'parallel' | 'hedge' | 'quorum';

/** Key-level cache model (crates/engine/src/model.rs `CacheModel`). */
export interface CacheModel {
  keys: number;
  zipf: number;
  capacity: number;
  ttlMs: number;
  coalesce: boolean;
  staleWhileRevalidate: boolean;
  warm: boolean;
}

export const DEFAULT_CACHE: CacheModel = {
  keys: 10000,
  zipf: 1,
  capacity: 1000,
  ttlMs: 60000,
  coalesce: false,
  staleWhileRevalidate: false,
  warm: false,
};

export interface AdaptiveLimit {
  min: number;
  max: number;
  initial: number;
  targetMs: number;
  backoff: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveLimit = { min: 5, max: 200, initial: 20, targetMs: 50, backoff: 0.9 };

export interface RateLimit {
  rps: number;
  burst: number;
}

export interface RetryBudget {
  ratio: number;
  minPerSec: number;
}

export const DEFAULT_RATE_LIMIT: RateLimit = { rps: 1000, burst: 100 };
export const DEFAULT_RETRY_BUDGET: RetryBudget = { ratio: 0.1, minPerSec: 10 };

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
  /** Key-level cache (replaces `hitRate`). */
  cache?: CacheModel | null;
  /** `hedge` routing: wait before calling the next edge. */
  hedgeAfterMs: number;
  /** `quorum` routing: successes needed, 0 = majority. */
  quorum: number;
  costPerHour: number;
  /** Kubernetes HPA-like autoscaling; `instances` is the start count. */
  autoscale?: Autoscale | null;
  /** Shed requests that waited longer than this in the queue (0 = never). */
  queueTimeoutMs: number;
  adaptiveLimit?: AdaptiveLimit | null;
}

export interface Autoscale {
  min: number;
  max: number;
  targetUtilization: number;
  evalEveryMs: number;
  stabilizationMs: number;
  podStartMs: number;
  /** `utilization` (HPA) or `queueLength` (KEDA). */
  metric?: 'utilization' | 'queueLength';
  queueSource?: string | null;
  targetQueuePerInstance?: number;
}

export const DEFAULT_AUTOSCALE: Autoscale = {
  min: 2,
  max: 10,
  targetUtilization: 0.6,
  evalEveryMs: 15000,
  stabilizationMs: 60000,
  podStartMs: 10000,
};

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
  requestKb?: number;
  responseKb?: number;
  bandwidthMbps?: number;
  rateLimit?: RateLimit | null;
  retryBudget?: RetryBudget | null;
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

export type ChaosAction = 'down' | 'up' | 'latency' | 'errors' | 'flush' | 'partition' | 'heal';

export interface ChaosEvent {
  atMs: number;
  /** Node id (or empty when `nodes` / `edge` is used). */
  node?: string;
  /** Several nodes at once (a whole zone). */
  nodes?: string[];
  /** `partition` / `heal`. */
  edge?: { source: string; target: string } | null;
  action: ChaosAction;
  value?: number;
}

export interface ChaosMonkey {
  everyMs: number;
  downMs: number;
  targets: string[];
  seed: number;
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
  chaosMonkey?: ChaosMonkey | null;
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
  /** Cache nodes: fraction of lookups answered by the cache. */
  hitRatio?: number;
}

export interface EdgeWindow {
  calls: number;
  retries: number;
  timeouts: number;
  shortCircuits: number;
  breaker: 'closed' | 'open' | 'halfOpen';
  poolUtilization: number;
  poolWaitMs: number;
  poolTimeouts: number;
  bandwidthUtilization: number;
  rateLimited: number;
  budgetExhausted: number;
  partitioned: boolean;
}

/** One step of a traced request (crates/engine/src/sim.rs `TraceEvent`). */
export interface TraceEvent {
  trace: number;
  ev: 'begin' | 'send' | 'arrive' | 'start' | 'reject' | 'reply' | 'recv' | 'timeout' | 'end';
  span: number;
  parent: number;
  node: number;
  edge: number | null;
  tMs: number;
  ok: boolean;
  attempt: number;
  waitMs: number;
  fireAndForget: boolean;
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
  stars: number;
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
  hedgeAfterMs: 50,
  quorum: 0,
  costPerHour: 0,
  queueTimeoutMs: 0,
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
