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
  type Routing,
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
  /** Derived for drawing (see `decorateEdges`), never stored. */
  view?: EdgeView;
};

export interface EdgeView {
  /** Slot of this edge among the source's outgoing / target's incoming edges. */
  outSlot: number;
  outCount: number;
  inSlot: number;
  inCount: number;
  /** Routing of the source node. */
  routing: Routing;
  /** 1-based step for `sequence` routing (equal steps run together). */
  step: number;
  steps: number;
}
export type FlowEdgeType = Edge<FlowEdgeData, 'flow'>;

export function policyOf(e: DesignEdge): EdgePolicy {
  return {
    latencyMs: e.latencyMs ?? DEFAULT_POLICY.latencyMs,
    timeoutMs: e.timeoutMs ?? null,
    retries: e.retries ?? 0,
    backoffMs: e.backoffMs ?? DEFAULT_POLICY.backoffMs,
    jitter: e.jitter ?? true,
    circuitBreaker: e.circuitBreaker ?? null,
    poolSize: e.poolSize ?? null,
    poolTimeoutMs: e.poolTimeoutMs ?? DEFAULT_POLICY.poolTimeoutMs,
    order: e.order ?? 0,
    fireAndForget: e.fireAndForget ?? false,
    requestKb: e.requestKb ?? 0,
    responseKb: e.responseKb ?? 0,
    bandwidthMbps: e.bandwidthMbps ?? DEFAULT_POLICY.bandwidthMbps,
  };
}

/** Routing the engine really uses (clients and LBs always pick one edge). */
export function effectiveRouting(kind: NodeKind, config: NodeConfig): Routing {
  return kind === 'client' || kind === 'loadBalancer' ? 'pick' : (config.routing ?? 'pick');
}

/**
 * Drawing hints for every edge: spread edges that share a node side so they
 * do not overlap (sorted by the other end's height), and number the steps
 * of `sequence` routing exactly like the engine groups them.
 */
export function decorateEdges(nodes: SystemNodeType[], edges: FlowEdgeType[]): FlowEdgeType[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const y = (id: string) => byId.get(id)?.position.y ?? 0;
  const outs = new Map<string, FlowEdgeType[]>();
  const ins = new Map<string, FlowEdgeType[]>();
  for (const e of edges) {
    outs.set(e.source, [...(outs.get(e.source) ?? []), e]);
    ins.set(e.target, [...(ins.get(e.target) ?? []), e]);
  }
  const outSlot = new Map<string, number>();
  const inSlot = new Map<string, number>();
  outs.forEach((list) => [...list].sort((a, b) => y(a.target) - y(b.target)).forEach((e, i) => outSlot.set(e.id, i)));
  ins.forEach((list) => [...list].sort((a, b) => y(a.source) - y(b.source)).forEach((e, i) => inSlot.set(e.id, i)));
  const steps = new Map<string, [number, number]>();
  outs.forEach((list, src) => {
    const n = byId.get(src);
    if (!n || effectiveRouting(n.data.kind, n.data.config) !== 'sequence') return;
    const orders = [...new Set(list.map((e) => e.data?.policy.order ?? 0))].sort((a, b) => a - b);
    list.forEach((e) => steps.set(e.id, [orders.indexOf(e.data?.policy.order ?? 0) + 1, orders.length]));
  });
  return edges.map((e) => {
    const src = byId.get(e.source);
    const [step, count] = steps.get(e.id) ?? [0, 0];
    const view: EdgeView = {
      outSlot: outSlot.get(e.id) ?? 0,
      outCount: outs.get(e.source)?.length ?? 1,
      inSlot: inSlot.get(e.id) ?? 0,
      inCount: ins.get(e.target)?.length ?? 1,
      routing: src ? effectiveRouting(src.data.kind, src.data.config) : 'pick',
      step,
      steps: count,
    };
    return { ...e, data: { ...e.data!, view } };
  });
}

/** Give nodes without a position a left-to-right layout by call depth. */
export function autoLayout(design: Design): Design {
  if (design.nodes.every((n) => n.position)) return design;
  const depth = new Map<string, number>();
  const client = design.nodes.find((n) => n.kind === 'client');
  const queue = client ? [client.id] : [];
  if (client) depth.set(client.id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of design.edges.filter((e) => e.source === id)) {
      if (!depth.has(e.target)) {
        depth.set(e.target, depth.get(id)! + 1);
        queue.push(e.target);
      }
    }
  }
  const rows = new Map<number, number>();
  return {
    ...design,
    nodes: design.nodes.map((n) => {
      const d = depth.get(n.id) ?? 0;
      const row = rows.get(d) ?? 0;
      rows.set(d, row + 1);
      return {
        ...n,
        label: n.label ?? n.id,
        position: n.position ?? { x: d * 340, y: 160 + row * 170 },
      };
    }),
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
      if (p.poolSize) {
        out.poolSize = p.poolSize;
        out.poolTimeoutMs = p.poolTimeoutMs ?? DEFAULT_POLICY.poolTimeoutMs;
      }
      if (p.order) out.order = p.order;
      if (p.fireAndForget) out.fireAndForget = true;
      if (p.requestKb) out.requestKb = p.requestKb;
      if (p.responseKb) out.responseKb = p.responseKb;
      if (p.requestKb || p.responseKb) out.bandwidthMbps = p.bandwidthMbps ?? DEFAULT_POLICY.bandwidthMbps;
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
