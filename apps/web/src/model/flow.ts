import type { Edge, Node } from '@xyflow/react';
import { bendsToPath, manualOk, routeOrthogonal, SIDE_DIR, type Port } from './routing';
import {
  DEFAULT_CONFIG,
  DEFAULT_POLICY,
  type Design,
  type DesignEdge,
  type EdgePolicy,
  type EdgeLayout,
  type EdgeWindow,
  type NodeConfig,
  type NodeKind,
  type NodeWindow,
  type Routing,
  type Scenario,
  type Side,
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
  /** Real-world technology id (tech/catalog.ts). */
  tech?: string;
};
export type SystemNodeType = Node<SystemNodeData, 'system'>;

export type FlowEdgeData = {
  /** Position in the engine's edge array (particles and metrics use it). */
  index: number;
  policy: EdgePolicy;
  metrics?: EdgeWindow;
  /** Hand-made drawing (sides, bends), saved with the design. */
  layout?: EdgeLayout;
  /** Derived for drawing (see `decorateEdges`), never stored. */
  view?: EdgeView;
};

export interface EdgeView {
  /** Slot of this edge among the source's outgoing / target's incoming edges. */
  outSlot: number;
  outCount: number;
  inSlot: number;
  inCount: number;
  /** Routing of the source handler (its endpoint's, else the node's). */
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
  /**
   * Where the edge leaves the source and enters the target. `dx, dy` is the
   * direction of travel there (out of the source, into the target).
   */
  from: PortView;
  to: PortView;
  /** Orthogonal style: the routed polyline `[x0, y0, x1, y1, …]` in flow coordinates. */
  route?: number[];
  /** The route is the hand-made one from `layout.bends`. */
  manual?: boolean;
}
export type PortView = Port & { side: Side };
export type EdgeStyleMode = 'curve' | 'orthogonal';

/** Vertical gap between edges that leave or enter the same side of a node. */
export function fanOffset(slot: number, count: number) {
  if (count <= 1) return 0;
  return (slot - (count - 1) / 2) * Math.min(14, 64 / (count - 1));
}
export type FlowEdgeType = Edge<FlowEdgeData, 'flow'>;
const FALLBACK_PORT: PortView = { x: 0, y: 0, dx: 1, dy: 0, side: 'right' };

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
    hedgeAfterMs: e.hedgeAfterMs ?? null,
    fromEndpoint: e.fromEndpoint ?? null,
    toEndpoint: e.toEndpoint ?? null,
    requestKb: e.requestKb ?? 0,
    responseKb: e.responseKb ?? 0,
    bandwidthMbps: e.bandwidthMbps ?? DEFAULT_POLICY.bandwidthMbps,
  };
}

const SIDES: readonly Side[] = ['left', 'right', 'top', 'bottom'];
/** Hand-made drawing of a design edge, if any (unknown values are dropped). */
export function layoutOf(e: DesignEdge): EdgeLayout | undefined {
  const l: EdgeLayout = {};
  if (e.fromSide && SIDES.includes(e.fromSide)) l.fromSide = e.fromSide;
  if (e.toSide && SIDES.includes(e.toSide)) l.toSide = e.toSide;
  if (Array.isArray(e.bends) && e.bends.length && e.bends.every((v) => Number.isFinite(v))) l.bends = e.bends;
  return Object.keys(l).length ? l : undefined;
}

/** Routing the engine really uses (clients and LBs always pick one edge). */
export function effectiveRouting(kind: NodeKind, config: NodeConfig, endpoint?: string | null): Routing {
  if (kind === 'client' || kind === 'loadBalancer') return 'pick';
  const ep = endpoint ? config.endpoints?.find((d) => d.name === endpoint) : undefined;
  return ep?.routing ?? config.routing ?? 'pick';
}

/** Endpoint names a node declares (none for clients, like the engine). */
export function endpointsOf(kind: NodeKind, config: NodeConfig): string[] {
  return kind === 'client' ? [] : (config.endpoints ?? []).map((d) => d.name);
}

