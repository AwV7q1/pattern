import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CardDef, CardType } from './types';
import { reduced } from './fx';

export const TYPE_STYLE: Record<CardType, { label: string; ring: string; head: string; chip: string }> = {
  infra: { label: 'Hạ tầng', ring: 'border-sky-500/60', head: 'from-sky-500/25', chip: 'bg-sky-500/20 text-sky-300' },
  policy: { label: 'Chính sách', ring: 'border-violet-500/60', head: 'from-violet-500/25', chip: 'bg-violet-500/20 text-violet-300' },
  action: { label: 'Hành động', ring: 'border-emerald-500/60', head: 'from-emerald-500/25', chip: 'bg-emerald-500/20 text-emerald-300' },
  attack: { label: 'Phản công', ring: 'border-rose-500/60', head: 'from-rose-500/25', chip: 'bg-rose-500/20 text-rose-300' },
  curse: { label: 'Lời nguyền', ring: 'border-zinc-600', head: 'from-zinc-500/20', chip: 'bg-zinc-500/20 text-zinc-400' },
};

const CARD_W = 160;
const CARD_H = 224;
/** Radius of the circle the hand is laid out on. */
const FAN_R = 1100;
/** How much of a resting card hides below the screen edge. */
const SINK = 64;
const LIFT = 92;
/** Deal / discard timing: one card's flight and the gap between cards. */
const DEAL_MS = 340;
const DEAL_GAP = 70;
const DISCARD_MS = 300;
const DISCARD_GAP = 40;

/** How long the hand takes to fly into the discard pile. */
export const discardDuration = (n: number) => (reduced() || n === 0 ? 0 : (n - 1) * DISCARD_GAP + DISCARD_MS);

