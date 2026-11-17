import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { SeqSpec, SeqStep } from './types';

const W = 560;
const PAD = 60;
const HEAD = 40;
const ROW = 30;
const SUB = 11; // vertical offset between arrows of the same row
const STEP_MS = 800;
const TRAVEL_MS = 650;
const PAUSE_MS = 1600;

const COLOR: Record<NonNullable<SeqStep['kind']>, string> = {
  req: '#4db3ff',
  res: '#4df28c',
  err: '#ff5c5c',
  async: '#b48cff',
};

/**
 * Animated sequence diagram: lifelines for each actor, arrows drawn in time
 * order; steps sharing `at` fly together (parallel). Loops, with a replay
 * button; shows the final state when the user prefers reduced motion.
 */
export function SequenceAnim({ spec }: { spec: SeqSpec }) {
  const rows = useMemo(() => {
    const ats = [...new Set(spec.steps.map((s, i) => s.at ?? i))].sort((a, b) => a - b);
    const placed = spec.steps.map((s, i) => {
      const at = s.at ?? i;
      const row = ats.indexOf(at);
      const sub = spec.steps.slice(0, i).filter((p, j) => (p.at ?? j) === at).length;
      return { ...s, kind: s.kind ?? 'req', at, row, sub };
    });
    // y of each row grows with the arrows it holds
    const heights = ats.map((_, r) => ROW + SUB * Math.max(0, placed.filter((p) => p.row === r).length - 1));
    const tops = heights.map((_, r) => HEAD + 22 + heights.slice(0, r).reduce((a, b) => a + b, 0));
    return { placed, tops, height: tops.at(-1)! + heights.at(-1)! + 8, count: ats.length, ats };
  }, [spec]);

  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const total = rows.count * STEP_MS + PAUSE_MS;
  const [t, setT] = useState(reduced ? total : 0);
  const startRef = useRef(performance.now());
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const tick = () => {
      setT((performance.now() - startRef.current) % total);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [total, reduced]);

  const n = spec.actors.length;
  const x = (i: number) => (n === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (n - 1));
  // time relative to the row's start, scaled so parallel rows share a slot
  const progress = (row: number) => Math.min(1, Math.max(0, (t - row * STEP_MS) / TRAVEL_MS));

  return (
    <div className="relative rounded-lg border bg-muted/20 p-2">
      <svg viewBox={`0 0 ${W} ${rows.height}`} className="w-full" role="img" aria-label={spec.caption ?? 'sơ đồ tuần tự'}>
        <defs>
          {Object.entries(COLOR).map(([k, c]) => (
            <marker key={k} id={`seq-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={c} />
            </marker>
          ))}
        </defs>
        {spec.actors.map((a, i) => (
          <g key={a}>
            <line x1={x(i)} x2={x(i)} y1={HEAD} y2={rows.height} stroke="currentColor" strokeOpacity={0.18} strokeDasharray="3 4" />
            <rect x={x(i) - 52} y={6} width={104} height={HEAD - 10} rx={6} fill="var(--card)" stroke="currentColor" strokeOpacity={0.25} />
            <text x={x(i)} y={6 + (HEAD - 10) / 2 + 4} textAnchor="middle" fontSize="12" fill="currentColor">
              {a}
            </text>
          </g>
        ))}
        {rows.placed.map((s, i) => {
          const p = progress(s.row);
          if (p <= 0) return null;
          const y = rows.tops[s.row] + s.sub * SUB;
          const x1 = x(s.from);
          const x2 = x(s.to);
          const head = x1 + (x2 - x1) * p;
          const color = COLOR[s.kind];
          const dir = Math.sign(x2 - x1) || 1;
          return (
            <g key={i} opacity={p < 1 ? 1 : 0.85}>
              <line
                x1={x1 + dir * 2}
                x2={head - dir * 1}
                y1={y}
                y2={y}
                stroke={color}
                strokeWidth={1.8}
                strokeDasharray={s.kind === 'async' ? '4 4' : s.kind === 'res' ? '6 3' : undefined}
                markerEnd={p >= 1 ? `url(#seq-${s.kind})` : undefined}
              />
              {p < 1 && <circle cx={head} cy={y} r={4} fill={color} />}
              {s.label && (
                <text
                  x={(x1 + x2) / 2}
                  y={y - 4}
                  textAnchor="middle"
                  fontSize="10.5"
                  fill={color}
                  opacity={Math.min(1, p * 2)}
                  className="font-mono"
                >
                  {s.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {spec.caption && <p className="px-1 pt-1 text-[12px] text-muted-foreground">{spec.caption}</p>}
      {!reduced && (
        <button
          type="button"
          onClick={() => {
            startRef.current = performance.now();
            setT(0);
          }}
          className="absolute top-2 right-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Phát lại"
        >
          <RotateCcw className="size-3.5" />
        </button>
      )}
    </div>
  );
}
