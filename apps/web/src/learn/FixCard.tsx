import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Lightbulb, Loader2, Play, RotateCcw, Wrench, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { PopoutPanel } from '@/components/PopoutPanel';
import { KIND_META } from '@/lib/meta';
import { cn } from '@/lib/utils';
import { compute } from '@/sim/compute';
import type { NodeKind, Summary } from '@/types';
import { applyKnobs, formatMetric, GOAL_LABEL, goalMet, goalText, knobValue } from './fix';
import type { Card, Knob, KnobValue, SimSpec } from './types';

type FixCardSpec = Extract<Card, { type: 'fix' }>;
export interface Attempt {
  values: Record<string, KnobValue>;
  summary: Summary;
}

export const defaultValues = (card: FixCardSpec) =>
  Object.fromEntries(card.knobs.map((k) => [k.id, knobValue(card.sim, k)]));

interface Props {
  card: FixCardSpec;
  values: Record<string, KnobValue>;
  onChange: (values: Record<string, KnobValue>) => void;
  attempts: Attempt[];
  /** Run the current design (free try; does not grade). */
  onTry: () => void;
  busy: boolean;
  locked: boolean;
}

/**
 * "Fix the design" card: a mini canvas of the scenario where only a few knobs
 * can be changed, a free "try" that runs the engine, and the attempt history.
 * Pops out to a full-width tab with a bigger canvas and a comparison table.
 */
export function FixCard({ card, values, onChange, attempts, onTry, busy, locked }: Props) {
  const [focus, setFocus] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Summary | null>(null);
  const [showHint, setShowHint] = useState(false);
  useEffect(() => {
    let live = true;
    compute.run(card.sim).then((s) => live && setBaseline(s), () => {});
    return () => {
      live = false;
    };
  }, [card]);

  const edited = useMemo(() => applyKnobs(card.sim, card.knobs, values), [card, values]);
  const last = attempts.at(-1);
  const dirty = card.knobs.some((k) => values[k.id] !== knobValue(card.sim, k));

  return (
    <PopoutPanel
      icon={<Wrench />}
      title="Sửa design"
      actions={
        <>
          {card.hint && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowHint((v) => !v)}>
              <Lightbulb /> Gợi ý
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={!dirty || locked}
            onClick={() => onChange(defaultValues(card))}
          >
            <RotateCcw /> Về ban đầu
          </Button>
        </>
      }
    >
      {(wide) => (
        <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="grid content-start gap-3">
            <MiniCanvas sim={edited} knobs={card.knobs} focus={focus} onFocus={setFocus} tall={wide} />
            <Goals card={card} baseline={baseline} last={last?.summary} />
            {showHint && card.hint && (
              <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{card.hint}</p>
            )}
          </div>
          <div className="grid content-start gap-3">
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase">Được phép đổi</div>
              {card.knobs.map((k) => (
                <KnobControl
                  key={k.id}
                  knob={k}
                  value={values[k.id]}
                  focused={focus === k.id}
                  disabled={locked}
                  onFocus={() => setFocus(k.id)}
                  onChange={(v) => onChange({ ...values, [k.id]: v })}
                />
              ))}
              <Button variant="secondary" disabled={busy || locked} onClick={onTry}>
                {busy ? <Loader2 className="animate-spin" /> : <Play />} Chạy thử
              </Button>
            </div>
            <History card={card} attempts={attempts} baseline={baseline} wide={wide} />
          </div>
        </div>
      )}
    </PopoutPanel>
  );
}

// ---------------------------------------------------------------- goals & history

