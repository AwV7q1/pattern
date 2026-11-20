import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SOCKET_KIND_LABEL } from './Infra';
import type { CardDef, CardType, Rarity } from './types';
import { reduced } from './fx';
import { TYPE_ICON, cardIcon } from './cardArt';
import { CardPopover, CardText } from './CardText';
import { plainCardText } from './textFormat';

export const TYPE_STYLE: Record<CardType, { label: string; ring: string; frame: string; art: string; icon: string; chip: string }> = {
  infra: { label: 'Hạ tầng', ring: 'border-sky-400/70', frame: 'from-sky-950 to-zinc-950', art: 'from-sky-400/45 via-sky-800/40 to-slate-950', icon: 'text-sky-100', chip: 'bg-sky-500/20 text-sky-300' },
  policy: { label: 'Chính sách', ring: 'border-violet-400/70', frame: 'from-violet-950 to-zinc-950', art: 'from-violet-400/45 via-violet-800/40 to-slate-950', icon: 'text-violet-100', chip: 'bg-violet-500/20 text-violet-300' },
  action: { label: 'Hành động', ring: 'border-emerald-400/70', frame: 'from-emerald-950 to-zinc-950', art: 'from-emerald-400/45 via-emerald-800/40 to-slate-950', icon: 'text-emerald-100', chip: 'bg-emerald-500/20 text-emerald-300' },
  attack: { label: 'Phản công', ring: 'border-rose-400/70', frame: 'from-rose-950 to-zinc-950', art: 'from-rose-400/45 via-rose-800/40 to-slate-950', icon: 'text-rose-100', chip: 'bg-rose-500/20 text-rose-300' },
  curse: { label: 'Lời nguyền', ring: 'border-zinc-600', frame: 'from-zinc-900 to-zinc-950', art: 'from-zinc-500/30 via-zinc-800/40 to-zinc-950', icon: 'text-zinc-400', chip: 'bg-zinc-500/20 text-zinc-400' },
};

/** One card size everywhere (hand, rewards, shop, library): 5:7, like a playing card. */
const CARD_W = 196;
const CARD_H = 274;
/** Radius of the circle the hand is laid out on. */
const FAN_R = 1100;
/** How much of a resting card hides below the screen edge. */
const SINK = 84;
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
  /** Why it cannot be played, when it is not the Ops (shown on the lifted card). */
  blocked?: string;
}

/** Where a dragged card would land: your system, the enemy, or one of its minions. */
/** Where a dragged card would land: your system, a socket of it (replacing a module), the enemy or a minion. */
export type DropTarget = { kind: 'system' } | { kind: 'socket'; socket: string; replace?: number } | { kind: 'bot' } | { kind: 'minion'; uid: number };

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
  /** The target under the pointer, if the card can be dropped there. */
  over: DropTarget | null;
}

/**
 * The hand: cards fanned out along an arc at the bottom of the screen, a
 * card rises when hovered and can be dragged onto a target (`targetAt`) to play it.
 * Dragging is the only way to play a card: no clicks or keys, so nothing is
 * played by accident.
 */
