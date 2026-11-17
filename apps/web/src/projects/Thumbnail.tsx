import { memo } from 'react';
import { KIND_META } from '@/lib/meta';
import { techOf } from '@/tech/catalog';
import { brandColor } from '@/tech/TechLogo';
import type { StudioDesign } from './store';

const W = 200;
const H = 64;

/** Mini map of a design, drawn from node positions (nothing stored). */
export const Thumbnail = memo(function Thumbnail({ design, className }: { design: StudioDesign; className?: string }) {
  const nodes = design.nodes.filter((n) => n.position);
  if (!nodes.length) return <div className={className} />;
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const groups = design.groups ?? [];
  const minX = Math.min(...xs, ...groups.map((g) => g.position.x)) - 40;
  const minY = Math.min(...ys, ...groups.map((g) => g.position.y)) - 40;
  const maxX = Math.max(...xs.map((x) => x + W), ...groups.map((g) => g.position.x + g.size.width)) + 40;
  const maxY = Math.max(...ys.map((y) => y + H), ...groups.map((g) => g.position.y + g.size.height)) + 40;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <svg className={className} viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} preserveAspectRatio="xMidYMid meet">
      {groups.map((g) => (
        <rect
          key={g.id}
          x={g.position.x}
          y={g.position.y}
          width={g.size.width}
          height={g.size.height}
          rx={16}
          fill="oklch(1 0 0 / 3%)"
          stroke="oklch(1 0 0 / 18%)"
          strokeDasharray="12 8"
          strokeWidth={3}
        />
      ))}
      {design.edges.map((e, i) => {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b) return null;
        const x1 = a.position.x + W;
        const y1 = a.position.y + H / 2;
        const x2 = b.position.x;
        const y2 = b.position.y + H / 2;
        const mx = (x1 + x2) / 2;
        return (
          <path
            key={i}
            d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
            fill="none"
            stroke="oklch(1 0 0 / 22%)"
            strokeWidth={4}
          />
        );
      })}
      {nodes.map((n) => {
        const tech = techOf(n.tech);
        const color = tech ? brandColor(tech.logo.hex) : KIND_META[n.kind].color;
        return (
          <g key={n.id}>
            <rect x={n.position.x} y={n.position.y} width={W} height={H} rx={12} fill="oklch(0.21 0.006 285.885)" stroke="oklch(1 0 0 / 14%)" strokeWidth={3} />
            <rect x={n.position.x + 14} y={n.position.y + 14} width={36} height={36} rx={8} fill={color} />
            <rect x={n.position.x + 62} y={n.position.y + 20} width={110} height={10} rx={5} fill="oklch(1 0 0 / 35%)" />
            <rect x={n.position.x + 62} y={n.position.y + 38} width={70} height={8} rx={4} fill="oklch(1 0 0 / 15%)" />
          </g>
        );
      })}
    </svg>
  );
});
