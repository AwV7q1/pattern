import { useContext } from 'react';
import { BaseEdge, EdgeLabelRenderer, useReactFlow, useStore, type EdgeProps } from '@xyflow/react';
import { arcFractions, bezierBetween, bezierFor, bezierPath, flattenBezier, payloadScale, pointAt, roundedPath, setEdgeGeometry } from '@/gpu/edgeGeometry';
import type { FlowEdgeType, PortView } from '@/model/flow';
import { MIN_STUB, normalizeBends, pathToBends, STUB } from '@/model/routing';
import type { Side } from '@/types';
import { cn } from '@/lib/utils';
import { useEdgeFocus } from './edgeFocus';
import { EdgeEditContext } from './edgeEdit';

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
 *
 * A selected edge can be reshaped by hand like a Figma connector: drag a
 * run's grip across to move it (end runs get a new jog), drag an end dot to
 * another side of its node. Double-click goes back to automatic routing.
 */
export function FlowEdge({ id, source, target, sourceX, sourceY, targetX, targetY, data, selected, markerEnd }: EdgeProps<FlowEdgeType>) {
  const v = data?.view;
  // React Flow's handles are the true ends on the default sides
  const from = v?.from;
  const to = v?.to;
  const p0 = { x: !from || from.side === 'right' ? sourceX : from.x, y: from ? from.y : sourceY };
  const p1 = { x: !to || to.side === 'left' ? targetX : to.x, y: to ? to.y : targetY };
  let svg: string;
  let poly: number[];
  if (v?.route) {
    poly = v.route.slice();
    const n = poly.length;
    [poly[0], poly[1], poly[n - 2], poly[n - 1]] = [p0.x, p0.y, p1.x, p1.y];
    svg = roundedPath(poly);
  } else {
    const b =
      v?.backY !== undefined || !from || !to
        ? bezierFor(p0.x, p0.y, p1.x, p1.y, v?.backY)
        : bezierBetween(p0.x, p0.y, from.dx, from.dy, p1.x, p1.y, to.dx, to.dy);
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
  const edit = useContext(EdgeEditContext);
  const rf = useReactFlow();
  const editable = !!(edit && selected && from && to && data);
  const ff = !!p?.fireAndForget && v?.routing !== 'pick';
  if (data) setEdgeGeometry(data.index, poly, [payloadScale(p?.requestKb), payloadScale(p?.responseKb), ff ? 1 : 0, 0]);
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

  // which handler calls which endpoint (`create → /write`), one box per bundle
  const routes = showLabels ? (v?.routes ?? []) : [];
  const shown = showLabels ? badges : dim ? [] : badges.filter((t) => t.bad);
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
          strokeDasharray: breaker === 'open' ? '6 4' : ff ? '2 5' : undefined,
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
                )}
              >
                {t.text}
              </span>
            ))}
          </div>
        )}
        {editable && (
          <EdgeHandles
            poly={poly}
            from={from!}
            to={to!}
            segments={edit!.orthogonal && !!v?.route}
            onSegment={(k, horizontal, startBends) => {
              // dragging run k across: an inner run moves; an end run gets a
              // new jog so it can stay attached to its port
              const m = poly.length / 2 - 1;
              const [f, t] = [from!, to!];
              const a0 = f.dx ? poly[0] + f.dx * STUB : poly[1] + f.dy * STUB;
              const a1 = t.dx ? poly[2 * m] - t.dx * STUB : poly[2 * m + 1] - t.dy * STUB;
              const base = startBends ?? [];
              const make = (c: number) =>
                m === 1 ? [a0, c, a1] : k === 0 ? [a0, c, ...base] : k === m - 1 ? [...base, c, a1] : base.map((b, i) => (i === k - 1 ? c : b));
              // magnets: line up with any other corner on that axis (straightens joints)
              const axis = horizontal ? 1 : 0;
              const others: number[] = [];
              for (let i = 0; i <= m; i++) if (i !== k && i !== k + 1) others.push(poly[2 * i + axis]);
              let last: number[] | null = null;
              const ends = { f: { ...f, x: poly[0], y: poly[1] }, t: { ...t, x: poly[2 * m], y: poly[2 * m + 1] } };
              return {
                move(pt: { x: number; y: number }) {
                  let c = Math.round((horizontal ? pt.y : pt.x) / 4) * 4;
                  const near = others.reduce((b, o) => (Math.abs(o - c) < Math.abs(b - c) ? o : b), Infinity);
                  if (Math.abs(near - c) < 7) c = near;
                  const bends = clampEnds(make(c), ends.f, ends.t);
                  last = bends;
                  edit!.set(id, { ...data!.layout, fromSide: f.side, toSide: t.side, bends });
                },
                done() {
                  if (last) edit!.set(id, { ...data!.layout, fromSide: f.side, toSide: t.side, bends: normalizeBends(ends.f, ends.t, last) ?? undefined });
                },
              };
            }}
            onEnd={(end) => {
              // dragging an end onto another side of its node re-attaches it there
              const node = end === 0 ? source : target;
              let side: Side = end === 0 ? from!.side : to!.side;
              return {
                move(pt: { x: number; y: number }) {
                  const n = rf.getInternalNode(node);
                  if (!n) return;
                  const w = n.measured.width ?? 200;
                  const h = n.measured.height ?? 110;
                  const dx = (pt.x - (n.internals.positionAbsolute.x + w / 2)) / (w / 2);
                  const dy = (pt.y - (n.internals.positionAbsolute.y + h / 2)) / (h / 2);
                  const next: Side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top';
                  if (next === side) return;
                  side = next;
                  const l = data!.layout;
                  edit!.set(id, { fromSide: end === 0 ? side : (l?.fromSide ?? from!.side), toSide: end === 1 ? side : (l?.toSide ?? to!.side) });
                },
                done() {},
              };
            }}
            begin={() => edit!.begin(id)}
            end={() => edit!.end(id)}
            toFlow={(x, y) => rf.screenToFlowPosition({ x, y })}
          />
        )}
      </EdgeLabelRenderer>
    </>
  );
}

