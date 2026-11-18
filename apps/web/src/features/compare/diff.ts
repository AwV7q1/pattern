import type { Design, DesignEdge, DesignNode, Scenario } from '@/types';

export interface DiffLine {
  kind: 'added' | 'removed' | 'changed';
  what: string;
  detail?: string;
}

const LABEL: Record<string, string> = {
  instances: 'instances',
  concurrency: 'slot',
  queueSize: 'hàng đợi',
  latencyP50Ms: 'p50',
  latencyP99Ms: 'p99',
  hitRate: 'hit rate',
  routing: 'routing',
  timeoutMs: 'timeout',
  retries: 'retry',
  backoffMs: 'backoff',
  poolSize: 'pool',
  model: 'mô hình',
  autoscale: 'autoscale',
  cache: 'cache',
  circuitBreaker: 'circuit breaker',
  retryBudget: 'retry budget',
  rateLimit: 'rate limit',
  costPerHour: 'giá',
};

const show = (v: unknown) =>
  v === undefined || v === null ? '—' : typeof v === 'object' ? (Object.keys(v as object).length ? 'bật' : '—') : String(v);

function fields(a: Record<string, unknown> = {}, b: Record<string, unknown> = {}, skip: string[] = []) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !skip.includes(k));
  return keys
    .filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
    .map((k) => `${LABEL[k] ?? k} ${show(a[k])} → ${show(b[k])}`);
}

const nodeName = (n: DesignNode) => n.label || n.id;
const edgeKey = (e: DesignEdge) => `${e.source}->${e.target}`;

/** What changed from design A to design B, readable. */
export function diffDesigns(a: Design, b: Design): DiffLine[] {
  const out: DiffLine[] = [];
  const an = new Map(a.nodes.map((n) => [n.id, n]));
  const bn = new Map(b.nodes.map((n) => [n.id, n]));
  for (const n of b.nodes) if (!an.has(n.id)) out.push({ kind: 'added', what: nodeName(n), detail: n.kind });
  for (const n of a.nodes) if (!bn.has(n.id)) out.push({ kind: 'removed', what: nodeName(n), detail: n.kind });
  for (const n of b.nodes) {
    const old = an.get(n.id);
    if (!old) continue;
    const changes = fields(old.config as Record<string, unknown>, n.config as Record<string, unknown>);
    if (old.tech !== n.tech) changes.unshift(`công nghệ ${old.tech ?? '—'} → ${n.tech ?? '—'}`);
    if (changes.length) out.push({ kind: 'changed', what: nodeName(n), detail: changes.join(', ') });
  }
  const name = (d: Map<string, DesignNode>, id: string) => (d.get(id) ? nodeName(d.get(id)!) : id);
  const ae = new Map(a.edges.map((e) => [edgeKey(e), e]));
  const be = new Map(b.edges.map((e) => [edgeKey(e), e]));
  for (const e of b.edges) if (!ae.has(edgeKey(e))) out.push({ kind: 'added', what: `${name(bn, e.source)} → ${name(bn, e.target)}` });
  for (const e of a.edges) if (!be.has(edgeKey(e))) out.push({ kind: 'removed', what: `${name(an, e.source)} → ${name(an, e.target)}` });
  for (const e of b.edges) {
    const old = ae.get(edgeKey(e));
    if (!old) continue;
    const changes = fields(old as unknown as Record<string, unknown>, e as unknown as Record<string, unknown>, ['source', 'target']);
    if (changes.length) out.push({ kind: 'changed', what: `${name(bn, e.source)} → ${name(bn, e.target)}`, detail: changes.join(', ') });
  }
  return out;
}

export type StressKind = 'project' | 'spike' | 'kill' | 'slowdb';

export const STRESS: Record<StressKind, string> = {
  project: 'Kịch bản của dự án',
  spike: 'Spike ×3 (giây 20–40)',
  kill: 'Mất 1 node (giây 20–40)',
  slowdb: 'Database chậm ×3 (giây 20–40)',
};

/**
 * The scenario both sides run: the project's, made headless (60 s if it has
 * no duration), plus an optional stress. Events only target nodes that exist
 * in that design.
 */
export function stressScenario(base: Scenario, design: Design, kind: StressKind, killNode?: string): Scenario {
  const durationMs = base.durationMs ?? 60_000;
  const has = new Set(design.nodes.map((n) => n.id));
  const keep = (base.events ?? []).filter((e) => (!e.node || has.has(e.node)) && (!e.edge || (has.has(e.edge.source) && has.has(e.edge.target))));
  const sc: Scenario = { ...base, durationMs, events: keep };
  const at = Math.min(20_000, durationMs / 3);
  const until = Math.min(40_000, (durationMs * 2) / 3);
  if (kind === 'spike') {
    const t = base.traffic;
    const rpsAt = (ms: number) => [...t].reverse().find((p) => p.atMs <= ms)?.rps ?? t[0]?.rps ?? 0;
    sc.traffic = [
      ...t.filter((p) => p.atMs < at),
      { atMs: at, rps: rpsAt(at) * 3 },
      { atMs: until, rps: rpsAt(until) },
      ...t.filter((p) => p.atMs > until),
    ];
  }
  if (kind === 'kill' && killNode && has.has(killNode))
    sc.events = [...keep, { atMs: at, node: killNode, action: 'down' }, { atMs: until, node: killNode, action: 'up' }];
  if (kind === 'slowdb') {
    const dbs = design.nodes.filter((n) => n.kind === 'database').map((n) => n.id);
    sc.events = [
      ...keep,
      ...dbs.flatMap((id) => [
        { atMs: at, node: id, action: 'latency' as const, value: 3 },
        { atMs: until, node: id, action: 'up' as const },
      ]),
    ];
  }
  return sc;
}
