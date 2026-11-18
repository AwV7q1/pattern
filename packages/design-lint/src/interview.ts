import type { Finding } from './types.ts';

/** Weights of the four parts of an interview score (any scale, normalised). */
export interface Rubric {
  /** Meets the SLO under normal and peak traffic. */
  slo: number;
  /** Stays within budget. */
  cost: number;
  /** Survives the failure scenarios. */
  resilience: number;
  /** Design hygiene: lint findings. */
  hygiene: number;
}

export const DEFAULT_RUBRIC: Rubric = { slo: 40, cost: 15, resilience: 30, hygiene: 15 };

/** Engine result of one grading scenario (subset of the engine `Summary`). */
export interface InterviewRun {
  name: string;
  /** `normal` and `peak` grade the SLO part, `failure` the resilience part. */
  kind: 'normal' | 'peak' | 'failure';
  summary: {
    sloPass: boolean;
    sloWindowRatio: number;
    p99Ms: number;
    errorRate: number;
    costPerHour: number;
    backlog?: number;
  };
  /** Busiest components during the run, for feedback. */
  hot?: { label: string; utilization: number; rejected: number }[];
}

export interface InterviewScore {
  /** 0..100. */
  total: number;
  parts: { key: keyof Rubric; label: string; score: number; max: number; note: string }[];
  /** Plain feedback lines, most important first. */
  feedback: string[];
  verdict: 'strong' | 'pass' | 'borderline' | 'fail';
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** How well a run met the SLO: full marks when it passed, partial by windows. */
function sloCredit(r: InterviewRun) {
  if (r.summary.sloPass && r.summary.sloWindowRatio >= 0.98) return 1;
  return clamp01(r.summary.sloWindowRatio) * (r.summary.sloPass ? 0.9 : 0.6);
}

/**
 * Score a design from the engine runs of an interview prompt and the lint
 * findings. Pure and deterministic: the server recomputes it from the same
 * runs, so a stored attempt cannot be edited.
 */
export function scoreInterview(input: {
  runs: InterviewRun[];
  findings: Finding[];
  budgetPerHour?: number | null;
  rubric?: Rubric;
}): InterviewScore {
  const rubric = input.rubric ?? DEFAULT_RUBRIC;
  const weight = rubric.slo + rubric.cost + rubric.resilience + rubric.hygiene || 1;
  const scale = (w: number) => (w / weight) * 100;
  const feedback: string[] = [];

  const traffic = input.runs.filter((r) => r.kind !== 'failure');
  const failures = input.runs.filter((r) => r.kind === 'failure');
  const avg = (rs: InterviewRun[]) => (rs.length ? rs.reduce((s, r) => s + sloCredit(r), 0) / rs.length : 1);

  const slo = avg(traffic);
  // a design that serves nothing is not cheap, clean or resilient, it is
  // missing: the other parts count in proportion to the traffic served
  const served = traffic.length ? clamp01(traffic.reduce((s, r) => s + (1 - r.summary.errorRate), 0) / traffic.length) : 1;
  for (const r of traffic.filter((x) => sloCredit(x) < 1)) {
    feedback.push(
      `${r.name}: p99 ${Math.round(r.summary.p99Ms)}ms, lỗi ${(r.summary.errorRate * 100).toFixed(1)}%, chỉ ${Math.round(r.summary.sloWindowRatio * 100)}% thời gian đạt SLO.`,
    );
    const hot = r.hot?.filter((h) => h.utilization > 0.9 || h.rejected > 0).slice(0, 2) ?? [];
    for (const h of hot)
      feedback.push(
        `  ${h.label} quá tải (${Math.round(h.utilization * 100)}% bận${h.rejected ? `, từ chối ${h.rejected}/s` : ''}): thêm instance, cache phía trước, hoặc đưa việc nặng qua queue.`,
      );
  }

  const resilience = avg(failures) * served;
  for (const r of failures.filter((x) => sloCredit(x) < 1))
    feedback.push(
      `Sự cố "${r.name}": chỉ ${Math.round(r.summary.sloWindowRatio * 100)}% thời gian đạt SLO. Xem lại replica, timeout, circuit breaker và retry budget.`,
    );
  if (failures.some((r) => (r.summary.backlog ?? 0) > 0)) feedback.push('Queue còn tồn backlog cuối bài: consumer chưa đủ hoặc chưa autoscale.');

  const cost = Math.max(0, ...input.runs.map((r) => r.summary.costPerHour));
  const budget = input.budgetPerHour;
  let costCredit = 1;
  if (budget != null && budget > 0) {
    costCredit = cost <= budget ? 1 : clamp01(1 - (cost - budget) / budget);
    if (cost > budget) feedback.push(`Chi phí ${cost.toFixed(2)}/giờ vượt ngân sách ${budget.toFixed(2)}/giờ.`);
    else if (cost < budget * 0.5 && slo === 1) feedback.push('Rất tiết kiệm: dùng chưa tới nửa ngân sách mà vẫn đạt SLO.');
  }

  costCredit *= served;
  const penalty = input.findings.reduce((s, f) => s + (f.severity === 'error' ? 0.4 : f.severity === 'warn' ? 0.15 : 0.03), 0);
  const hygiene = clamp01(1 - penalty) * served;
  if (served < 0.5) feedback.unshift('Design chưa phục vụ được phần lớn request: kiểm tra đã nối từ client tới các thành phần chưa, và có đủ công suất không.');
  for (const f of input.findings.filter((x) => x.severity !== 'info').slice(0, 5)) feedback.push(`${f.message}. ${f.why}`);

  const parts: InterviewScore['parts'] = [
    { key: 'slo', label: 'Đạt SLO khi có tải', score: scale(rubric.slo) * slo, max: scale(rubric.slo), note: `${traffic.length} kịch bản tải` },
    { key: 'resilience', label: 'Chịu được sự cố', score: scale(rubric.resilience) * resilience, max: scale(rubric.resilience), note: `${failures.length} kịch bản sự cố` },
    { key: 'cost', label: 'Chi phí', score: scale(rubric.cost) * costCredit, max: scale(rubric.cost), note: budget != null ? `${cost.toFixed(2)} / ${budget.toFixed(2)} mỗi giờ` : `${cost.toFixed(2)}/giờ` },
    { key: 'hygiene', label: 'Thiết kế sạch', score: scale(rubric.hygiene) * hygiene, max: scale(rubric.hygiene), note: `${input.findings.length} ghi chú` },
  ].map((p) => ({ ...p, score: Math.round(p.score * 10) / 10, max: Math.round(p.max * 10) / 10 })) as InterviewScore['parts'];

  const total = Math.round(parts.reduce((s, p) => s + p.score, 0));
  const verdict = total >= 85 ? 'strong' : total >= 70 ? 'pass' : total >= 55 ? 'borderline' : 'fail';
  if (!feedback.length) feedback.push('Design đạt mọi kịch bản, không có ghi chú đáng kể. Tốt!');
  return { total, parts, feedback, verdict };
}
