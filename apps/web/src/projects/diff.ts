import type { Design, DesignEdge, DesignNode, Scenario } from '@/types';

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface DesignDiff {
  addedNodes: DesignNode[];
  removedNodes: DesignNode[];
  changedNodes: { node: DesignNode; changes: FieldChange[] }[];
  addedEdges: DesignEdge[];
  removedEdges: DesignEdge[];
  changedEdges: { edge: DesignEdge; changes: FieldChange[] }[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function fields(before: Record<string, unknown>, after: Record<string, unknown>, prefix = ''): FieldChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.filter((k) => !same(before[k], after[k])).map((k) => ({ field: prefix + k, before: before[k], after: after[k] }));
}

const edgeKey = (e: DesignEdge) => `${e.source}→${e.target}`;

/** What changed between two designs, ignoring positions and canvas-only fields. */
export function diffDesigns(a: Design, b: Design): DesignDiff {
  const an = new Map(a.nodes.map((n) => [n.id, n]));
  const bn = new Map(b.nodes.map((n) => [n.id, n]));
  const ae = new Map(a.edges.map((e) => [edgeKey(e), e]));
  const be = new Map(b.edges.map((e) => [edgeKey(e), e]));
  const changedNodes: DesignDiff['changedNodes'] = [];
  for (const [id, after] of bn) {
    const before = an.get(id);
    if (!before) continue;
    const changes = [
      ...fields({ kind: before.kind, label: before.label, tech: before.tech }, { kind: after.kind, label: after.label, tech: after.tech }),
      ...fields(before.config ?? {}, after.config ?? {}),
    ];
    if (changes.length) changedNodes.push({ node: after, changes });
  }
  const changedEdges: DesignDiff['changedEdges'] = [];
  for (const [k, after] of be) {
    const before = ae.get(k);
    if (!before) continue;
    const strip = ({ source: _s, target: _t, ...rest }: DesignEdge) => rest as Record<string, unknown>;
    const changes = fields(strip(before), strip(after));
    if (changes.length) changedEdges.push({ edge: after, changes });
  }
  return {
    addedNodes: b.nodes.filter((n) => !an.has(n.id)),
    removedNodes: a.nodes.filter((n) => !bn.has(n.id)),
    changedNodes,
    addedEdges: b.edges.filter((e) => !ae.has(edgeKey(e))),
    removedEdges: a.edges.filter((e) => !be.has(edgeKey(e))),
    changedEdges,
  };
}

export const isEmptyDiff = (d: DesignDiff) => Object.values(d).every((v) => v.length === 0);

/**
 * A finite run of the project's scenario for a side-by-side comparison:
 * the sandbox runs forever, so cover the whole traffic script (and chaos) plus
 * 30 s to let queues drain, at least 60 s.
 */
export function comparisonScenario(s: Scenario): Scenario {
  const lastEvent = Math.max(0, ...s.traffic.map((t) => t.atMs), ...(s.events ?? []).map((e) => e.atMs));
  return { ...s, durationMs: s.durationMs ?? Math.max(60_000, lastEvent + 30_000) };
}

/** Only what the engine reads (drops canvas groups). */
export const engineDesign = (d: Design): Design => ({ nodes: d.nodes, edges: d.edges });