export function Hand({
  cards,
  targetAt,
  onPlay,
  onDragChange,
  deckRef,
  discardRef,
  discarding = false,
}: {
  cards: HandCard[];
  /** The target under a screen point for this card, or null where it cannot be dropped. */
  targetAt: (x: number, y: number, card: CardDef) => DropTarget | null;
  /** New cards fly in from the draw pile... */
  deckRef?: RefObject<HTMLElement | null>;
  /** ...and the hand flies into the discard pile while `discarding`. */
  discardRef?: RefObject<HTMLElement | null>;
  discarding?: boolean;
  onPlay: (uid: number, at: { x: number; y: number }, target: DropTarget) => void;
  /** While dragging: the dragged card and the target under the pointer. */
  onDragChange?: (card: CardDef | null, target: DropTarget | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const handRef = useRef<HTMLDivElement>(null);
  /** The lifted card, which the popover sits beside. */
  const liftedRef = useRef<HTMLDivElement | null>(null);
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
  const overKey = drag?.active && drag.over ? JSON.stringify(drag.over) : '';
  useEffect(() => {
    onDragChange?.(dragDef, overKey ? (JSON.parse(overKey) as DropTarget) : null);
  }, [overKey, dragDef, onDragChange]);

  // the hovered card can be played away or leave the hand
  useEffect(() => {
    if (hover !== null && !cards.some((c) => c.uid === hover)) setHover(null);
  }, [cards, hover]);

  const overAt = (x: number, y: number, uid: number) => {
    const hand = handRef.current?.getBoundingClientRect();
    const def = cards.find((c) => c.uid === uid)?.def;
    // the hand itself sits on top of the arena: dropping back on it cancels
    if (!def || (hand && y >= hand.top + 40)) return null;
    return targetAt(x, y, def);
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
                  aria-label={`${c.def.name}${c.playable ? '' : ' (không đánh được)'}: ${plainCardText(c.def.text)}`}
                  aria-disabled={!c.playable}
                  onFocus={() => setHover(c.uid)}
                  onBlur={() => setHover((h) => (h === c.uid ? null : h))}
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
                      over: null,
                    });
                  }}
                  onPointerMove={(e) => {
                    if (!drag || drag.pointerId !== e.pointerId) return;
                    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6;
                    setDrag({ ...drag, x: e.clientX, y: e.clientY, active: drag.active || moved, over: overAt(e.clientX, e.clientY, drag.uid) });
                  }}
                  onPointerUp={(e) => {
                    if (!drag || drag.pointerId !== e.pointerId) return;
                    const target = drag.active ? overAt(e.clientX, e.clientY, drag.uid) : null;
                    setDrag(null);
                    if (target) {
                      setHover(null);
                      onPlay(drag.uid, { x: e.clientX - drag.dx + CARD_W / 2, y: e.clientY - drag.dy + CARD_H / 2 }, target);
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
                    className="relative size-full"
                    data-theta={theta}
                    ref={(el) => {
                      if (el) flyEls.current.set(c.uid, el);
                      else flyEls.current.delete(c.uid);
                      if (lifted) liftedRef.current = el;
                    }}
                  >
                    <CardFace def={c.def} playable={c.playable} lifted={lifted} blocked={c.blocked} />
                    {lifted && <CardPopover def={c.def} anchor={liftedRef} />}
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
              style={{
                left: drag.x - drag.dx,
                top: drag.y - drag.dy,
                width: CARD_W,
                height: CARD_H,
                transform: `rotate(${drag.over ? 0 : tilt}deg) scale(${drag.over ? 0.45 : 1.02})`,
                // over a target the card shrinks toward the pointer so the target stays visible
                transformOrigin: `${drag.dx}px ${drag.dy}px`,
                opacity: drag.over ? 0.75 : 1,
                transition: 'transform 120ms, opacity 120ms',
              }}
            >
              <CardFace def={c.def} playable glowing={!!drag.over} />
            </div>
          );
        })()}
    </>
  );
}

/** Rarity: the card's outer border (bronze, silver, blue, gold); the label is for lists and the popover. */
export const RARITY_STYLE: Record<Rarity, { label: string; text: string; border: string }> = {
  basic: { label: 'Cơ bản', text: 'text-orange-300', border: 'border-orange-800/90' },
  common: { label: 'Thường', text: 'text-zinc-200', border: 'border-zinc-300/80' },
  uncommon: { label: 'Ít gặp', text: 'text-sky-300', border: 'border-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.35)]' },
  rare: { label: 'Hiếm', text: 'text-amber-300', border: 'border-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.5)]' },
};
/** Curses have no rarity. */
const CURSE_BORDER = 'border-zinc-700';

/** The type's color, as the frame around the artwork. */
const ART_RING: Record<CardType, string> = {
  infra: 'ring-sky-400/70',
  policy: 'ring-violet-400/70',
  action: 'ring-emerald-400/70',
  attack: 'ring-rose-400/70',
  curse: 'ring-zinc-600',
};