/** Center of `el` on screen. */
function center(el: Element) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** A screen-space offset expressed in the frame of a card rotated by `theta`. */
function toLocal(dx: number, dy: number, theta: number) {
  const c = Math.cos(-theta);
  const s = Math.sin(-theta);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export interface HandCard {
  uid: number;
  def: CardDef;
  playable: boolean;
}

interface Drag {
  uid: number;
  pointerId: number;
  startX: number;
  startY: number;
  /** Pointer offset inside the card. */
  dx: number;
  dy: number;
  x: number;
  y: number;
  active: boolean;
  over: boolean;
}

/**
 * The hand: cards fanned out along an arc at the bottom of the screen, a
 * card rises when hovered and can be dragged into `dropRef` to play it.
 * Keyboard: Enter/Space on a focused card plays it (clicks do not, so a
 * misclick never spends Ops).
 */
export function Hand({
  cards,
  dropRef,
  onPlay,
  onDragChange,
  deckRef,
  discardRef,
  discarding = false,
}: {
  cards: HandCard[];
  dropRef: RefObject<HTMLElement | null>;
  /** New cards fly in from the draw pile... */
  deckRef?: RefObject<HTMLElement | null>;
  /** ...and the hand flies into the discard pile while `discarding`. */
  discardRef?: RefObject<HTMLElement | null>;
  discarding?: boolean;
  onPlay: (uid: number, at: { x: number; y: number }) => void;
  /** The drag state and, while dragging, the dragged card. */
  onDragChange?: (state: 'idle' | 'dragging' | 'over', card: CardDef | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const n = cards.length;
  /** The element of each card that the deal / discard animations move. */
  const flyEls = useRef(new Map<number, HTMLDivElement>());
  const seen = useRef(new Set<number>());
  const [entering, setEntering] = useState<ReadonlySet<number>>(new Set());
  const discardAnims = useRef<Animation[]>([]);

  // deal: every card not seen before flies in from the draw pile, one after another
  const uidKey = cards.map((c) => c.uid).join(',');
  useLayoutEffect(() => {
    const fresh = cards.filter((c) => !seen.current.has(c.uid));
    for (const c of cards) seen.current.add(c.uid);
    const deck = deckRef?.current;
    if (!fresh.length || !deck || reduced()) return;
    const from = center(deck);
    const uids = fresh.map((c) => c.uid);
    setEntering((prev) => new Set([...prev, ...uids]));
    fresh.forEach((c, k) => {
      const el = flyEls.current.get(c.uid);
      if (!el) return;
      const to = center(el);
      const d = toLocal(from.x - to.x, from.y - to.y, Number(el.dataset.theta ?? 0));
      const anim = el.animate(
        [
          { transform: `translate(${d.x}px, ${d.y}px) rotate(-24deg) scale(0.3)`, opacity: 0 },
          { opacity: 1, offset: 0.25 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: DEAL_MS, delay: k * DEAL_GAP, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'backwards' },
      );
      void anim.finished
        .catch(() => undefined)
        .then(() =>
          setEntering((prev) => {
            const next = new Set(prev);
            next.delete(c.uid);
            return next;
          }),
        );
    });
    // only the set of cards matters, not their props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uidKey]);

  // discard: the whole hand flies into the discard pile; if the turn is
  // called off (engine error) the cards come back
  useLayoutEffect(() => {
    if (!discarding) {
      for (const a of discardAnims.current) a.cancel();
      discardAnims.current = [];
      return;
    }
    setHover(null);
    const pile = discardRef?.current;
    if (!pile) return;
    const to = center(pile);
    const instant = reduced();
    discardAnims.current = cards.flatMap((c, k) => {
      const el = flyEls.current.get(c.uid);
      if (!el) return [];
      const from = center(el);
      const d = toLocal(to.x - from.x, to.y - from.y, Number(el.dataset.theta ?? 0));
      return el.animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: `translate(${d.x * 0.4}px, ${d.y * 0.4 - 30}px) rotate(10deg) scale(0.7)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${d.x}px, ${d.y}px) rotate(28deg) scale(0.25)`, opacity: 0 },
        ],
        { duration: instant ? 1 : DISCARD_MS, delay: instant ? 0 : k * DISCARD_GAP, easing: 'cubic-bezier(0.5, 0, 0.7, 0.4)', fill: 'forwards' },
      );
    });
    // runs when discarding toggles; the hand cannot change meanwhile
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discarding]);

  const dragDef = drag?.active ? (cards.find((c) => c.uid === drag.uid)?.def ?? null) : null;
  useEffect(() => {
    onDragChange?.(!drag?.active ? 'idle' : drag.over ? 'over' : 'dragging', dragDef);
  }, [drag?.active, drag?.over, dragDef, onDragChange]);

  // the hovered card can be played away (keyboard) or leave the hand
  useEffect(() => {
    if (hover !== null && !cards.some((c) => c.uid === hover)) setHover(null);
  }, [cards, hover]);

  const isOver = (x: number, y: number) => {
    const zone = dropRef.current?.getBoundingClientRect();
    const hand = handRef.current?.getBoundingClientRect();
    if (!zone) return false;
    const inZone = x >= zone.left && x <= zone.right && y >= zone.top && y <= zone.bottom;
    // the hand itself sits on top of the arena: dropping back on it cancels
    return inZone && (!hand || y < hand.top + 40);
  };

  // spacing between neighbours shrinks as the hand grows
  // and on narrow screens, so the corners (Ops, end turn) stay clear
  const spread = Math.max(300, Math.min(720, window.innerWidth - 600));
  const spacing = Math.min(124, spread / Math.max(n - 1, 1));
  const step = Math.asin(spacing / FAN_R);
  const hoverIdx = cards.findIndex((c) => c.uid === hover);

  return (
    <>
      <div ref={handRef} inert={discarding} className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[190px]">
        <div className="absolute bottom-0 left-1/2">
          {cards.map((c, i) => {
            const t = i - (n - 1) / 2;
            const theta = t * step;
            let x = FAN_R * Math.sin(theta);
            const y = FAN_R * (1 - Math.cos(theta));
            const flying = entering.has(c.uid) || discarding;
            const lifted = hover === c.uid && !drag?.active && !flying;
            // neighbours make room for the raised card
            if (hoverIdx >= 0 && !lifted && !drag?.active) x += Math.sign(i - hoverIdx) * 26;
            const dragging = drag?.active && drag.uid === c.uid;
            const slot: CSSProperties = {
              width: CARD_W,
              height: CARD_H,
              left: -CARD_W / 2,
              bottom: -SINK,
              zIndex: lifted ? 50 : i + 1,
              transform: `translate(${x}px, ${y}px) rotate(${theta}rad)`,
              transformOrigin: '50% 100%',
            };
            return (
              <div
                key={c.uid}
                className={cn('absolute transition-transform duration-200 ease-out', flying ? 'pointer-events-none' : 'pointer-events-auto')}
                style={slot}
                onPointerEnter={() => setHover(c.uid)}
                onPointerLeave={() => setHover((h) => (h === c.uid ? null : h))}
              >
                <button
                  type="button"
                  aria-label={`${c.def.name}${c.playable ? '' : ' (không đánh được)'}`}
                  aria-disabled={!c.playable}
                  onFocus={() => setHover(c.uid)}
                  onBlur={() => setHover((h) => (h === c.uid ? null : h))}
                  onClick={(e) => {
                    // keyboard activation only (detail 0); mouse plays by dragging
                    if (e.detail === 0 && c.playable) {
                      const r = e.currentTarget.getBoundingClientRect();
                      onPlay(c.uid, { x: r.left + r.width / 2, y: r.top - 120 });
                    }
                  }}
                  onPointerDown={(e) => {
                    if (!c.playable || e.button !== 0) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDrag({
                      uid: c.uid,
                      pointerId: e.pointerId,
                      startX: e.clientX,
                      startY: e.clientY,
                      dx: e.clientX - r.left,
                      dy: e.clientY - r.top,
                      x: e.clientX,
                      y: e.clientY,
                      active: false,
                      over: false,
                    });
                  }}
                  onPointerMove={(e) => {
                    if (!drag || drag.pointerId !== e.pointerId) return;
                    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6;
                    setDrag({ ...drag, x: e.clientX, y: e.clientY, active: drag.active || moved, over: isOver(e.clientX, e.clientY) });
                  }}
                  onPointerUp={(e) => {
                    if (!drag || drag.pointerId !== e.pointerId) return;
                    const played = drag.active && isOver(e.clientX, e.clientY);
                    setDrag(null);
                    if (played) {
                      setHover(null);
                      onPlay(drag.uid, { x: e.clientX - drag.dx + CARD_W / 2, y: e.clientY - drag.dy + CARD_H / 2 });
                    }
                  }}
                  onPointerCancel={() => setDrag(null)}
                  className={cn(
                    'block size-full touch-none rounded-xl outline-none transition-[transform,opacity] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring',
                    c.playable ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed',
                    dragging && 'opacity-0',
                  )}
                  style={{
                    transform: lifted ? `rotate(${-theta}rad) translateY(${-LIFT - y}px) scale(1.1)` : undefined,
                    transformOrigin: '50% 100%',
                  }}
                >
                  <div
                    className="size-full"
                    data-theta={theta}
                    ref={(el) => {
                      if (el) flyEls.current.set(c.uid, el);
                      else flyEls.current.delete(c.uid);
                    }}
                  >
                    <CardFace def={c.def} playable={c.playable} index={i + 1} lifted={lifted} />
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {drag?.active &&
        (() => {
          const c = cards.find((k) => k.uid === drag.uid);
          if (!c) return null;
          const tilt = Math.max(-12, Math.min(12, (drag.x - drag.startX) / 30));
          return (
            <div
              className="pointer-events-none fixed z-50"
              style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: CARD_W, height: CARD_H, transform: `rotate(${tilt}deg) scale(${drag.over ? 1.08 : 1.02})` }}
            >
              <CardFace def={c.def} playable glowing={drag.over} />
            </div>
          );
        })()}
    </>
  );
}

export function CardFace({
  def,
  playable,
  index,
  lifted,
  glowing,
}: {
  def: CardDef;
  playable: boolean;
  index?: number;
  lifted?: boolean;
  glowing?: boolean;
}) {
  const style = TYPE_STYLE[def.type];
  return (
    <div
      className={cn(
        'relative flex size-full flex-col overflow-hidden rounded-xl border-2 bg-card text-left shadow-xl shadow-black/50 transition-[box-shadow,filter] duration-200',
        style.ring,
        !playable && 'brightness-75 saturate-50',
        lifted && 'shadow-2xl shadow-black/70',
        glowing && 'shadow-[0_0_28px_6px_rgba(251,191,36,0.45)]',
      )}
    >
      <div className={cn('bg-gradient-to-b to-transparent px-3 pb-2 pt-3', style.head)}>
        <div className="flex items-start gap-2">
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-full border-2 font-mono text-sm font-bold',
              def.unplayable ? 'border-zinc-600 text-zinc-500' : 'border-amber-300 bg-amber-400/20 text-amber-200',
            )}
          >
            {def.unplayable ? '–' : def.cost}
          </span>
          <span className="text-sm font-semibold leading-tight">{def.name}</span>
        </div>
        <span className={cn('mt-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium', style.chip)}>{style.label}</span>
      </div>
      <p className="flex-1 px-3 text-xs leading-snug">{def.text}</p>
      {def.exhaust && <p className="px-3 text-[10px] text-amber-300/80">Tiêu hao</p>}
      <p className="border-t px-3 py-2 text-[10px] italic leading-snug text-muted-foreground">{def.lesson}</p>
      {index !== undefined && <span className="absolute right-2 top-2 font-mono text-[10px] text-muted-foreground/60">{index}</span>}
      {lifted && !playable && (
        <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-black/70 py-1 text-center text-xs font-medium text-amber-200">
          {def.unplayable ? 'Không thể đánh' : 'Không đủ Ops'}
        </span>
      )}
    </div>
  );
}

export const CARD_SIZE = { w: CARD_W, h: CARD_H };

/** A small face-down stack (draw or discard pile) with its count. */
export function Pile({
  pileRef,
  count,
  label,
  tone,
}: {
  pileRef: RefObject<HTMLDivElement | null>;
  count: number;
  label: string;
  tone: 'draw' | 'discard';
}) {
  const layers = Math.min(3, count);
  const back =
    tone === 'draw'
      ? 'border-sky-400/50 bg-gradient-to-br from-sky-900 to-slate-900 text-sky-300/70'
      : 'border-zinc-500/50 bg-gradient-to-br from-zinc-800 to-zinc-900 text-zinc-400/70';
  return (
    <div ref={pileRef} className="relative flex flex-col items-center gap-1 rounded-md" title={`${label}: ${count} lá`} aria-label={`${label}: ${count} lá`}>
      <div className="relative h-[62px] w-[44px]">
        {count === 0 ? (
          <div className="absolute inset-0 rounded-md border border-dashed border-muted-foreground/30" />
        ) : (
          Array.from({ length: layers }, (_, k) => (
            <div
              key={k}
              className={cn('absolute inset-0 flex items-center justify-center rounded-md border shadow-md shadow-black/50', back)}
              style={{ transform: `translate(${(layers - 1 - k) * -2}px, ${(layers - 1 - k) * 2}px)` }}
            >
              {k === layers - 1 && <Layers className="size-4" />}
            </div>
          ))
        )}
        <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-background px-1 font-mono text-[11px] font-bold text-foreground ring-1 ring-border">
          {count}
        </span>
      </div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
