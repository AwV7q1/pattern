import type { Edge, Node } from '@xyflow/react';
import { routeOrthogonal } from './routing';
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

/** Design-lint findings on a node or edge (derived for drawing, never stored). */
export type LintBadge = { count: number; worst: 'error' | 'warn' | 'info' };

export type SystemNodeData = {
  /** Position in the engine's node array (metrics are indexed by it). */
  index: number;
  lint?: LintBadge;
  label: string;
  kind: NodeKind;
  config: NodeConfig;
  metrics?: NodeWindow;
  down: boolean;
  locked: boolean;
  /** Real-world technology id (tech/catalog.ts). */
  tech?: string;
};
export type SystemNodeType = Node<SystemNodeData, 'system'>;

export type FlowEdgeData = {
  /** Position in the engine's edge array (particles and metrics use it). */
  index: number;
  policy: EdgePolicy;
  metrics?: EdgeWindow;
  /** Derived for drawing (see `decorateEdges`), never stored. */
  view?: EdgeView;
  lint?: LintBadge;
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
  /** Position among edges joining the same source and target (a bundle). */
  pairSlot: number;
  pairCount: number;
  /** Handler → endpoint routes of the whole bundle, set on its first edge only. */
  routes?: string[];
  /**
   * Back edge (callee left of caller): the y, in flow coordinates, its loop
   * must reach to pass below (or above) every node between both ends.
   */
  backY?: number;
  /** Stacked nodes, curve style: joined bottom-to-top (or top-to-bottom) at these points. */
  vertical?: { sx: number; sy: number; tx: number; ty: number };
  /** Orthogonal style: the routed polyline `[x0, y0, x1, y1, …]` in flow coordinates. */
  route?: number[];
}
export type EdgeStyleMode = 'curve' | 'orthogonal';