/** Keep both end runs at least MIN_STUB long, going out of / into their ports. */
function clampEnds(bends: number[], f: PortView, t: PortView): number[] {
  const out = bends.slice();
  const n = out.length;
  if (!n) return out;
  const lim = (v: number, at: number, d: number) => (d > 0 ? Math.max(v, at + MIN_STUB) : Math.min(v, at - MIN_STUB));
  out[0] = f.dx ? lim(out[0], f.x, f.dx) : lim(out[0], f.y, f.dy);
  // the last bend is the coordinate, along the entry axis, of the run before the last
  out[n - 1] = t.dx ? -lim(-out[n - 1], -t.x, t.dx) : -lim(-out[n - 1], -t.y, t.dy);
  return out;
}

/** How far outside the node border an end dot sits, in screen pixels. */
const OUT = 16;

type Drag = { move(p: { x: number; y: number }): void; done(): void };

/**
 * Selected edge handles: a dot on each end (drag to another side of the
 * node) and, for orthogonal routes, a grip in the middle of each run (drag
 * across to move the run). Listens on window so a handle that re-renders
 * mid-drag does not lose the pointer.
 */
function EdgeHandles({
  poly,
  from,
  to,
  segments,
  onSegment,
  onEnd,
  begin,
  end,
  toFlow,
}: {
  poly: number[];
  from: PortView;
  to: PortView;
  segments: boolean;
  onSegment: (k: number, horizontal: boolean, startBends: number[] | null) => Drag;
  onEnd: (end: 0 | 1) => Drag;
  begin: () => void;
  end: () => void;
  toFlow: (x: number, y: number) => { x: number; y: number };
}) {
  const start = (ev: React.PointerEvent, drag: Drag) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    begin();
    const move = (e: PointerEvent) => drag.move(toFlow(e.clientX, e.clientY));
    const up = () => {
      // the release would also click the pane underneath and drop the selection
      const swallow = (e: MouseEvent) => e.stopPropagation();
      window.addEventListener('click', swallow, true);
      setTimeout(() => window.removeEventListener('click', swallow, true), 100);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      drag.done();
      end();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  // handles keep their on-screen size at any zoom
  const s = 1 / useStore((st) => st.transform[2]);
  const n = poly.length / 2;
  const grips: { k: number; x: number; y: number; horizontal: boolean }[] = [];
  if (segments)
    for (let k = 0; k < n - 1; k++) {
      const [x0, y0, x1, y1] = [poly[2 * k], poly[2 * k + 1], poly[2 * k + 2], poly[2 * k + 3]];
      const len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
      // end runs need room beside the node before they can be grabbed
      if (len < ((k === 0 || k === n - 2) ? OUT + 26 : 18) * s) continue;
      grips.push({ k, x: (x0 + x1) / 2, y: (y0 + y1) / 2, horizontal: Math.abs(y1 - y0) < 0.5 });
    }
  const dot = 'nodrag nopan pointer-events-auto absolute rounded-full border-background bg-primary shadow';
  return (
    <>
      {grips.map((g) => (
        <div
          key={`s${g.k}`}
          title="Kéo để dời đoạn này · double-click cạnh để về tự động"
          className="nodrag nopan pointer-events-auto absolute rounded-sm border-primary bg-background shadow-sm hover:bg-primary"
          style={{
            width: (g.horizontal ? 18 : 7) * s,
            height: (g.horizontal ? 7 : 18) * s,
            transform: `translate(-50%, -50%) translate(${g.x}px, ${g.y}px)`,
            cursor: g.horizontal ? 'ns-resize' : 'ew-resize',
            borderWidth: 1.5 * s,
            zIndex: 5,
          }}
          onPointerDown={(e) => start(e, onSegment(g.k, g.horizontal, pathToBends(poly)))}
        />
      ))}
      {([0, 1] as const).map((k) => {
        // clear of the border and its connect handle: nodes are drawn above edge labels
        const at = k === 0 ? [poly[0] + from.dx * OUT * s, poly[1] + from.dy * OUT * s] : [poly[2 * n - 2] - to.dx * OUT * s, poly[2 * n - 1] - to.dy * OUT * s];
        return (
        <div
          key={`e${k}`}
          title={`Kéo sang cạnh khác của node để đổi cổng nối (${(k === 0 ? from : to).side})`}
          className={dot}
          style={{
            width: 11 * s,
            height: 11 * s,
            transform: `translate(-50%, -50%) translate(${at[0]}px, ${at[1]}px)`,
            cursor: 'move',
            borderWidth: 2 * s,
            zIndex: 5,
          }}
          onPointerDown={(e) => start(e, onEnd(k))}
        />
        );
      })}
    </>
  );
}

