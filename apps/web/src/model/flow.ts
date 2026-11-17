import type { Edge, Node } from '@xyflow/react';
import {
  DEFAULT_CONFIG,
  DEFAULT_POLICY,
  type Design,
  type DesignEdge,
  type EdgePolicy,
  type EdgeWindow,
  type NodeConfig,
  type NodeKind,
  type NodeWindow,
} from '@/types';

export type SystemNodeData = {
  /** Position in the engine's node array (metrics are indexed by it). */
  index: number;
  label: string;
  kind: NodeKind;
  config: NodeConfig;
  metrics?: NodeWindow;
  down: boolean;
  locked: boolean;
};
export type SystemNodeType = Node<SystemNodeData, 'system'>;

export type FlowEdgeData = {
  /** Position in the engine's edge array (particles and metrics use it). */
  index: number;
  policy: EdgePolicy;
  metrics?: EdgeWindow;
};
export type FlowEdgeType = Edge<FlowEdgeData, 'flow'>;

export function policyOf(e: DesignEdge): EdgePolicy {
  return {
    latencyMs: e.latencyMs ?? DEFAULT_POLICY.latencyMs,
    timeoutMs: e.timeoutMs ?? null,
    retries: e.retries ?? 0,
    backoffMs: e.backoffMs ?? DEFAULT_POLICY.backoffMs,
    jitter: e.jitter ?? true,
    circuitBreaker: e.circuitBreaker ?? null,
  };
}

export function toFlow(
  design: Design,
  locked: string[] = [],
  catalog: Record<string, NodeConfig> = {},
): { nodes: SystemNodeType[]; edges: FlowEdgeType[] } {
  return {
    nodes: design.nodes.map((n, index) => ({
      id: n.id,
      type: 'system',
      position: n.position,
      deletable: !locked.includes(n.id) && n.kind !== 'client',
      data: {
        index,
        label: n.label,
        kind: n.kind,
        config: { ...DEFAULT_CONFIG, ...catalog[n.kind], ...n.config },
        down: false,
        locked: locked.includes(n.id),
      },
    })),
    edges: design.edges.map((e, index) => ({
      id: `e-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: 'flow',
      data: { index, policy: policyOf(e) },
    })),
  };
}

/**
 * Renumber after a structural change. Always returns fresh `data` objects so
 * every edge re-renders and republishes its geometry under its new index.
 */
export function reindex(nodes: SystemNodeType[], edges: FlowEdgeType[]) {
  return {
    nodes: nodes.map((n, index) => ({ ...n, data: { ...n.data, index, metrics: undefined } })),
    edges: edges.map((e, index) => ({
      ...e,
      data: { policy: e.data?.policy ?? DEFAULT_POLICY, index, metrics: undefined },
    })),
  };
}

/** Engine input format, in index order. Positions and labels are kept for export. */
export function toDesign(nodes: SystemNodeType[], edges: FlowEdgeType[]): Design {
  const ns = [...nodes].sort((a, b) => a.data.index - b.data.index);
  const es = [...edges].sort((a, b) => a.data!.index - b.data!.index);
  return {
    nodes: ns.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      label: n.data.label,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      config: n.data.config,
    })),
    edges: es.map((e) => {
      const p = e.data!.policy;
      const out: DesignEdge = { source: e.source, target: e.target, latencyMs: p.latencyMs };
      if (p.timeoutMs) out.timeoutMs = p.timeoutMs;
      if (p.retries) {
        out.retries = p.retries;
        out.backoffMs = p.backoffMs;
        out.jitter = p.jitter;
      }
      if (p.circuitBreaker) out.circuitBreaker = p.circuitBreaker;
      return out;
    }),
  };
}

/** Would adding source -> target create a cycle (target already reaches source)? */
export function wouldCycle(edges: { source: string; target: string }[], source: string, target: string) {
  const out = new Map<string, string[]>();
  edges.forEach((e) => out.set(e.source, [...(out.get(e.source) ?? []), e.target]));
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === source) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(out.get(n) ?? []));
  }
  return false;
}

export function uniqueId(kind: NodeKind, taken: Set<string>) {
  for (let i = 1; ; i++) {
    const id = `${kind}-${i}`;
    if (!taken.has(id)) return id;
  }
}