/** Unique edge id: several edges may join the same pair (one per endpoint). */
export function edgeId(source: string, target: string, taken: { id: string }[]) {
  const base = `e-${source}-${target}`;
  if (!taken.some((e) => e.id === base)) return base;
  for (let i = 2; ; i++) if (!taken.some((e) => e.id === `${base}-${i}`)) return `${base}-${i}`;
}

/**
 * Drawing hints for every edge: spread edges that share a node side so they
 * do not overlap (sorted by the other end's height), and number the steps
 * of `sequence` routing exactly like the engine groups them.
 */
export function decorateEdges(
  nodes: SystemNodeType[],
  edges: FlowEdgeType[],
  style: EdgeStyleMode = 'curve',
  /** Edge being reshaped by hand: drawn as dragged even across a node. */
  editing: string | null = null,
): FlowEdgeType[] {
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
  const handler = (e: FlowEdgeType) => e.data?.policy.fromEndpoint ?? null;
  outs.forEach((list, src) => {
    const n = byId.get(src);
    if (!n) return;
    // steps are numbered per handler: its own edges plus the shared ones
    for (const h of new Set(list.map(handler))) {
      if (effectiveRouting(n.data.kind, n.data.config, h) !== 'sequence') continue;
      const mine = list.filter((e) => handler(e) === h || handler(e) === null);
      const orders = [...new Set(mine.map((e) => e.data?.policy.order ?? 0))].sort((a, b) => a - b);
      mine.filter((e) => handler(e) === h).forEach((e) => steps.set(e.id, [orders.indexOf(e.data?.policy.order ?? 0) + 1, orders.length]));
    }
  });
  // edges joining the same pair are drawn as one bundle with one label box
  const pairs = new Map<string, FlowEdgeType[]>();
  for (const e of edges) {
    const k = `${e.source}\u0000${e.target}`;
    pairs.set(k, [...(pairs.get(k) ?? []), e]);
  }
  const route = (e: FlowEdgeType) => {
    const p = e.data?.policy;
    return p?.fromEndpoint || p?.toEndpoint ? `${p.fromEndpoint ?? '*'} → /${p.toEndpoint ?? '…'}` : null;
  };
  // Back edges loop around every node spanned horizontally, on the side
  // that makes the shorter detour; loops sharing a side are nested.
  const box = (n: SystemNodeType) => {
    const w = n.measured?.width ?? 200;
    const h = n.measured?.height ?? 110;
    return { l: n.position.x, r: n.position.x + w, t: n.position.y, b: n.position.y + h, cy: n.position.y + h / 2 };
  };
  // Stacked nodes (one mostly above the other) are joined bottom-to-top
  // instead of side-to-side, which would need a loop. A side picked by hand wins.
  const stacked = (sb: ReturnType<typeof box>, tb: ReturnType<typeof box>) =>
    Math.min(sb.r, tb.r) - Math.max(sb.l, tb.l) > 0.4 * Math.min(sb.r - sb.l, tb.r - tb.l) && (tb.t - sb.b > 24 || sb.t - tb.b > 24);
  const boxes = new Map(nodes.map((n) => [n.id, box(n)]));
  const sides = new Map<string, [Side, Side]>();
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  for (const e of edges) {
    const sb = boxes.get(e.source);
    const tb = boxes.get(e.target);
    if (!sb || !tb) continue;
    const down = tb.t > sb.b;
    const auto: [Side, Side] = stacked(sb, tb) ? (down ? ['bottom', 'top'] : ['top', 'bottom']) : ['right', 'left'];
    const l = e.data?.layout;
    sides.set(e.id, [l?.fromSide ?? auto[0], l?.toSide ?? auto[1]]);
  }
  // ends sharing a node side are spread along it, ordered by where the other end is
  const ports = new Map<string, [PortView, PortView]>();
  const bySide = new Map<string, { e: FlowEdgeType; end: 0 | 1; other: number }[]>();
  sides.forEach(([fs, ts], id) => {
    const e = edgeById.get(id)!;
    const sb = boxes.get(e.source)!;
    const tb = boxes.get(e.target)!;
    const along = (side: Side, b: typeof sb) => (side === 'left' || side === 'right' ? b.cy : (b.l + b.r) / 2);
    for (const [end, node, side, other] of [[0, e.source, fs, tb], [1, e.target, ts, sb]] as const) {
      const k = `${node}\u0000${side}`;
      bySide.set(k, [...(bySide.get(k) ?? []), { e, end, other: along(side, other) }]);
    }
  });
  bySide.forEach((list, k) => {
    const [node, side] = k.split('\u0000') as [string, Side];
    const b = boxes.get(node)!;
    const [nx, ny] = SIDE_DIR[side];
    list.sort((p, q) => p.other - q.other || p.e.id.localeCompare(q.e.id) || p.end - q.end);
    list.forEach(({ e, end }, i) => {
      const off = fanOffset(i, list.length);
      const x = nx ? (nx > 0 ? b.r : b.l) : (b.l + b.r) / 2 + off;
      const y = ny ? (ny > 0 ? b.b : b.t) : b.cy + off;
      // travel goes out of the source side, into the target side
      const port: PortView = end === 0 ? { x, y, dx: nx, dy: ny, side } : { x, y, dx: -nx, dy: -ny, side };
      const pair = ports.get(e.id) ?? ([port, port] as [PortView, PortView]);
      pair[end] = port;
      ports.set(e.id, pair);
    });
  });
  // Back edges (curve style, default sides) loop around every node spanned
  // horizontally, on the side that makes the shorter detour; loops sharing a
  // side are nested.
  const backY = new Map<string, number>();
  const nested = { below: 0, above: 0 };
  if (style === 'curve')
    for (const e of edges) {
      const sb = boxes.get(e.source);
      const tb = boxes.get(e.target);
      const sd = sides.get(e.id);
      if (!sb || !tb || !sd || sd[0] !== 'right' || sd[1] !== 'left' || tb.l - sb.r >= 10) continue;
      const lo = Math.min(tb.l, sb.l);
      const hi = Math.max(tb.r, sb.r);
      const spanned = [...boxes.values()].filter((b) => b.r > lo && b.l < hi);
      const bottom = Math.max(...spanned.map((b) => b.b)) + 36;
      const top = Math.min(...spanned.map((b) => b.t)) - 36;
      const below = 2 * bottom - sb.cy - tb.cy <= sb.cy + tb.cy - 2 * top;
      const lane = below ? nested.below++ : nested.above++;
      backY.set(e.id, below ? bottom + lane * 18 : top - lane * 18);
    }
  // orthogonal: every edge routed around the nodes from its ports; hand-made
  // routes are kept while they still fit, and the others avoid them
  let paths = new Map<string, number[]>();
  const manual = new Set<string>();
  if (style === 'orthogonal') {
    const list = [...boxes].map(([id, b]) => ({ id, ...b }));
    const fixed = new Map<string, [number, number][]>();
    for (const e of edges) {
      const bends = e.data?.layout?.bends;
      const pp = ports.get(e.id);
      if (!bends || !pp) continue;
      const path = bendsToPath(pp[0], pp[1], bends);
      if (path && manualOk(path, pp[0], pp[1], list, { from: e.source, to: e.target }, e.id !== editing)) {
        fixed.set(e.id, path);
        manual.add(e.id);
      }
    }
    const requests = [...ports].map(([id, [from, to]]) => ({ id, from, to }));
    paths = routeOrthogonal(list, requests, fixed);
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
      routing: src ? effectiveRouting(src.data.kind, src.data.config, handler(e)) : 'pick',
      step,
      steps: count,
      pairSlot,
      pairCount: pair.length,
      routes: routes?.length ? routes : undefined,
      backY: backY.get(e.id),
      from: ports.get(e.id)?.[0] ?? FALLBACK_PORT,
      to: ports.get(e.id)?.[1] ?? FALLBACK_PORT,
      route: paths.get(e.id),
      manual: manual.has(e.id) || undefined,
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
    edges: design.edges.reduce<FlowEdgeType[]>((acc, e, index) => [...acc, {
      id: edgeId(e.source, e.target, acc),
      source: e.source,
      target: e.target,
      type: 'flow',
      data: { index, policy: policyOf(e), layout: layoutOf(e) },
    }], []),
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
      data: { policy: e.data?.policy ?? DEFAULT_POLICY, layout: e.data?.layout, index, metrics: undefined },
    })),
  };
}