export function CardFace({
  def,
  playable,
  lifted,
  glowing,
  blocked,
}: {
  def: CardDef;
  playable: boolean;
  blocked?: string;
  lifted?: boolean;
  glowing?: boolean;
}) {
  const style = TYPE_STYLE[def.type];
  const Icon = cardIcon(def);
  const TypeIcon = TYPE_ICON[def.type];
  return (
    <div
      className={cn(
        'relative flex size-full select-none flex-col overflow-hidden rounded-2xl border-2 bg-gradient-to-b p-1.5 text-left shadow-xl shadow-black/50 transition-[box-shadow,filter] duration-200',
        style.frame,
        def.rarity ? RARITY_STYLE[def.rarity].border : CURSE_BORDER,
        !playable && 'brightness-75 saturate-50',
        lifted && 'shadow-2xl shadow-black/70',
        glowing && 'shadow-[0_0_28px_6px_rgba(251,191,36,0.45)]',
      )}
      title={def.rarity ? `Độ hiếm: ${RARITY_STYLE[def.rarity].label}` : undefined}
    >
      {/* artwork: about 40% of the card, framed in the type's color */}
      <div className={cn('relative h-[92px] shrink-0 overflow-hidden rounded-xl bg-gradient-to-br ring-2 ring-inset', ART_RING[def.type], style.art)}>
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(rgba(255,255,255,.35)_1px,transparent_1px)] [background-size:10px_10px]" />
        <Icon aria-hidden className={cn('absolute -bottom-5 -right-4 size-[110px] opacity-15', style.icon)} strokeWidth={1.25} />
        <Icon aria-hidden className={cn('absolute left-1/2 top-1/2 size-14 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_2px_8px_rgba(0,0,0,.6)]', style.icon)} strokeWidth={1.5} />
        {def.exhaust && (
          <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-px text-[10px] font-medium text-amber-200">Tiêu hao</span>
        )}
      </div>
      {/* cost: a gem that overlaps the artwork's corner */}
      <span
        className={cn(
          'absolute left-0.5 top-0.5 flex size-8 items-center justify-center rounded-full border-2 font-mono text-base font-black shadow-md shadow-black/60',
          def.unplayable ? 'border-zinc-600 bg-zinc-800 text-zinc-500' : 'border-amber-200 bg-gradient-to-br from-amber-300 to-amber-600 text-amber-950',
        )}
        aria-label={def.unplayable ? 'Không thể đánh' : `${def.cost} Ops`}
      >
        {def.unplayable ? '–' : def.cost}
      </span>
      {/* a risky deploy: the Error Budget it spends, under the Ops gem */}
      {def.risk && (
        <span
          className="absolute left-1 top-9 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-rose-200 bg-gradient-to-br from-rose-400 to-rose-700 px-1 font-mono text-xs font-black text-white shadow-md shadow-black/60"
          aria-label={`Deploy liều: trừ ${def.risk} Error Budget`}
          title={`Deploy liều: trừ ${def.risk} Error Budget`}
        >
          −{def.risk}
        </span>
      )}

      <p className={cn('mt-1.5 truncate px-1 text-center text-[15px] font-bold leading-tight', def.upgraded && 'text-emerald-300')}>{def.name}</p>
      <span className={cn('mx-auto mt-1 flex max-w-full items-center gap-1 truncate whitespace-nowrap rounded-full px-2 py-px text-[9.5px] font-semibold uppercase tracking-wide', style.chip)}>
        <TypeIcon aria-hidden className="size-2.5 shrink-0" />
        {style.label}
        {def.fits && <span className="truncate opacity-80">· ổ {def.fits.map((k) => SOCKET_KIND_LABEL[k]).join('/')}</span>}
      </span>
      {/* effect text: the shared format (textFormat.ts), the rest is in the hover popover */}
      <div className="mt-1.5 flex min-h-0 flex-1 flex-col justify-center overflow-hidden rounded-lg bg-black/25 px-1.5 py-1.5 text-foreground/95">
        <CardText text={def.text} />
      </div>
      {lifted && !playable && (
        <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-black/75 py-1 text-center text-xs font-medium text-amber-200">
          {def.unplayable ? 'Không thể đánh' : (blocked ?? 'Không đủ Ops')}
        </span>
      )}
    </div>
  );
}

export const CARD_SIZE = { w: CARD_W, h: CARD_H };
/** Inline style for a box that holds one `CardFace`. */
export const CARD_BOX = { width: CARD_W, height: CARD_H } as const;

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
