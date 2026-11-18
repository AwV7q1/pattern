import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, GitCompare, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fmt } from '@/lib/meta';
import { cn } from '@/lib/utils';
import { compute } from '@/sim/compute';
import type { Design, Scenario, Summary } from '@/types';
import { comparisonScenario, diffDesigns, engineDesign, isEmptyDiff, type FieldChange } from './diff';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The older version, on the left. */
  base: { label: string; design: Design } | null;
  current: Design;
  /** Both designs run this scenario (the project's current one), same seed. */
  scenario: Scenario;
}

type Row = { label: string; get: (s: Summary) => number; show: (v: number) => string; lowerIsBetter: boolean };

const ROWS: Row[] = [
  { label: 'p50', get: (s) => s.p50Ms, show: fmt.ms, lowerIsBetter: true },
  { label: 'p99', get: (s) => s.p99Ms, show: fmt.ms, lowerIsBetter: true },
  { label: 'Tỉ lệ lỗi', get: (s) => s.errorRate, show: (v) => fmt.pct(v, 2), lowerIsBetter: true },
  { label: 'Thông lượng', get: (s) => s.throughputRps, show: (v) => `${Math.round(v)} rps`, lowerIsBetter: false },
  { label: 'Cửa sổ đạt SLO', get: (s) => s.sloWindowRatio, show: (v) => fmt.pct(v, 0), lowerIsBetter: false },
  { label: 'Timeout', get: (s) => s.timeouts, show: (v) => String(v), lowerIsBetter: true },
  { label: 'Bị drop', get: (s) => s.dropped, show: (v) => String(v), lowerIsBetter: true },
  { label: 'Tồn đọng cuối', get: (s) => s.backlog, show: (v) => String(v), lowerIsBetter: true },
  { label: 'Chi phí', get: (s) => s.costPerHour, show: (v) => `${fmt.money(v)}/h`, lowerIsBetter: true },
];

type State = { status: 'running' } | { status: 'done'; a: Summary; b: Summary } | { status: 'error'; message: string };

const show = (v: unknown) => (v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Same scenario, same seed, two designs: the engine is deterministic, so every difference comes from the design. */
export function CompareDialog({ open, onOpenChange, base, current, scenario }: Props) {
  const [state, setState] = useState<State>({ status: 'running' });
  const sc = useMemo(() => comparisonScenario(scenario), [scenario]);
  const diff = useMemo(() => (base ? diffDesigns(base.design, current) : null), [base, current]);

  useEffect(() => {
    if (!open || !base) return;
    let alive = true;
    setState({ status: 'running' });
    Promise.all([
      compute.run({ design: engineDesign(base.design), scenario: sc }),
      compute.run({ design: engineDesign(current), scenario: sc }),
    ]).then(
      ([a, b]) => alive && setState({ status: 'done', a, b }),
      (e: Error) => alive && setState({ status: 'error', message: e.message }),
    );
    return () => {
      alive = false;
    };
    // a snapshot of the canvas when the dialog opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, base]);

  const labelOf = (id: string) => current.nodes.find((n) => n.id === id)?.label ?? base?.design.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="size-4" /> So sánh: {base?.label} <ArrowRight className="size-3.5" /> Hiện tại
          </DialogTitle>
          <DialogDescription>
            Cả hai chạy cùng kịch bản hiện tại của dự án ({Math.round(sc.durationMs! / 1000)} s, seed {sc.seed}). Engine tất định, nên mọi
            khác biệt đến từ thiết kế.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[65vh]">
          {state.status === 'running' && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Đang mô phỏng hai phiên bản…
            </div>
          )}
          {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
          {state.status === 'done' && (
            <table className="w-full text-sm" aria-label="Kết quả so sánh">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 font-normal">Chỉ số</th>
                  <th className="py-1.5 text-right font-normal">{base?.label}</th>
                  <th className="py-1.5 text-right font-normal">Hiện tại</th>
                  <th className="py-1.5 text-right font-normal">Thay đổi</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px]">
                <tr className="border-b">
                  <td className="py-1.5 font-sans">SLO</td>
                  <td className="text-right">{state.a.sloPass ? 'Đạt' : 'Trượt'}</td>
                  <td className="text-right">{state.b.sloPass ? 'Đạt' : 'Trượt'}</td>
                  <td
                    className={cn(
                      'text-right',
                      state.a.sloPass !== state.b.sloPass && (state.b.sloPass ? 'text-success' : 'text-destructive'),
                    )}
                  >
                    {state.a.sloPass === state.b.sloPass ? '=' : state.b.sloPass ? 'đạt lại' : 'trượt'}
                  </td>
                </tr>
                {ROWS.map((r) => {
                  const a = r.get(state.a);
                  const b = r.get(state.b);
                  const d = b - a;
                  const rel = a === 0 ? (b === 0 ? 0 : Infinity) : d / Math.abs(a);
                  const notable = Math.abs(rel) >= 0.01 && d !== 0;
                  const better = r.lowerIsBetter ? d < 0 : d > 0;
                  return (
                    <tr key={r.label} className="border-b last:border-0" data-metric={r.label}>
                      <td className="py-1.5 font-sans">{r.label}</td>
                      <td className="text-right">{r.show(a)}</td>
                      <td className="text-right">{r.show(b)}</td>
                      <td className={cn('text-right', notable && (better ? 'text-success' : 'text-destructive'))}>
                        {!notable ? '=' : Number.isFinite(rel) ? `${d > 0 ? '+' : ''}${(rel * 100).toFixed(0)}%` : `+${r.show(b)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {diff && (
            <div className="mt-4 grid gap-1.5 text-sm">
              <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Thiết kế thay đổi</div>
              {isEmptyDiff(diff) && <p className="text-muted-foreground">Không khác gì (chỉ có thể khác vị trí trên canvas).</p>}
              {diff.addedNodes.map((n) => (
                <p key={`+${n.id}`} className="text-success">+ {n.label} ({n.kind})</p>
              ))}
              {diff.removedNodes.map((n) => (
                <p key={`-${n.id}`} className="text-destructive">− {n.label} ({n.kind})</p>
              ))}
              {diff.addedEdges.map((e) => (
                <p key={`+${e.source}-${e.target}`} className="text-success">
                  + {labelOf(e.source)} → {labelOf(e.target)}
                </p>
              ))}
              {diff.removedEdges.map((e) => (
                <p key={`-${e.source}-${e.target}`} className="text-destructive">
                  − {labelOf(e.source)} → {labelOf(e.target)}
                </p>
              ))}
              {diff.changedNodes.map(({ node, changes }) => (
                <Changes key={`~${node.id}`} title={node.label} changes={changes} />
              ))}
              {diff.changedEdges.map(({ edge, changes }) => (
                <Changes key={`~${edge.source}-${edge.target}`} title={`${labelOf(edge.source)} → ${labelOf(edge.target)}`} changes={changes} />
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function Changes({ title, changes }: { title: string; changes: FieldChange[] }) {
  return (
    <div>
      <span className="text-warning">~ {title}</span>
      <span className="ml-2 font-mono text-xs text-muted-foreground">
        {changes.map((c) => `${c.field}: ${show(c.before)} → ${show(c.after)}`).join(' · ')}
      </span>
    </div>
  );
}