/** Vertical gap between edges that leave or enter the same side of a node. */
export function fanOffset(slot: number, count: number) {
  if (count <= 1) return 0;
  return (slot - (count - 1) / 2) * Math.min(14, 64 / (count - 1));
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
    rateLimit: e.rateLimit ?? null,
    retryBudget: e.retryBudget ?? null,
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
export function decorateEdges(nodes: SystemNodeType[], edges: FlowEdgeType[], style: EdgeStyleMode = 'curve'): FlowEdgeType[] {
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
  outs.forEach((list) => [...list].sort((a, b) => y(a.target) - y(b.target) || a.target.localeCompare(b.target)).forEach((e, i) => outSlot.set(e.id, i)));
  ins.forEach((list) => [...list].sort((a, b) => y(a.source) - y(b.source) || a.source.localeCompare(b.source)).forEach((e, i) => inSlot.set(e.id, i)));
  const steps = new Map<string, [number, number]>();
  outs.forEach((list, src) => {
    const n = byId.get(src);
    if (!n || effectiveRouting(n.data.kind, n.data.config) !== 'sequence') return;
    const orders = [...new Set(list.map((e) => e.data?.policy.order ?? 0))].sort((a, b) => a - b);
    list.forEach((e) => steps.set(e.id, [orders.indexOf(e.data?.policy.order ?? 0) + 1, orders.length]));
  });
  // edges joining the same pair are drawn as one bundle with one label box
  const pairs = new Map<string, FlowEdgeType[]>();
  for (const e of edges) {
    const k = `${e.source}\u0000${e.target}`;
    pairs.set(k, [...(pairs.get(k) ?? []), e]);
  }
  // handler → endpoint labels need per-edge endpoints, which this engine does not model yet
  const route = (_e: FlowEdgeType): string | null => null;
  // Back edges loop around every node spanned horizontally, on the side
  // that makes the shorter detour; loops sharing a side are nested.
  const box = (n: SystemNodeType) => {
    const w = n.measured?.width ?? 200;
    const h = n.measured?.height ?? 110;
    return { l: n.position.x, r: n.position.x + w, t: n.position.y, b: n.position.y + h, cy: n.position.y + h / 2 };
  };
  // Stacked nodes (one mostly above the other) are joined bottom-to-top
  // instead of side-to-side, which would need a loop.
  const stacked = (sb: ReturnType<typeof box>, tb: ReturnType<typeof box>) =>
    Math.min(sb.r, tb.r) - Math.max(sb.l, tb.l) > 0.4 * Math.min(sb.r - sb.l, tb.r - tb.l) && (tb.t - sb.b > 24 || sb.t - tb.b > 24);
  const backY = new Map<string, number>();
  const vertical = new Map<string, NonNullable<EdgeView['vertical']>>();
  const nested = { below: 0, above: 0 };
  for (const e of edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    const sb = box(s);
    const tb = box(t);
    if (stacked(sb, tb)) {
      const pair = pairs.get(`${e.source}\u0000${e.target}`) ?? [e];
      const dx = fanOffset(pair.indexOf(e), pair.length);
      const down = tb.t > sb.b;
      vertical.set(e.id, { sx: (sb.l + sb.r) / 2 + dx, sy: down ? sb.b : sb.t, tx: (tb.l + tb.r) / 2 + dx, ty: down ? tb.t : tb.b });
      continue;
    }
    if (style === 'orthogonal' || tb.l - sb.r >= 10) continue;
    const lo = Math.min(tb.l, sb.l);
    const hi = Math.max(tb.r, sb.r);
    const spanned = nodes.map(box).filter((b) => b.r > lo && b.l < hi);
    const bottom = Math.max(...spanned.map((b) => b.b)) + 36;
    const top = Math.min(...spanned.map((b) => b.t)) - 36;
    const below = 2 * bottom - sb.cy - tb.cy <= sb.cy + tb.cy - 2 * top;
    const lane = below ? nested.below++ : nested.above++;
    backY.set(e.id, below ? bottom + lane * 18 : top - lane * 18);
  }
  // orthogonal: every edge routed around the nodes, from the same ports
  let paths = new Map<string, number[]>();
  if (style === 'orthogonal') {
    const ports = edges.flatMap((e) => {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      if (!s || !t) return [];
      const v = vertical.get(e.id);
      if (v) {
        const d = Math.sign(v.ty - v.sy);
        return [{ id: e.id, from: { x: v.sx, y: v.sy, dx: 0, dy: d }, to: { x: v.tx, y: v.ty, dx: 0, dy: d } }];
      }
      const sb = box(s);
      const tb = box(t);
      return [{
        id: e.id,
        from: { x: sb.r, y: sb.cy + fanOffset(outSlot.get(e.id) ?? 0, outs.get(e.source)?.length ?? 1), dx: 1, dy: 0 },
        to: { x: tb.l, y: tb.cy + fanOffset(inSlot.get(e.id) ?? 0, ins.get(e.target)?.length ?? 1), dx: 1, dy: 0 },
      }];
    });
    paths = routeOrthogonal(nodes.map((n) => ({ id: n.id, ...box(n) })), ports);
  }
  return edges.map((e) => {
    const src = byId.get(e.source);
    const [step, count] = steps.get(e.id) ?? [0, 0];
    const pair = pairs.get(`${e.source}\u0000${e.target}`) ?? [e];
    const pairSlot = pair.indexOf(e);
    const routes = pairSlot === 0 ? pair.map(route).filter((r): r is string => !!r) : undefined;
    const view: EdgeView = {
      outSlot: outSlot.get(e.id) ?? 0,
      outCount: outs.get(e.source)?.length ?? 1,
      inSlot: inSlot.get(e.id) ?? 0,
      inCount: ins.get(e.target)?.length ?? 1,
      routing: src ? effectiveRouting(src.data.kind, src.data.config) : 'pick',
      step,
      steps: count,
      pairSlot,
      pairCount: pair.length,
      routes: routes?.length ? routes : undefined,
      backY: backY.get(e.id),
      vertical: vertical.get(e.id),
      route: paths.get(e.id),
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
        tech: n.tech,
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
      ...(n.data.tech ? { tech: n.data.tech } : {}),
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
      if (p.rateLimit) out.rateLimit = p.rateLimit;
      if (p.retryBudget) out.retryBudget = p.retryBudget;
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

export function uniqueId(kind: string, taken: Set<string>) {
  for (let i = 1; ; i++) {
    const id = `${kind}-${i}`;
    if (!taken.has(id)) return id;
  }
}
