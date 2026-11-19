import { hotNodes, interviewLevels, lint, scoreInterview, type Finding, type InterviewPrompt, type InterviewRun, type InterviewScore, type LintDesign } from '@pattern/design-lint';
import { compute } from '@/sim/compute';
import type { Design, Level } from '@/types';

export interface Graded {
  runs: (InterviewRun & { error?: string })[];
  findings: Finding[];
  score: InterviewScore;
}

const FAILED = { sloPass: false, sloWindowRatio: 0, p99Ms: 0, errorRate: 1, costPerHour: 0, backlog: 0 };

/** The prompt as a game level (canvas preview with the same catalog numbers). */
export function levelOf(prompt: InterviewPrompt): Level {
  return {
    ...(prompt.level as unknown as Level),
    id: `interview-${prompt.id}`,
    title: prompt.title,
    description: prompt.brief,
    brief: prompt.brief,
  };
}

/**
 * Grade in the browser, exactly like the server (shared package + same
 * engine): used when signed out; signed in, the server grades and stores.
 */
export async function gradeLocally(prompt: InterviewPrompt, design: Design): Promise<Graded> {
  let sanitized: LintDesign | null = null;
  const runs: Graded['runs'] = [];
  for (const r of interviewLevels(prompt, design as unknown as LintDesign)) {
    try {
      const out = await compute.levelRun(r.level, r.design);
      sanitized ??= out.input.design as unknown as LintDesign;
      runs.push({ name: r.name, kind: r.kind, summary: out.summary, hot: hotNodes(out.input.design as unknown as LintDesign, out.windows) });
    } catch (err) {
      runs.push({ name: r.name, kind: r.kind, summary: FAILED, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const findings = lint(sanitized ?? (design as unknown as LintDesign), prompt.level.scenario);
  const score = scoreInterview({ runs, findings, budgetPerHour: prompt.level.scenario.budgetPerHour ?? null, rubric: prompt.rubric });
  return { runs, findings, score };
}
