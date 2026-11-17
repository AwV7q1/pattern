// Mirrors crates/engine/src/{model,sim,level}.rs (camelCase JSON).

export type NodeKind = 'client' | 'loadBalancer' | 'service' | 'cache' | 'database' | 'queue';
export const BUILDABLE: NodeKind[] = ['loadBalancer', 'service', 'cache', 'database', 'queue'];

export type ExecModel = 'threads' | 'cpu';
export type Balance = 'roundRobin' | 'leastConnections' | 'random';

export interface NodeConfig {
  instances: number;
  balance: Balance;
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
}

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
}

export const DEFAULT_POLICY: EdgePolicy = {
  latencyMs: 1,
  timeoutMs: null,
  retries: 0,
  backoffMs: 50,
  jitter: true,
  poolSize: null,
  poolTimeoutMs: 10000,
};
export const DEFAULT_BREAKER: CircuitBreaker = { failureThreshold: 0.5, minRequests: 20, windowMs: 1000, openMs: 5000 };

export interface DesignNode {
  id: string;
  kind: NodeKind;
  label: string;
  position: { x: number; y: number };
  config?: Partial<NodeConfig>;
}

export interface DesignEdge extends Partial<EdgePolicy> {
  source: string;
  target: string;
}

export interface ChaosEvent {
  atMs: number;
  node: string;
  action: 'down' | 'up' | 'latency' | 'errors';
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
