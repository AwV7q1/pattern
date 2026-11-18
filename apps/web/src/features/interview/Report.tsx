import { CircleAlert, Lightbulb, MessageSquareText, TriangleAlert } from 'lucide-react';
import type { InterviewScore } from '@pattern/design-lint';
import { fmt } from '@/lib/meta';
import { cn } from '@/lib/utils';
import type { Graded } from './grade';

export const VERDICT: Record<InterviewScore['verdict'], { label: string; className: string }> = {
  strong: { label: 'Rất tốt', className: 'text-success' },
  pass: { label: 'Đạt', className: 'text-success' },
  borderline: { label: 'Cần cải thiện', className: 'text-warning' },
  fail: { label: 'Chưa đạt', className: 'text-destructive' },
};

/** Score, the four rubric parts, every grading run and the feedback. */
export function Report({ graded, reference, talkingPoints }: { graded: Graded; reference?: number | null; talkingPoints?: string[] }) {
  const { score, runs, findings } = graded;
  const v = VERDICT[score.verdict];
  return (
    <div className="grid gap-5">
      <div className="flex items-end gap-4">
        <div className="font-mono text-5xl font-semibold">{score.total}</div>
        <div className="pb-1">
          <div className={cn('text-lg font-semibold', v.className)}>{v.label}</div>
          <div className="text-xs text-muted-foreground">
            trên 100{reference != null && <> · lời giải tham khảo đạt {reference}</>}
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        {score.parts.map((p) => (
          <div key={p.key} className="grid gap-1">
            <div className="flex justify-between text-sm">
              <span>{p.label}</span>
              <span className="font-mono text-muted-foreground">
                {p.score.toFixed(1)} / {p.max} · {p.note}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full', p.score / p.max >= 0.85 ? 'bg-success' : p.score / p.max >= 0.5 ? 'bg-warning' : 'bg-destructive')}
                style={{ width: `${(p.score / p.max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Kịch bản chấm</th>
              <th className="px-3 py-2 text-right font-medium">p99</th>
              <th className="px-3 py-2 text-right font-medium">Lỗi</th>
              <th className="px-3 py-2 text-right font-medium">Đạt SLO</th>
              <th className="px-3 py-2 text-right font-medium">Chi phí</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {runs.map((r) => (
              <tr key={r.name} className="border-t">
                <td className="px-3 py-1.5 font-sans">
                  {r.name}
                  {r.error && (
                    <div className="flex items-center gap-1 text-xs text-destructive">
                      <CircleAlert className="size-3" /> {r.error}
                    </div>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">{r.error ? '—' : fmt.ms(r.summary.p99Ms)}</td>
                <td className="px-3 py-1.5 text-right">{r.error ? '—' : fmt.pct(r.summary.errorRate)}</td>
                <td className={cn('px-3 py-1.5 text-right', r.summary.sloWindowRatio >= 0.98 ? 'text-success' : 'text-destructive')}>
                  {fmt.pct(r.summary.sloWindowRatio, 0)}
                </td>
                <td className="px-3 py-1.5 text-right">{r.error ? '—' : `${fmt.money(r.summary.costPerHour)}/h`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="grid gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <MessageSquareText className="size-4" /> Nhận xét
        </h3>
        <ul className="grid gap-1.5 text-sm">
          {score.feedback.map((line, i) => (
            <li key={i} className={cn('leading-relaxed', line.startsWith('  ') && 'pl-4 text-muted-foreground')}>
              {line.trim()}
            </li>
          ))}
        </ul>
      </section>

      {findings.length > 0 && (
        <section className="grid gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <TriangleAlert className="size-4" /> Ghi chú thiết kế ({findings.length})
          </h3>
          <ul className="grid gap-1 text-sm">
            {findings.map((f, i) => (
              <li key={i}>
                <span className={f.severity === 'error' ? 'text-destructive' : f.severity === 'warn' ? 'text-warning' : 'text-muted-foreground'}>●</span>{' '}
                {f.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {talkingPoints && talkingPoints.length > 0 && (
        <section className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Lightbulb className="size-4 text-primary" /> Một câu trả lời tốt sẽ nói về
          </h3>
          <ul className="grid list-disc gap-1 pl-5 text-sm">
            {talkingPoints.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