function Goals({ card, baseline, last }: { card: FixCardSpec; baseline: Summary | null; last?: Summary }) {
  return (
    <div className="grid gap-1.5 rounded-lg border p-3 text-sm">
      <div className="text-xs font-semibold text-muted-foreground uppercase">Mục tiêu</div>
      {card.goals.map((g, i) => {
        const now = last as unknown as Record<string, number> | undefined;
        const ok = now ? goalMet(g, now) : undefined;
        return (
          <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full border text-[10px]',
                ok === true && 'border-emerald-400 bg-emerald-400 text-emerald-950',
                ok === false && 'border-red-400 bg-red-400 text-red-950',
              )}
            >
              {ok === true ? <Check className="size-3" /> : ok === false ? <X className="size-3" /> : null}
            </span>
            <span className="font-medium">{goalText(g)}</span>
            <span className="font-mono text-xs text-muted-foreground">
              ban đầu {baseline ? formatMetric(g.metric, baseline[g.metric]) : '…'}
              {last && (
                <>
                  {' → '}
                  <span className={ok ? 'text-emerald-400' : 'text-red-400'}>{formatMetric(g.metric, last[g.metric])}</span>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function History({ card, attempts, baseline, wide }: { card: FixCardSpec; attempts: Attempt[]; baseline: Summary | null; wide: boolean }) {
  if (!attempts.length)
    return <p className="text-xs text-muted-foreground">Đổi thông số rồi bấm Chạy thử để xem simulator đo được gì. Chạy thử không bị tính điểm.</p>;
  const metrics = [...new Set(card.goals.map((g) => g.metric))];
  const changes = (a: Attempt) =>
    card.knobs
      .filter((k) => a.values[k.id] !== knobValue(card.sim, k))
      .map((k) => `${k.label}: ${display(k, a.values[k.id])}`)
      .join(', ') || 'không đổi gì';
  const rows = wide ? attempts : attempts.slice(-3);
  return (
    <div className="grid gap-1 rounded-lg border p-3 text-xs">
      <div className="mb-1 font-semibold text-muted-foreground uppercase">Các lần chạy</div>
      <table className="w-full">
        <thead className="text-left text-[10px] text-muted-foreground">
          <tr>
            <th className="pr-2 font-normal">#</th>
            {wide && <th className="pr-2 font-normal">Thay đổi</th>}
            {metrics.map((m) => (
              <th key={m} className="pr-2 text-right font-normal">
                {GOAL_LABEL[m]}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody className="font-mono">
          {wide && baseline && (
            <tr className="text-muted-foreground">
              <td className="pr-2">0</td>
              <td className="pr-2 font-sans">thiết kế ban đầu</td>
              {metrics.map((m) => (
                <td key={m} className="pr-2 text-right whitespace-nowrap">
                  {formatMetric(m, baseline[m])}
                </td>
              ))}
              <td />
            </tr>
          )}
          {rows.map((a) => {
            const n = attempts.indexOf(a) + 1;
            const pass = card.goals.every((g) => goalMet(g, a.summary as unknown as Record<string, number>));
            return (
              <tr key={n} title={changes(a)}>
                <td className="pr-2 text-muted-foreground">{n}</td>
                {wide && <td className="pr-2 font-sans">{changes(a)}</td>}
                {metrics.map((m) => (
                  <td key={m} className="pr-2 text-right whitespace-nowrap">
                    {formatMetric(m, a.summary[m])}
                  </td>
                ))}
                <td className={pass ? 'text-emerald-400' : 'text-red-400'}>{pass ? '✓' : '✗'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- knobs

function display(k: Knob, v: KnobValue) {
  const c = k.control;
  if (c.kind === 'select') return c.options.find((o) => o.value === v)?.label ?? String(v);
  if (c.kind === 'switch') return v ? 'bật' : 'tắt';
  return `${v}${c.unit ?? ''}`;
}

function KnobControl({
  knob,
  value,
  focused,
  disabled,
  onFocus,
  onChange,
}: {
  knob: Knob;
  value: KnobValue;
  focused: boolean;
  disabled: boolean;
  onFocus: () => void;
  onChange: (v: KnobValue) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focused]);
  const c = knob.control;
  return (
    <div
      ref={ref}
      onPointerDown={onFocus}
      className={cn('grid gap-1.5 rounded-md p-1.5 transition-shadow', focused && 'ring-2 ring-sky-400/70')}
    >
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>{knob.label}</span>
        {c.kind === 'number' && <span className="font-mono text-xs">{display(knob, value)}</span>}
        {c.kind === 'switch' && <Switch checked={!!value} disabled={disabled} onCheckedChange={onChange} aria-label={knob.label} />}
      </div>
      {c.kind === 'select' && (
        <div className="flex flex-wrap gap-1">
          {c.options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={cn(
                'rounded-md border-2 border-b-4 px-2.5 py-1 text-xs transition-colors',
                o.value === value ? 'border-sky-400 bg-sky-400/10' : 'hover:bg-muted/50',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {c.kind === 'number' && (
        <Slider
          min={c.min}
          max={c.max}
          step={c.step ?? 1}
          value={[Number(value)]}
          disabled={disabled}
          onValueChange={([v]) => onChange(v)}
          aria-label={knob.label}
        />
      )}
      {knob.help && <p className="text-[11px] text-muted-foreground">{knob.help}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- mini canvas

type N = { id: string; kind: NodeKind; label?: string; config?: Record<string, unknown> };
type E = { source: string; target: string; order?: number; fireAndForget?: boolean };

const NODE_W = 128;
const NODE_H = 46;
const COL = 200;
const ROW = 72;
const CIRCLED = '⓪①②③④⑤⑥⑦⑧⑨';
const STEP_S = 1.3; // seconds per call stage in the animation

/**
 * Layered drawing of the design (columns by call depth) with the same visual
 * language as the main canvas: step numbers / ∥ / ⇄ / dashed ⇢ on the edges,
 * blue requests out and green responses back, played in call order.
 */
function MiniCanvas({
  sim,
  knobs,
  focus,
  onFocus,
  tall,
}: {
  sim: SimSpec;
  knobs: Knob[];
  focus: string | null;
  onFocus: (id: string) => void;
  tall: boolean;
}) {
  const nodes = sim.design.nodes as N[];
  const edges = sim.design.edges as E[];

  const layout = useMemo(() => {
    const depth = new Map<string, number>();
    nodes.filter((n) => n.kind === 'client').forEach((n) => depth.set(n.id, 0));
    for (let changed = true, guard = 0; changed && guard < 50; guard++) {
      changed = false;
      for (const e of edges) {
        const d = (depth.get(e.source) ?? 0) + 1;
        if ((depth.get(e.target) ?? -1) < d) {
          depth.set(e.target, d);
          changed = true;
        }
      }
    }
    const cols: string[][] = [];
    for (const n of nodes) (cols[depth.get(n.id) ?? 0] ??= []).push(n.id);
    const rows = Math.max(...cols.map((c) => c?.length ?? 0));
    const pos = new Map<string, { x: number; y: number }>();
    cols.forEach((c, i) =>
      c?.forEach((id, j) => pos.set(id, { x: 20 + i * COL, y: 16 + (j + (rows - c.length) / 2) * ROW })),
    );
    return { pos, w: 40 + (cols.length - 1) * COL + NODE_W, h: 32 + (rows - 1) * ROW + NODE_H };
  }, [nodes, edges]);

  // which elements carry a knob
  const knobFor = (t: { node: string } | { edge: [string, string] }) =>
    knobs.find((k) =>
      'node' in t ? 'node' in k.target && k.target.node === t.node : 'edge' in k.target && k.target.edge[0] === t.edge[0] && k.target.edge[1] === t.edge[1],
    );

  // animation clock
  const [t, setT] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      setT((performance.now() - t0) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const routingOf = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n || n.kind === 'client' || n.kind === 'loadBalancer') return 'pick';
    return (n.config?.routing as string) ?? 'pick';
  };

  return (
    <div className="overflow-x-auto rounded-lg border bg-muted/20">
      <svg
        viewBox={`0 0 ${layout.w} ${layout.h}`}
        className="mx-auto block w-full"
        style={{ maxHeight: tall ? 420 : 240, minWidth: Math.min(layout.w, 420) }}
        role="img"
        aria-label="sơ đồ design"
      >
        {[...new Set(edges.map((e) => e.source))].map((src) => {
          const out = edges.filter((e) => e.source === src);
          const routing = routingOf(src);
          const stages = [...new Set(out.map((e) => e.order ?? 0))].sort((a, b) => a - b);
          const cycle = routing === 'sequence' ? stages.length : 1;
          return out.map((e, i) => {
            const a = layout.pos.get(e.source)!;
            const b = layout.pos.get(e.target)!;
            const p0 = { x: a.x + NODE_W, y: a.y + NODE_H / 2 };
            const p3 = { x: b.x, y: b.y + NODE_H / 2 };
            const dx = (p3.x - p0.x) / 2;
            const at = (u: number) => {
              const v = 1 - u;
              return {
                x: v * v * v * p0.x + 3 * v * v * u * (p0.x + dx) + 3 * v * u * u * (p3.x - dx) + u * u * u * p3.x,
                y: v * v * v * p0.y + 3 * v * v * u * p0.y + 3 * v * u * u * p3.y + u * u * u * p3.y,
              };
            };
            const d = `M${p0.x},${p0.y} C${p0.x + dx},${p0.y} ${p3.x - dx},${p3.y} ${p3.x},${p3.y}`;
            const ff = !!e.fireAndForget && routing !== 'pick';
            const knob = knobFor({ edge: [e.source, e.target] });
            // animation phase of this edge within its source's cycle
            const stage = routing === 'sequence' ? stages.indexOf(e.order ?? 0) : 0;
            const cyc = Math.floor(t / (cycle * STEP_S));
            const active = routing !== 'pick' || out.length === 1 || cyc % out.length === i;
            const ph = (t % (cycle * STEP_S)) / STEP_S - stage; // 0..1 while this stage runs
            const req = active && ph >= 0 && ph < 0.5 ? at(ph * 2) : null;
            const res = active && !ff && ph >= 0.5 && ph < 1 ? at(1 - (ph - 0.5) * 2) : null;
            const badge =
              routing === 'sequence'
                ? CIRCLED[Math.min(9, stages.indexOf(e.order ?? 0) + 1)]
                : routing === 'parallel'
                  ? '∥'
                  : out.length > 1
                    ? '⇄'
                    : null;
            const mid = at(0.62); // past the fork, where sibling edges have spread apart
            return (
              <g
                key={`${e.source}-${e.target}`}
                onClick={knob ? () => onFocus(knob.id) : undefined}
                className={knob ? 'cursor-pointer' : undefined}
              >
                <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                <path
                  d={d}
                  fill="none"
                  stroke={knob && focus === knob.id ? '#38bdf8' : ff ? '#b48cff' : 'currentColor'}
                  strokeOpacity={knob && focus === knob.id ? 1 : 0.45}
                  strokeWidth={knob ? 2 : 1.5}
                  strokeDasharray={ff ? '2 5' : undefined}
                />
                {knob && <path d={d} fill="none" stroke="#38bdf8" strokeOpacity={0.25} strokeWidth={6} className="animate-pulse" />}
                {badge && (
                  <text x={mid.x} y={mid.y - 5} textAnchor="middle" fontSize="13" fill="currentColor" opacity={0.85}>
                    {badge}
                  </text>
                )}
                {ff && (
                  <text x={at(0.85).x} y={at(0.85).y - 6} textAnchor="middle" fontSize="12" fill="#b48cff">
                    ⇢
                  </text>
                )}
                {req && <circle cx={req.x} cy={req.y} r={4.5} fill={ff ? '#b48cff' : '#4db3ff'} />}
                {res && <circle cx={res.x} cy={res.y} r={4} fill="#4df28c" />}
              </g>
            );
          });
        })}
        {nodes.map((n) => {
          const p = layout.pos.get(n.id)!;
          const meta = KIND_META[n.kind];
          const knob = knobFor({ node: n.id });
          const routing = routingOf(n.id);
          const inst = Number(n.config?.instances ?? 1);
          const sub =
            n.kind === 'client'
              ? 'người dùng'
              : [
                  inst > 1 ? `${inst} máy` : null,
                  routing === 'sequence' ? '①② tuần tự' : routing === 'parallel' ? '∥ song song' : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || meta.name;
          return (
            <g key={n.id} onClick={knob ? () => onFocus(knob.id) : undefined} className={knob ? 'cursor-pointer' : undefined}>
              {inst > 1 && (
                <rect x={p.x + 4} y={p.y + 4} width={NODE_W} height={NODE_H} rx={8} fill="var(--card)" stroke="currentColor" strokeOpacity={0.2} />
              )}
              <rect
                x={p.x}
                y={p.y}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill="var(--card)"
                stroke={knob ? '#38bdf8' : meta.color}
                strokeOpacity={knob ? (focus === knob.id ? 1 : 0.7) : 0.6}
                strokeWidth={knob ? 2 : 1.2}
                strokeDasharray={knob && focus !== knob.id ? '5 3' : undefined}
              />
              <rect x={p.x} y={p.y + 8} width={3} height={NODE_H - 16} rx={1.5} fill={meta.color} />
              <text x={p.x + 12} y={p.y + 19} fontSize="12.5" fontWeight={600} fill="currentColor">
                {n.label ?? meta.name}
              </text>
              <text x={p.x + 12} y={p.y + 35} fontSize="10.5" fill="currentColor" opacity={0.6}>
                {sub}
              </text>
              {knob && (
                <text x={p.x + NODE_W - 8} y={p.y + 15} textAnchor="end" fontSize="11" fill="#38bdf8">
                  ✎
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="px-2 pb-1.5 text-[11px] text-muted-foreground">
        Viền xanh nét đứt <span className="text-sky-400">✎</span> = chỗ được phép sửa (bấm để chọn). Chấm xanh dương: request, xanh lá: response.
      </p>
    </div>
  );
}
