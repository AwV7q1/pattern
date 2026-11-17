// Mirrors crates/engine/src/model.rs (camelCase JSON).

export type NodeKind = 'client' | 'loadBalancer' | 'service' | 'cache' | 'database' | 'queue';

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

export interface DesignNode {
  id: string;
  kind: NodeKind;
  label: string;
  position: { x: number; y: number };
  config?: Partial<NodeConfig>;
}

export interface DesignEdge {
  source: string;
  target: string;
  latencyMs?: number;
}

export interface Scenario {
  seed: number;
  durationMs?: number;
  timeoutMs: number;
  traffic: { atMs: number; rps: number }[];
  slo: { p99Ms: number; errorRate: number };
  windowMs: number;
}

export interface Preset {
  title: string;
  description: string;
  design: { nodes: DesignNode[]; edges: DesignEdge[] };
  scenario: Scenario;
}

export interface NodeWindow {
  utilization: number;
  queue: number;
  rejected: number;
  down: boolean;
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
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  sloOk: boolean;
  nodes: NodeWindow[];
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
