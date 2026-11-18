// Structural subset of the engine model (crates/engine/src/model.rs, camelCase
// JSON). Kept independent from the web app so the server can use the rules too.

export type NodeKind = 'client' | 'loadBalancer' | 'service' | 'cache' | 'database' | 'queue';

export interface LintAutoscale {
  min?: number;
  max?: number;
  metric?: 'utilization' | 'queueLength';
  targetUtilization?: number;
}

export interface LintCache {
  keys?: number;
  zipf?: number;
  capacity?: number;
  ttlMs?: number;
  coalesce?: boolean;
  staleWhileRevalidate?: boolean;
}

export interface LintNodeConfig {
  instances?: number;
  model?: 'threads' | 'cpu';
  routing?: 'pick' | 'sequence' | 'parallel' | 'hedge' | 'quorum';
  concurrency?: number;
  queueSize?: number;
  latencyP50Ms?: number;
  latencyP99Ms?: number;
  cpuLanes?: number;
  maxInFlight?: number;
  cpuP99Ms?: number;
  ioP99Ms?: number;
  callsPerRequest?: number;
  costPerHour?: number;
  hitRate?: number;
  cache?: LintCache | null;
  autoscale?: LintAutoscale | null;
  queueTimeoutMs?: number;
  adaptiveLimit?: object | null;
}

export interface LintNode {
  id: string;
  kind: NodeKind;
  label?: string;
  config?: LintNodeConfig;
}

export interface LintEdge {
  source: string;
  target: string;
  latencyMs?: number;
  timeoutMs?: number | null;
  retries?: number;
  backoffMs?: number;
  jitter?: boolean;
  circuitBreaker?: { failureThreshold?: number; minRequests?: number; windowMs?: number; openMs?: number } | null;
  poolSize?: number | null;
  fireAndForget?: boolean;
  requestKb?: number;
  responseKb?: number;
  bandwidthMbps?: number;
  rateLimit?: { rps: number; burst: number } | null;
  retryBudget?: { ratio: number; minPerSec: number } | null;
}

export interface LintDesign {
  nodes: LintNode[];
  edges: LintEdge[];
}

export interface LintScenario {
  timeoutMs?: number;
  traffic?: { atMs: number; rps: number }[];
  slo?: { p99Ms: number; errorRate: number };
  budgetPerHour?: number | null;
}

export type Severity = 'error' | 'warn' | 'info';

/** What a finding is about: a node, an edge (source, target) or the whole design. */
export type Target = { node: string } | { edge: [string, string] } | { design: true };

/** One field change; same target shape as the learning path's knobs. */
export interface Patch {
  target: { node: string } | { edge: [string, string] };
  /** Top-level field of the node config or the edge. */
  field: string;
  value: unknown;
}

export interface Finding {
  rule: string;
  severity: Severity;
  target: Target;
  /** One line: what is wrong here. */
  message: string;
  /** Why it matters, with the mechanism. */
  why: string;
  /** Suggested fix the UI can apply in one click. */
  fix?: { label: string; patches: Patch[] };
}
