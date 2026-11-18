import { BaseEdge, EdgeLabelRenderer, useStore, type EdgeProps } from '@xyflow/react';
import { arcFractions, bezierFor, bezierPath, flattenBezier, payloadScale, pointAt, roundedPath, setEdgeGeometry } from '@/gpu/edgeGeometry';
import { fanOffset, type FlowEdgeType } from '@/model/flow';
import { cn } from '@/lib/utils';
import { useEdgeFocus } from './edgeFocus';

/** Below this zoom, plain labels are unreadable, so only warnings stay. */
const LABEL_ZOOM = 0.75;

const kb = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(1)}MB` : `${+v.toFixed(1)}KB`);
const CIRCLED = '⓪①②③④⑤⑥⑦⑧⑨⑩';

/**
 * Draws the edge and its badges, and publishes the exact bezier (plus payload
 * style) so particles follow it. Edges sharing a node side are fanned out;
 * the badge at the source end says how the caller uses this edge:
 * ①②③ = step of a sequence, ∥ = parallel, ⇢ = fire-and-forget, ⇄ = one of
 * several (round-robin).
 *
 * To stay readable when many services call each other: back edges loop
 * around the nodes instead of crossing them, edges joining the same pair
 * share one label box, hovering or selecting a node dims every edge that
 * does not touch it, and plain labels hide when zoomed out. In orthogonal
 * style the edge follows the route computed in `decorateEdges` instead.
 */
export function FlowEdge({ id, source, target, sourceX, sourceY, targetX, targetY, data, selected, markerEnd }: EdgeProps<FlowEdgeType>) {
  const v = data?.view;
  const sy = sourceY + (v ? fanOffset(v.outSlot, v.outCount) : 0);
  const ty = targetY + (v ? fanOffset(v.inSlot, v.inCount) : 0);
  let svg: string;
  let poly: number[];
  if (v?.route) {
    // routed from node boxes: pin the side ports to the real handles
    poly = v.route.slice();
    const n = poly.length;
    if (!v.vertical) {
      if (poly[1] === poly[3]) poly[3] = sy;
      if (poly[n - 1] === poly[n - 3]) poly[n - 3] = ty;
      [poly[0], poly[1], poly[n - 2], poly[n - 1]] = [sourceX, sy, targetX, ty];
    }
    svg = roundedPath(poly);
  } else {
    const vt = v?.vertical;
    const b = vt ? bezierFor(vt.sx, vt.sy, vt.tx, vt.ty, undefined, true) : bezierFor(sourceX, sy, targetX, ty, v?.backY);
    svg = bezierPath(b);
    poly = flattenBezier(b);
  }
  const arc = arcFractions(poly);
  const at = (t: number) => pointAt(poly, t, arc);
  const focus = useEdgeFocus(id, source, target);
  const zoomedIn = useStore((st) => st.transform[2] >= LABEL_ZOOM);
  const dim = focus === false;
  // labels: always when focused, never when dimmed, else only when readable
  const showLabels = focus === true || selected || (focus === null && zoomedIn);
  const p = data?.policy;
  const ff = !!p?.fireAndForget && v?.routing !== 'pick';
  if (data) setEdgeGeometry(data.index, poly, [payloadScale(p?.requestKb), payloadScale(p?.responseKb), ff ? 1 : 0, 0]);
  const m = data?.metrics;
  const breaker = m?.breaker ?? 'closed';
  const partitioned = !!m?.partitioned;
  const stroke =
    partitioned || breaker === 'open'
      ? 'var(--destructive)'
      : breaker === 'halfOpen'
        ? 'var(--warning)'
        : selected
          ? 'var(--primary)'
          : undefined;
  // thicker with traffic: 1.5px idle, ~4px at 10k calls/s
  const width = (selected || breaker !== 'closed' ? 2 : 1.5) + Math.min(2.5, Math.log10(1 + (m?.calls ?? 0)) * 0.6);

  const badges: { text: string; bad?: boolean; warn?: boolean }[] = [];
  if (p?.timeoutMs) badges.push({ text: `⏱ ${p.timeoutMs}ms` });
  if (p?.retries) badges.push({ text: `↻ ${p.retries}` });
  if (p?.circuitBreaker) badges.push({ text: breaker === 'closed' ? 'CB' : `CB ${breaker === 'open' ? 'OPEN' : 'half'}`, bad: breaker === 'open' });
  const pool = m?.poolUtilization ?? 0;
  if (data?.lint && data.lint.worst !== 'info') badges.push({ text: `! ${data.lint.count}`, bad: data.lint.worst === 'error', warn: true });
  if (partitioned) badges.push({ text: '✂ partition', bad: true });
  if (p?.rateLimit) badges.push({ text: `⛁ ${p.rateLimit.rps}/s`, bad: (m?.rateLimited ?? 0) > 0 });
  if (p?.retryBudget) badges.push({ text: `↻≤${Math.round(p.retryBudget.ratio * 100)}%`, bad: (m?.budgetExhausted ?? 0) > 0 });
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
    else if (v.routing === 'hedge') role = { text: v.step === 1 ? '⧗' : String(v.step), title: `hedge: nhánh thử thứ ${v.step}` };
    else if (v.routing === 'quorum') role = { text: 'k', title: 'quorum: gọi tất cả, đủ k nhánh OK là xong' };
    else role = { text: '⇄', title: 'chọn 1 trong các nhánh (round-robin)' };
  } else if (ff) role = { text: '⇢', title: 'fire-and-forget: gửi đi, không chờ trả lời' };

  // which handler calls which endpoint (`create → /write`), one box per bundle
  const routes = showLabels ? (v?.routes ?? []) : [];
  const shown = showLabels ? badges : dim ? [] : badges.filter((t) => t.bad || t.warn);
  // badges of a bundle sit side by side along the curve instead of stacking
  const [mx, my] = at(0.56 + (v && v.pairCount > 1 ? (v.pairSlot - (v.pairCount - 1) / 2) * 0.12 : 0));
  // role badge near the source, route box past the middle, so they never meet
  const [rx, ry] = at(0.13 + (v?.pairSlot ?? 0) * 0.06);
  const [lx, ly] = at(0.56);

  return (
    <>
      <BaseEdge
        id={id}
        path={svg}
        interactionWidth={16}
        markerEnd={markerEnd}
        style={{
          stroke,
          opacity: dim ? 0.12 : 1,
          transition: 'opacity 120ms',
          strokeWidth: width,
          strokeDasharray: partitioned ? '1 6' : breaker === 'open' ? '6 4' : ff ? '2 5' : undefined,
          strokeLinecap: 'round',
        }}
      />
      <EdgeLabelRenderer>
        {role && !dim && (
          <div
            title={role.title}
            className={cn(
              'nodrag nopan pointer-events-auto absolute flex size-[18px] items-center justify-center rounded-full border bg-background font-mono text-[12px] leading-none',
              v?.routing === 'sequence' && !ff ? 'border-primary/60 text-primary' : 'text-muted-foreground',
            )}
            style={{ transform: `translate(-50%, -50%) translate(${rx}px, ${ry}px)`, zIndex: 3 }}
          >
            {role.text}
          </div>
        )}
        {routes.length > 0 && (
          <div
            className="nodrag nopan pointer-events-none absolute flex flex-col items-start rounded border border-primary/30 bg-background/90 px-1 py-px"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, zIndex: 2 }}
          >
            {routes.map((r, i) => (
              <span key={i} className="font-mono text-[10px] leading-[14px] whitespace-nowrap text-muted-foreground">
                {r}
              </span>
            ))}
          </div>
        )}
        {shown.length > 0 && (
          <div
            className="nodrag nopan pointer-events-none absolute flex gap-1"
            style={{ transform: `translate(-50%, -100%) translate(${mx}px, ${my - (routes.length ? routes.length * 7 + 4 : 6)}px)`, zIndex: 2 }}
          >
            {shown.map((t) => (
              <span
                key={t.text}
                className={cn(
                  'rounded border bg-background/90 px-1 font-mono text-[10px] leading-4 whitespace-nowrap text-muted-foreground',
                  t.bad && 'border-destructive text-destructive',
                  t.warn && !t.bad && 'border-warning text-warning',
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
