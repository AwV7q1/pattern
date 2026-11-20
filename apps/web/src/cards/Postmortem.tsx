import { useMemo } from 'react';
import { Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CONTENT } from './content';
import { cardIcon } from './cardArt';
import { budgetOf, cardDef } from './rules';
import { postmortem } from './postmortem';
import type { TurnReport } from './types';

/** One metric over the fight's turns, with its limit as a dashed line. */
function Spark({ label, values, limit, fmt, worst }: { label: string; values: number[]; limit?: number; fmt: (v: number) => string; worst?: number }) {
  const W = 150;
  const H = 38;
  const max = Math.max(1e-9, ...values, limit ?? 0) * 1.1;
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * (W - 8) + 4 : W / 2);
  const y = (v: number) => H - 3 - (v / max) * (H - 8);
  const peak = Math.max(...values);
  const over = limit != null && peak > limit;
  return (
    <div className="rounded-lg border bg-background/40 p-2">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-mono', over ? 'text-rose-300' : 'text-emerald-300')}>đỉnh {fmt(peak)}</span>
      </div>
      <svg width={W} height={H} className="mt-1 block" role="img" aria-label={`${label}: ${values.map(fmt).join(', ')}`}>
        {limit != null && <line x1={0} x2={W} y1={y(limit)} y2={y(limit)} stroke="rgb(251 113 133 / 0.6)" strokeDasharray="3 3" />}
        <polyline fill="none" stroke="rgb(125 211 252)" strokeWidth={1.5} points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        {values.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={i === worst ? 3.5 : 2} fill={limit != null && v > limit ? 'rgb(251 113 133)' : 'rgb(125 211 252)'} stroke={i === worst ? 'white' : 'none'} />
        ))}
      </svg>
    </div>
  );
}

/** What went wrong in a fight and which cards answer it. */
export function PostmortemPanel({ reports, chassis, deck }: { reports: TurnReport[]; chassis: string; deck: string[] }) {
  const pm = useMemo(() => postmortem(CONTENT, { reports, chassis }, deck), [reports, chassis, deck]);
  if (!reports.length) return null;
  const worst = pm.worst ? reports.indexOf(pm.worst) : undefined;
  const budget = budgetOf(CONTENT, { chassis });
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-3 gap-2">
        <Spark label="p99" values={reports.map((r) => r.p99Ms)} limit={CONTENT.battle.sloP99Ms} fmt={(v) => `${Math.round(v)}ms`} worst={worst} />
        <Spark label="Tỉ lệ lỗi" values={reports.map((r) => r.errorRate)} fmt={(v) => `${(v * 100).toFixed(1)}%`} worst={worst} />
        <Spark label="Chi phí" values={reports.map((r) => r.costPerHour)} limit={budget} fmt={(v) => `$${v.toFixed(2)}`} worst={worst} />
      </div>
      {pm.worst && (
        <p className="text-xs text-muted-foreground">
          Lượt tệ nhất: <b className="text-foreground">lượt {pm.worst.turn}</b> ({pm.worst.intent}), mất {pm.worst.damage.total} Error Budget.
        </p>
      )}
      {pm.causes.length === 0 ? (
        <p className="text-emerald-300">Không có sự cố nào đáng kể: hệ thống giữ SLO suốt trận.</p>
      ) : (
        <ol className="space-y-2">
          {pm.causes.slice(0, 3).map((c, i) => (
            <li key={c.kind} className="rounded-lg border bg-background/40 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">
                  {i + 1}. {c.title}
                </span>
                <span className="shrink-0 font-mono text-xs text-rose-300">−{c.damage}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{c.text}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
                <span className="text-muted-foreground">Nên đánh:</span>
                {c.advice.slice(0, 4).map((a) => {
                  const def = cardDef(CONTENT, a.card);
                  const Icon = cardIcon(def);
                  return (
                    <span
                      key={a.card}
                      title={a.inDeck ? 'Có trong bộ bài' : 'Chưa có trong bộ bài'}
                      className={cn(
                        'flex items-center gap-1 rounded-full border px-2 py-0.5',
                        a.inDeck ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-200' : 'border-dashed border-muted-foreground/40 text-muted-foreground',
                      )}
                    >
                      <Icon className="size-3" /> {def.name}
                    </span>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
      )}
      {pm.lesson && (
        <p className="flex gap-2 rounded-lg bg-amber-400/10 p-2 text-xs text-amber-100">
          <Lightbulb className="size-4 shrink-0 text-amber-300" />
          <span>
            <b>{cardDef(CONTENT, pm.lesson.card).name}:</b> {pm.lesson.text}
          </span>
        </p>
      )}
    </div>
  );
}
