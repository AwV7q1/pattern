import type { LintDesign, NodeKind } from './types.ts';
import type { InterviewRun, Rubric } from './interview.ts';

/** One grading scenario of an interview prompt. */
export interface GradingScenario {
  name: string;
  kind: InterviewRun['kind'];
  /** Multiply the traffic between `fromMs` and `untilMs` (default 20–40 s). */
  traffic?: { multiplier: number; fromMs?: number; untilMs?: number };
  /**
   * Faults on every node of a kind (or the node ids listed): `latency` /
   * `errors` / `down` between `fromMs` and `untilMs`.
   */
  faults?: { kind?: NodeKind; nodes?: string[]; action: 'latency' | 'errors' | 'down'; value?: number; fromMs?: number; untilMs?: number }[];
  /**
   * N+1: lose one instance of every node of this kind for the whole run
   * (a node with a single instance goes down from 20 s to 40 s instead).
   */
  loseInstance?: NodeKind;
}

/** `interviews/*.json`: a system design interview question. */
export interface InterviewPrompt {
  id: string;
  title: string;
  difficulty: 'Dễ' | 'Trung bình' | 'Khó';
  timeMinutes: number;
  brief: string;
  requirements: string[];
  /** What a strong answer talks about (shown after submitting). */
  talkingPoints?: string[];
  /** Level rules the design is played with (palette, locked/scalable nodes, catalog…). */
  level: Record<string, unknown> & {
    palette: NodeKind[];
    locked?: string[];
    design: LintDesign;
    scenario: { durationMs: number; traffic: { atMs: number; rps: number }[]; budgetPerHour?: number | null; [k: string]: unknown };
  };
  grading: GradingScenario[];
  rubric?: Rubric;
  /** Reference answer, compared after submitting. */
  reference: LintDesign;
}

type Event = { atMs: number; node: string; action: string; value?: number };

/**
 * The level JSON to play for each grading scenario: the prompt's level with
 * the scenario's traffic and faults applied to this particular design.
 * Pure: the browser and the server build exactly the same runs.
 */
export function interviewLevels(prompt: InterviewPrompt, design: LintDesign) {
  const base = prompt.level;
  return prompt.grading.map((g) => {
    const sc = structuredClone(base.scenario) as InterviewPrompt['level']['scenario'] & { events?: Event[] };
    const events: Event[] = [...(sc.events ?? [])];
    if (g.traffic) {
      const from = g.traffic.fromMs ?? 20_000;
      const until = g.traffic.untilMs ?? 40_000;
      const rpsAt = (ms: number) => [...sc.traffic].reverse().find((p) => p.atMs <= ms)?.rps ?? sc.traffic[0]?.rps ?? 0;
      sc.traffic = [
        ...sc.traffic.filter((p) => p.atMs < from),
        { atMs: from, rps: rpsAt(from) * g.traffic.multiplier },
        { atMs: until, rps: rpsAt(until) },
        ...sc.traffic.filter((p) => p.atMs > until),
      ];
    }
    for (const f of g.faults ?? []) {
      const targets = f.nodes ?? design.nodes.filter((n) => n.kind === f.kind).map((n) => n.id);
      for (const node of targets) {
        events.push({ atMs: f.fromMs ?? 20_000, node, action: f.action, value: f.value });
        events.push({ atMs: f.untilMs ?? 40_000, node, action: 'up' });
      }
    }
    let played = design;
    if (g.loseInstance) {
      played = structuredClone(design);
      for (const n of played.nodes.filter((x) => x.kind === g.loseInstance)) {
        const count = n.config?.instances ?? 1;
        if (count >= 2) n.config = { ...n.config, instances: count - 1 };
        else events.push({ atMs: 20_000, node: n.id, action: 'down' }, { atMs: 40_000, node: n.id, action: 'up' });
      }
    }
    sc.events = events.sort((a, b) => a.atMs - b.atMs);
    return { name: g.name, kind: g.kind, level: { ...base, id: `interview-${prompt.id}`, scenario: sc }, design: played };
  });
}

/** Busiest components of a run (average over the windows), for feedback. */
export function hotNodes(
  design: LintDesign,
  windows: { nodes: { utilization: number; rejected: number }[] }[],
): NonNullable<InterviewRun['hot']> {
  if (!windows.length) return [];
  return design.nodes
    .map((n, i) => ({
      label: n.label ?? n.id,
      kind: n.kind,
      utilization: windows.reduce((s, w) => s + (w.nodes[i]?.utilization ?? 0), 0) / windows.length,
      rejected: Math.round(windows.reduce((s, w) => s + (w.nodes[i]?.rejected ?? 0), 0) / windows.length),
    }))
    .filter((h) => h.kind !== 'client')
    .sort((a, b) => b.utilization - a.utilization)
    .slice(0, 4)
    .map(({ label, utilization, rejected }) => ({ label, utilization, rejected }));
}
