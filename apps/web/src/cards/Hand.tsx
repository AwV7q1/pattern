import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import type { CardDef, CardType } from './types';

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
}: {
  cards: HandCard[];
  dropRef: RefObject<HTMLElement | null>;
  onPlay: (uid: number, at: { x: number; y: number }) => void;
  onDragChange?: (state: 'idle' | 'dragging' | 'over') => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const n = cards.length;

  useEffect(() => {
    onDragChange?.(!drag?.active ? 'idle' : drag.over ? 'over' : 'dragging');
  }, [drag?.active, drag?.over, onDragChange]);

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
      <div ref={handRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[190px]">
        <div className="absolute bottom-0 left-1/2">
          {cards.map((c, i) => {
            const t = i - (n - 1) / 2;
            const theta = t * step;
            let x = FAN_R * Math.sin(theta);
            const y = FAN_R * (1 - Math.cos(theta));
            const lifted = hover === c.uid && !drag?.active;
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
                className="pointer-events-auto absolute transition-transform duration-200 ease-out"
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
                  <CardFace def={c.def} playable={c.playable} index={i + 1} lifted={lifted} />
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