/** Engine input format, in index order. Positions and labels are kept for export. */
export function toDesign(nodes: SystemNodeType[], edges: FlowEdgeType[]): Design {
  const ns = [...nodes].sort((a, b) => a.data.index - b.data.index);
  const es = [...edges].sort((a, b) => a.data!.index - b.data!.index);
  // a renamed or removed endpoint must not leave edges pointing at nothing (the engine rejects them)
  const own = new Map(ns.map((n) => [n.id, endpointsOf(n.data.kind, n.data.config)]));
  const every = new Set([...own.values()].flat());
  return {
    nodes: ns.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      label: n.data.label,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      config: withoutBadEndpoints(withoutDanglingQueue(n.data.config, ns)),
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
      if (p.hedgeAfterMs) out.hedgeAfterMs = p.hedgeAfterMs;
      if (p.fromEndpoint && own.get(e.source)?.includes(p.fromEndpoint)) out.fromEndpoint = p.fromEndpoint;
      const targetEps = own.get(e.target) ?? [];
      if (p.toEndpoint && (targetEps.length ? targetEps.includes(p.toEndpoint) : every.has(p.toEndpoint))) out.toEndpoint = p.toEndpoint;
      if (p.requestKb) out.requestKb = p.requestKb;
      if (p.responseKb) out.responseKb = p.responseKb;
      if (p.requestKb || p.responseKb) out.bandwidthMbps = p.bandwidthMbps ?? DEFAULT_POLICY.bandwidthMbps;
      const l = e.data!.layout;
      if (l?.fromSide) out.fromSide = l.fromSide;
      if (l?.toSide) out.toSide = l.toSide;
      if (l?.bends?.length) out.bends = l.bends.map((v) => Math.round(v));
      return out;
    }),
  };
}

