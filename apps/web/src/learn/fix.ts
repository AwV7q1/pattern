// Pure helpers for `fix` cards, shared by the lesson UI and scripts/check-curriculum.mjs.
import type { Goal, Knob, KnobValue, SimSpec } from './types';

type NodeJson = { id: string; kind: string; label?: string; config?: Record<string, unknown> };
type EdgeJson = { source: string; target: string } & Record<string, unknown>;

/** Current value of a knob in `sim` (falls back to the first option / min / false). */
export function knobValue(sim: SimSpec, knob: Knob): KnobValue {
  const nodes = sim.design.nodes as NodeJson[];
  const edges = sim.design.edges as EdgeJson[];
  let v: unknown;
  if ('node' in knob.target) {
    const id = knob.target.node;
    v = nodes.find((n) => n.id === id)?.config?.[knob.field];
  } else {
    const [s, t] = knob.target.edge;
    v = edges.find((e) => e.source === s && e.target === t)?.[knob.field];
  }
  if (v !== undefined) return v as KnobValue;
  const c = knob.control;
  return c.kind === 'select' ? c.options[0].value : c.kind === 'number' ? c.min : false;
}

/** Copy of `sim` with the knob values written into the design. */
export function applyKnobs(sim: SimSpec, knobs: Knob[], values: Record<string, KnobValue>): SimSpec {
  const nodes = structuredClone(sim.design.nodes) as NodeJson[];
  const edges = structuredClone(sim.design.edges) as EdgeJson[];
  for (const knob of knobs) {
    if (!(knob.id in values)) continue;
    const v = values[knob.id];
    if ('node' in knob.target) {
      const id = knob.target.node;
      const n = nodes.find((x) => x.id === id);
      if (n) n.config = { ...n.config, [knob.field]: v };
    } else {
      const [s, t] = knob.target.edge;
      const e = edges.find((x) => x.source === s && x.target === t);
      if (e) e[knob.field] = v;
    }
  }
  return { design: { nodes, edges }, scenario: sim.scenario };
}

export const GOAL_LABEL: Record<Goal['metric'], string> = {
  p50Ms: 'p50',
  p99Ms: 'p99',
  errorRate: 'tỉ lệ lỗi',
  throughputRps: 'throughput',
  costPerHour: 'chi phí',
};

export function formatMetric(metric: Goal['metric'], v: number): string {
  switch (metric) {
    case 'errorRate':
      return `${(v * 100).toFixed(1)}%`;
    case 'costPerHour':
      return `$${v.toFixed(2)}/h`;
    case 'throughputRps':
      return `${Math.round(v)} rps`;
    default:
      return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
  }
}

export const goalText = (g: Goal) => `${GOAL_LABEL[g.metric]} ${g.op === '<' ? '<' : '≤'} ${formatMetric(g.metric, g.value)}`;

export const goalMet = (g: Goal, summary: Record<string, number>) =>
  g.op === '<' ? summary[g.metric] < g.value : summary[g.metric] <= g.value + 1e-9;

/** Knobs set to their trap value (meets the numbers, wrong design). */
export const trapsHit = (knobs: Knob[], values: Record<string, KnobValue>) =>
  knobs.filter((k) => k.trap && values[k.id] === k.trap.value);
