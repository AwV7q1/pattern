import type { ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { fmt } from '@/lib/meta';
import type { Summary } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Stars } from '@/components/LevelPanel';
import { cn } from '@/lib/utils';

function Check3({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
          ok ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive',
        )}
      >
        {ok ? <Check className="size-3" /> : <X className="size-3" />}
      </span>
      <div>
        <div className="text-sm">{label}</div>
        <div className="font-mono text-[11px] text-muted-foreground">{detail}</div>
      </div>
    </li>
  );
}

const TITLES = ['Hệ thống chưa trụ được', 'Sống sót!', 'Tốt và tiết kiệm', 'Hoàn hảo'];

export function ResultDialog({
  summary,
  onOpenChange,
  action,
}: {
  summary: Summary | null;
  onOpenChange: (open: boolean) => void;
  /** Extra footer content (e.g. back to the learning path). */
  action?: ReactNode;
}) {
  const s = summary;
  return (
    <Dialog open={!!s} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {s && (
          <>
            <DialogHeader className="items-center text-center sm:text-center">
              <Stars count={s.stars} className="[&_svg]:size-8" />
              <DialogTitle className="mt-2">{TITLES[s.stars]}</DialogTitle>
              <DialogDescription>
                Engine chạy lại toàn bộ {s.durationMs / 1000}s ({s.total.toLocaleString()} request). Server chấm bằng
                đúng code này nên điểm sẽ khớp.
              </DialogDescription>
            </DialogHeader>
            <ul className="grid gap-2">
              <Check3
                ok={s.sloPass}
                label="Đạt SLO trên toàn bộ trận"
                detail={`p99 ${fmt.ms(s.p99Ms)} / ${fmt.ms(s.slo.p99Ms)} · lỗi ${fmt.pct(s.errorRate, 2)} / ${fmt.pct(s.slo.errorRate, 0)}`}
              />
              <Check3
                ok={s.budgetPerHour === null || s.costPerHour <= s.budgetPerHour + 1e-9}
                label="Trong ngân sách"
                detail={
                  s.budgetPerHour === null
                    ? `${fmt.money(s.costPerHour)}/giờ · level không giới hạn ngân sách`
                    : `${fmt.money(s.costPerHour)} / ${fmt.money(s.budgetPerHour)} mỗi giờ`
                }
              />
              <Check3
                ok={s.sloWindowRatio >= 0.98 && s.backlog === 0}
                label="Vững trước sự cố"
                detail={`${fmt.pct(s.sloWindowRatio, 0)} số giây đạt SLO (cần 98%) · backlog ${s.backlog}`}
              />
            </ul>
            <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs">
              <div className="rounded border p-2">
                {fmt.rps(s.throughputRps)}
                <div className="text-[10px] text-muted-foreground">ok/s</div>
              </div>
              <div className="rounded border p-2">
                {s.retries.toLocaleString()}
                <div className="text-[10px] text-muted-foreground">retry</div>
              </div>
              <div className="rounded border p-2">
                {s.timeouts.toLocaleString()}
                <div className="text-[10px] text-muted-foreground">timeout</div>
              </div>
            </div>
            <DialogFooter>
              {action}
              <Button variant={action ? 'outline' : 'default'} onClick={() => onOpenChange(false)}>
                Đóng
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
