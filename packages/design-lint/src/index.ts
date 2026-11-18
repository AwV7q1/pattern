import { RULES, type Ctx } from './rules.ts';
import type { Finding, LintDesign, LintEdge, LintScenario, Patch, Severity } from './types.ts';

export type * from './types.ts';
export { RULES } from './rules.ts';
export { DEFAULT_RUBRIC, scoreInterview, type InterviewRun, type InterviewScore, type Rubric } from './interview.ts';

const ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

export interface LintOptions {
  /** Rule ids (`retry-no-jitter`…) to skip. */
  disable?: string[];
}

/** Review a design. Findings are sorted most severe first. */
export function lint(design: LintDesign, scenario?: LintScenario, opts: LintOptions = {}): Finding[] {
  const byId = new Map(design.nodes.map((n) => [n.id, n]));
  const out = new Map<string, LintEdge[]>();
  const inc = new Map<string, LintEdge[]>();
  for (const e of design.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    out.set(e.source, [...(out.get(e.source) ?? []), e]);
    inc.set(e.target, [...(inc.get(e.target) ?? []), e]);
  }
  const ctx: Ctx = {
    design,
    scenario,
    byId,
    out,
    in: inc,
    name: (id) => byId.get(id)?.label ?? id,
  };
  const disabled = new Set(opts.disable ?? []);
  return Object.values(RULES)
    .flatMap((rule) => rule(ctx))
    .filter((f) => !disabled.has(f.rule))
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

/** Copy of `design` with the patches of a fix applied. */
export function applyPatches<D extends LintDesign>(design: D, patches: Patch[]): D {
  const next = structuredClone(design);
  for (const p of patches) {
    if ('node' in p.target) {
      const id = p.target.node;
      const n = next.nodes.find((x) => x.id === id);
      if (n) n.config = { ...n.config, [p.field]: p.value };
    } else {
      const [s, t] = p.target.edge;
      const e = next.edges.find((x) => x.source === s && x.target === t);
      if (e) (e as unknown as Record<string, unknown>)[p.field] = p.value;
    }
  }
  return next;
}

/** Findings per node id / edge `source->target`, for badges on the canvas. */
export function countByTarget(findings: Finding[]) {
  const nodes = new Map<string, { count: number; worst: Severity }>();
  const edges = new Map<string, { count: number; worst: Severity }>();
  for (const f of findings) {
    const key = 'node' in f.target ? f.target.node : 'edge' in f.target ? f.target.edge.join('->') : null;
    if (!key) continue;
    const map = 'node' in f.target ? nodes : edges;
    const prev = map.get(key);
    map.set(key, {
      count: (prev?.count ?? 0) + 1,
      worst: prev && ORDER[prev.worst] <= ORDER[f.severity] ? prev.worst : f.severity,
    });
  }
  return { nodes, edges };
}
