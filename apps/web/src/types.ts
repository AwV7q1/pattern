// Mirrors crates/engine/src/{model,sim,level}.rs (camelCase JSON).

export type NodeKind = 'client' | 'loadBalancer' | 'service' | 'cache' | 'database' | 'queue';
export const BUILDABLE: NodeKind[] = ['loadBalancer', 'service', 'cache', 'database', 'queue'];

export interface NodeConfig {
  instances: number;
  concurrency: number;
  queueSize: number;
  latencyP50Ms: number;
  latencyP99Ms: number;
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
}

export const DEFAULT_POLICY: EdgePolicy = { latencyMs: 1, timeoutMs: null, retries: 0, backoffMs: 50, jitter: true };
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
  queue: number;
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
  concurrency: 100,
  queueSize: 100,
  latencyP50Ms: 1,
  latencyP99Ms: 5,
  errorRate: 0,
  hitRate: 0,
  costPerHour: 0,
};
