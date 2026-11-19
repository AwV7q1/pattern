import { CircleAlert, CircleCheck, Info, TriangleAlert, Wand2 } from 'lucide-react';
import type { Finding, Severity } from '@pattern/design-lint';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const SEVERITY: Record<Severity, { label: string; icon: typeof Info; className: string }> = {
  error: { label: 'Lỗi', icon: CircleAlert, className: 'text-destructive' },
  warn: { label: 'Cảnh báo', icon: TriangleAlert, className: 'text-warning' },
  info: { label: 'Gợi ý', icon: Info, className: 'text-muted-foreground' },
};

interface Props {
  findings: Finding[];
  onSelect: (f: Finding) => void;
  onFix?: (f: Finding) => void;
}

/** Design review: what the rules found, with the reason and a one-click fix. */
export function LintPanel({ findings, onSelect, onFix }: Props) {
  if (!findings.length)
    return (
      <div className="flex items-start gap-2 rounded-lg border p-3 text-sm">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
        <div>
          <div className="font-medium">Không thấy vấn đề nào</div>
          <p className="text-xs text-muted-foreground">
            Bộ luật kiểm tra retry, timeout, điểm lỗi duy nhất, pool kết nối, cache stampede, autoscale và ngân sách. Vẫn nên chạy thử
            với spike và tắt node để chắc chắn.
          </p>
        </div>
      </div>
    );
  const counts = (['error', 'warn', 'info'] as Severity[]).map((s) => [s, findings.filter((f) => f.severity === s).length] as const);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3 text-xs">
        {counts
          .filter(([, n]) => n)
          .map(([s, n]) => {
            const Icon = SEVERITY[s].icon;
            return (
              <span key={s} className={cn('flex items-center gap-1', SEVERITY[s].className)}>
                <Icon className="size-3.5" /> {n} {SEVERITY[s].label.toLowerCase()}
              </span>
            );
          })}
        <span className="text-muted-foreground">· bấm để chọn trên canvas</span>
      </div>
      {findings.map((f, i) => {
        const meta = SEVERITY[f.severity];
        const Icon = meta.icon;
        return (
          <div key={`${f.rule}-${i}`} className="grid gap-1.5 rounded-lg border p-3">
            <button type="button" className="flex items-start gap-2 text-left" onClick={() => onSelect(f)}>
              <Icon className={cn('mt-0.5 size-4 shrink-0', meta.className)} />
              <span className="text-sm font-medium">{f.message}</span>
            </button>
            <p className="pl-6 text-xs leading-relaxed text-muted-foreground">{f.why}</p>
            <div className="flex items-center gap-2 pl-6">
              <code className="text-[11px] text-muted-foreground">{f.rule}</code>
              {f.fix && onFix && (
                <Button size="sm" variant="secondary" className="ml-auto h-7" onClick={() => onFix(f)}>
                  <Wand2 /> {f.fix.label}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