/** Endpoints need distinct non-empty names; drop the ones being typed. */
function withoutBadEndpoints(config: NodeConfig): NodeConfig {
  if (!config.endpoints) return config;
  const seen = new Set<string>();
  const endpoints = config.endpoints.filter((e) => {
    const ok = e.name.trim() !== '' && !seen.has(e.name);
    seen.add(e.name);
    return ok;
  });
  return { ...config, endpoints: endpoints.length ? endpoints : undefined };
}

/** Request types may only enter through endpoints that exist. */
export function sanitizeScenario(sc: Scenario, design: Design): Scenario {
  if (!sc.requests?.length) return sc;
  const names = new Set(design.nodes.filter((n) => n.kind !== 'client').flatMap((n) => (n.config?.endpoints ?? []).map((e) => e.name)));
  return { ...sc, requests: sc.requests.map((r) => (r.endpoint && !names.has(r.endpoint) ? { ...r, endpoint: null } : r)) };
}

/** A deleted queue node must not leave a KEDA scaler pointing at nothing (the engine rejects it). */
function withoutDanglingQueue(config: NodeConfig, nodes: SystemNodeType[]): NodeConfig {
  const q = config.autoscale?.queue;
  if (!q || nodes.some((n) => n.id === q)) return config;
  return { ...config, autoscale: { ...config.autoscale!, queue: null } };
}

export function uniqueId(kind: string, taken: Set<string>) {
  for (let i = 1; ; i++) {
    const id = `${kind}-${i}`;
    if (!taken.has(id)) return id;
  }
}
