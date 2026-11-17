import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { bezierAt, bezierFor, bezierPath, payloadScale, setEdgeGeometry } from '@/gpu/edgeGeometry';
import type { FlowEdgeType } from '@/model/flow';
import { cn } from '@/lib/utils';

/** Vertical gap between edges that leave or enter the same side of a node. */
const SPREAD = 14;
const MAX_SPREAD = 64;
const offset = (slot: number, count: number) => {
  if (count <= 1) return 0;
  const gap = Math.min(SPREAD, MAX_SPREAD / (count - 1));
  return (slot - (count - 1) / 2) * gap;
};
const kb = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(1)}MB` : `${+v.toFixed(1)}KB`);
const CIRCLED = '⓪①②③④⑤⑥⑦⑧⑨⑩';

/**
 * Draws the edge and its badges, and publishes the exact bezier (plus payload
 * style) so particles follow it. Edges sharing a node side are fanned out;
 * the badge at the source end says how the caller uses this edge:
 * ①②③ = step of a sequence, ∥ = parallel, ⇢ = fire-and-forget, ⇄ = one of
 * several (round-robin).
 */
export function FlowEdge({ id, sourceX, sourceY, targetX, targetY, data, selected, markerEnd }: EdgeProps<FlowEdgeType>) {
  const v = data?.view;
  const sy = sourceY + (v ? offset(v.outSlot, v.outCount) : 0);
  const ty = targetY + (v ? offset(v.inSlot, v.inCount) : 0);
  const b = bezierFor(sourceX, sy, targetX, ty);
  const p = data?.policy;
  const ff = !!p?.fireAndForget && v?.routing !== 'pick';
  if (data) setEdgeGeometry(data.index, b, [payloadScale(p?.requestKb), payloadScale(p?.responseKb), ff ? 1 : 0, 0]);
  const m = data?.metrics;
  const breaker = m?.breaker ?? 'closed';
  const stroke =
    breaker === 'open'
      ? 'var(--destructive)'
      : breaker === 'halfOpen'
        ? 'var(--warning)'
        : selected
          ? 'var(--primary)'
          : undefined;
  // thicker with traffic: 1.5px idle, ~4px at 10k calls/s
  const width = (selected || breaker !== 'closed' ? 2 : 1.5) + Math.min(2.5, Math.log10(1 + (m?.calls ?? 0)) * 0.6);

  const badges: { text: string; bad?: boolean }[] = [];
  if (p?.timeoutMs) badges.push({ text: `⏱ ${p.timeoutMs}ms` });
  if (p?.retries) badges.push({ text: `↻ ${p.retries}` });
  if (p?.circuitBreaker) badges.push({ text: breaker === 'closed' ? 'CB' : `CB ${breaker === 'open' ? 'OPEN' : 'half'}`, bad: breaker === 'open' });
  const pool = m?.poolUtilization ?? 0;
  if (p?.poolSize) badges.push({ text: `pool ${p.poolSize}${pool > 0.01 ? ` · ${Math.round(pool * 100)}%` : ''}`, bad: pool > 0.9 });
  if (p?.requestKb || p?.responseKb) {
    const link = m?.bandwidthUtilization ?? 0;
    badges.push({
      text: [p.requestKb ? `↑${kb(p.requestKb)}` : '', p.responseKb ? `↓${kb(p.responseKb)}` : '', link > 0.3 ? `link ${Math.round(link * 100)}%` : '']
        .filter(Boolean)
        .join(' '),
      bad: link > 0.85,
    });
  }

  // how the caller uses this edge, shown near the source end
  let role: { text: string; title: string } | null = null;
  if (v && v.outCount > 1) {
    if (ff) role = { text: '⇢', title: 'fire-and-forget: gửi đi, không chờ trả lời' };
    else if (v.routing === 'sequence') role = { text: CIRCLED[v.step] ?? String(v.step), title: `bước ${v.step}/${v.steps}: gọi tuần tự` };
    else if (v.routing === 'parallel') role = { text: '∥', title: 'song song: gọi cùng lúc, chờ tất cả' };
    else role = { text: '⇄', title: 'chọn 1 trong các nhánh (round-robin)' };
  } else if (ff) role = { text: '⇢', title: 'fire-and-forget: gửi đi, không chờ trả lời' };

  const [mx, my] = bezierAt(b, 0.5);
  const [rx, ry] = bezierAt(b, 0.28);

  return (
    <>
      <BaseEdge
        id={id}
        path={bezierPath(b)}
        interactionWidth={16}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth: width,
          strokeDasharray: breaker === 'open' ? '6 4' : ff ? '2 5' : undefined,
          strokeLinecap: 'round',
        }}
      />
      <EdgeLabelRenderer>
        {role && (
          <div
            title={role.title}
            className={cn(
              'nodrag nopan pointer-events-auto absolute flex size-[18px] items-center justify-center rounded-full border bg-background font-mono text-[11px] leading-none',
              v?.routing === 'sequence' && !ff ? 'border-primary/60 text-primary' : 'text-muted-foreground',
            )}
            style={{ transform: `translate(-50%, -50%) translate(${rx}px, ${ry}px)`, zIndex: 3 }}
          >
            {role.text}
          </div>
        )}
        {badges.length > 0 && (
          <div
            className="nodrag nopan pointer-events-none absolute flex gap-1"
            style={{ transform: `translate(-50%, -150%) translate(${mx}px, ${my}px)`, zIndex: 2 }}
          >
            {badges.map((t) => (
              <span
                key={t.text}
                className={cn(
                  'rounded border bg-background/90 px-1 font-mono text-[9px] leading-4 whitespace-nowrap text-muted-foreground',
                  t.bad && 'border-destructive text-destructive',
                )}
              >
                {t.text}
              </span>
            ))}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
