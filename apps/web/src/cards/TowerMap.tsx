import { useEffect, useRef } from 'react';
import { CircleHelp, Coffee, Crown, Skull, Store, Swords } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Content, NodeKind, RunState } from './types';
import { bossOf, reachable, towerMap } from './run';

export const NODE_INFO: Record<NodeKind, { icon: LucideIcon; label: string; tone: string }> = {
  battle: { icon: Swords, label: 'Trận thường', tone: 'text-sky-200 border-sky-300/50 bg-sky-500/10' },
  elite: { icon: Skull, label: 'Tinh anh: địch mạnh hơn, thưởng relic, thêm 1 lựa chọn và máu tối đa', tone: 'text-rose-200 border-rose-400/60 bg-rose-500/15' },
  rest: { icon: Coffee, label: 'Nghỉ: hồi Error Budget, bỏ bớt hoặc nâng cấp lá', tone: 'text-emerald-200 border-emerald-300/50 bg-emerald-500/10' },
  event: { icon: CircleHelp, label: 'Sự cố: một lựa chọn bất ngờ', tone: 'text-violet-200 border-violet-300/50 bg-violet-500/10' },
  shop: { icon: Store, label: 'Cửa hàng: mua lá, relic, bỏ bớt lá bằng vàng', tone: 'text-yellow-200 border-yellow-300/60 bg-yellow-500/10' },
  boss: { icon: Crown, label: 'Trùm của tầng', tone: 'text-amber-200 border-amber-300/70 bg-amber-400/15' },
};

const ROW_H = 84;
const PAD = 48;

/** Small seeded offsets so the grid does not look like a grid. */
const jitter = (seed: number, act: number, id: number, k: number) => ((((Math.imul(id + 1, 2654435761) ^ seed) + act * 977 + k * 131) >>> 0) % 17) - 8;

/** One floor of the tower: boss on top, entry row at the bottom. */
export function TowerMap({ content, run, onChoose }: { content: Content; run: RunState; onChoose: (id: number) => void }) {
  const map = towerMap(content, run);
  const { rows, width } = content.run.map;
  const open = new Set(run.phase === 'map' ? reachable(content, run) : []);
  const visited = new Set(run.path);
  const height = PAD * 2 + rows * ROW_H;
  const currentRow = run.node === null ? -1 : (map.nodes.find((n) => n.id === run.node)?.row ?? -1);

  const pos = (id: number) => {
    const n = map.nodes.find((m) => m.id === id)!;
    const boss = n.kind === 'boss';
    return {
      x: ((n.col + 0.5) / width) * 100 + (boss ? 0 : jitter(run.seed, run.act, id, 0) * 0.4),
      y: height - PAD - n.row * ROW_H + (boss ? 0 : jitter(run.seed, run.act, id, 1)),
    };
  };
  const onPath = (a: number, b: number) => {
    const i = run.path.indexOf(a);
    return i >= 0 && run.path[i + 1] === b;
  };

  const focus = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    focus.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [run.node, run.act]);
  const firstOpen = [...open][0];

  const boss = content.enemies.find((e) => e.id === bossOf(content, run.act));

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3">
      <div className="text-center">
        <div className="text-xl font-bold">
          Tầng {run.act}/{content.run.acts}
        </div>
        <p className="text-sm text-muted-foreground">
          {boss?.name} chờ ở đỉnh. {run.node === null ? 'Chọn một lối vào ở hàng dưới cùng.' : 'Chọn nút sáng tiếp theo để leo lên.'}
        </p>
      </div>
      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {(['battle', 'elite', 'event', 'rest', 'shop', 'boss'] as const).map((k) => {
          const Icon = NODE_INFO[k].icon;
          return (
            <li key={k} className="flex items-center gap-1" title={NODE_INFO[k].label}>
              <Icon className="size-3.5" /> {NODE_INFO[k].label.split(':')[0]}
            </li>
          );
        })}
      </ul>
      <div className="relative w-full rounded-2xl border border-border/60 bg-card/40 backdrop-blur-[2px]" style={{ height }}>
        <svg className="absolute inset-0 size-full" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden>
          {map.nodes.flatMap((n) =>
            n.next.map((to) => {
              const a = pos(n.id);
              const b = pos(to);
              const walked = onPath(n.id, to);
              const ahead = n.id === run.node && open.has(to);
              return (
                <line
                  key={`${n.id}-${to}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={walked ? 3 : 1.5}
                  strokeDasharray={walked ? undefined : '4 5'}
                  className={walked ? 'stroke-amber-300/80' : ahead ? 'stroke-amber-200/70' : n.row < currentRow ? 'stroke-border/40' : 'stroke-muted-foreground/35'}
                />
              );
            }),
          )}
        </svg>
        {map.nodes.map((n) => {
          const { x, y } = pos(n.id);
          const info = NODE_INFO[n.kind];
          const Icon = info.icon;
          const here = n.id === run.node;
          const can = open.has(n.id);
          const past = !visited.has(n.id) && n.row <= currentRow;
          const big = n.kind === 'boss';
          return (
            <button
              key={n.id}
              ref={can ? (n.id === firstOpen ? focus : undefined) : here && open.size === 0 ? focus : undefined}
              type="button"
              disabled={!can}
              onClick={() => onChoose(n.id)}
              aria-label={`${info.label.split(':')[0]}, bậc ${n.row + 1}${here ? ' (đang ở đây)' : visited.has(n.id) ? ' (đã qua)' : can ? ' (đi được)' : ''}`}
              title={info.label}
              style={{ left: `${x}%`, top: y }}
              className={cn(
                'absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 transition-[transform,opacity] duration-200',
                big ? 'size-16' : 'size-11',
                info.tone,
                visited.has(n.id) && 'ring-2 ring-amber-300/80 ring-offset-2 ring-offset-background',
                here && 'scale-110',
                can && 'cursor-pointer border-amber-300 shadow-[0_0_22px_rgba(252,211,77,0.55)] hover:scale-115 motion-safe:animate-pulse focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200',
                !can && !visited.has(n.id) && (past ? 'opacity-20' : 'opacity-45'),
              )}
            >
              <Icon className={big ? 'size-8' : 'size-5'} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
