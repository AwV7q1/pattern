import { CloudDownload, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CONTENT } from './content';
import { cloudBill } from './rules';
import type { BattleState, NodeCost } from './types';

const usd = (v: number) => `$${v.toFixed(2)}`;

/** Under this utilization a node that costs a real share of the bill is paid for and idle. */
const IDLE_UTIL = 0.3;

/** Where the money goes: each node's $/h as a share of the total, idle and hot nodes marked. */
export function CostBreakdown({ costs, egress = 0, budget, className }: { costs: NodeCost[]; egress?: number; budget: number; className?: string }) {
  const total = costs.reduce((s, c) => s + c.costPerHour, 0) + egress;
  const rows = [...costs.map((c) => ({ ...c, egress: false })), ...(egress > 0 ? [{ node: 'egress', kind: 'egress', label: 'Egress (băng thông ra)', instances: 0, costPerHour: egress, egress: true }] : [])].sort(
    (a, b) => b.costPerHour - a.costPerHour,
  );
  const over = total > budget + 0.001;
  return (
    <div className={cn('text-xs', className)}>
      <ul className="space-y-1">
        {rows.map((r) => {
          const share = total > 0 ? r.costPerHour / total : 0;
          const util = 'util' in r ? r.util : undefined;
          const idle = util !== undefined && util < IDLE_UTIL && share >= 0.15;
          const hot = util !== undefined && util >= 0.9;
          return (
            <li key={r.node}>
              <div className="flex items-baseline gap-1.5">
                {r.egress && <CloudDownload className="size-3 shrink-0 self-center text-rose-300" />}
                <span className="min-w-0 truncate">{r.label}</span>
                {!r.egress && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">×{r.instances}</span>}
                {idle && (
                  <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] text-amber-200" title={`Chỉ dùng ${Math.round(util! * 100)}% công suất mà chiếm ${Math.round(share * 100)}% chi phí: thử Rightsizing hoặc Scale-in.`}>
                    dư {Math.round(util! * 100)}%
                  </span>
                )}
                {hot && (
                  <span className="shrink-0 rounded bg-rose-500/15 px-1 text-[10px] text-rose-200" title="Gần hết công suất: cắt chi phí ở đây sẽ làm hỏng request.">
                    nóng {Math.round(util! * 100)}%
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono">{usd(r.costPerHour)}</span>
                <span className="w-8 shrink-0 text-right font-mono text-[10px] text-muted-foreground">{Math.round(share * 100)}%</span>
              </div>
              <div className="mt-0.5 h-1 rounded-full bg-muted/50">
                <div className={cn('h-full rounded-full', r.egress ? 'bg-rose-400/80' : idle ? 'bg-amber-400/80' : 'bg-sky-400/80')} style={{ width: `${Math.max(2, share * 100)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className={cn('mt-2 flex justify-between border-t pt-1 font-mono', over ? 'text-rose-300' : 'text-emerald-300')}>
        <span className="font-sans text-muted-foreground">Tổng / ngân sách</span>
        <span>
          {usd(total)} / {usd(budget)}/h
        </span>
      </div>
    </div>
  );
}

/** The fight's cloud bill so far, in gold: what the run takes out of the reward. */
export function BillLine({ state, className }: { state: Pick<BattleState, 'reports' | 'prepaid' | 'relics'>; className?: string }) {
  const bill = cloudBill(CONTENT, state);
  const spend = state.reports.reduce((s, r) => s + r.costPerHour, 0);
  if (!CONTENT.run.bill) return null;
  return (
    <div className={cn('flex items-center gap-1.5 text-xs', className)} title={`Trong ca leo tháp, hóa đơn trừ vào vàng thưởng sau trận: ${CONTENT.run.bill.perDollarTurn} vàng cho mỗi $1/h mỗi lượt.`}>
      <Receipt className="size-3.5 shrink-0 text-yellow-200" />
      <span className="whitespace-nowrap text-muted-foreground">Hóa đơn cloud</span>
      <span className="ml-auto font-mono">
        {usd(spend)}·lượt{bill.prepaid ? ` + trả trước ${bill.prepaid}` : ''} → <b className="text-yellow-200">{bill.total} vàng</b>
      </span>
    </div>
  );
}
