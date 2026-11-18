// DOM-only battle effects (request particles, hits, shakes). They draw into an
// absolutely positioned layer and never touch React state, so a turn's
// animation cannot desync the game: the rules decide, these only illustrate.

export interface Pt {
  x: number;
  y: number;
}

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Center of `el` in `layer` coordinates, nudged by a fraction of its size. */
export function anchor(el: Element, layer: Element, fx = 0.5, fy = 0.5): Pt {
  const r = el.getBoundingClientRect();
  const l = layer.getBoundingClientRect();
  return { x: r.left - l.left + r.width * fx, y: r.top - l.top + r.height * fy };
}

const COLORS = {
  bot: { bg: '#fb7185', glow: 'rgba(251,113,133,0.9)' },
  user: { bg: '#7dd3fc', glow: 'rgba(125,211,252,0.9)' },
  counter: { bg: '#6ee7b7', glow: 'rgba(110,231,183,0.95)' },
};

function dot(layer: HTMLElement, kind: keyof typeof COLORS, size: number) {
  const el = document.createElement('span');
  const c = COLORS[kind];
  Object.assign(el.style, {
    position: 'absolute',
    left: `${-size / 2}px`,
    top: `${-size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '9999px',
    background: c.bg,
    boxShadow: `0 0 10px 2px ${c.glow}`,
    pointerEvents: 'none',
    opacity: '0',
    willChange: 'transform, opacity',
  });
  layer.appendChild(el);
  return el;
}

/**
 * A stream of requests from `from` to `to`. `blocked` of them stop at
 * `stopX` (the shield) and burst green; the rest hit the target and call
 * `onHit`. Resolves when the last one lands.
 */
export async function wave(
  layer: HTMLElement,
  o: {
    from: Pt;
    to: Pt;
    count: number;
    blocked?: number;
    stopX?: number;
    kind: 'bot' | 'user';
    /** Spawn window (ms) and one request's flight time. */
    window: number;
    flight: number;
    spreadFrom?: number;
    spreadTo?: number;
    arc?: number;
    onHit?: () => void;
  },
) {
  if (reduced() || o.count <= 0) return;
  const blockedShare = o.blocked ?? 0;
  for (let i = 0; i < o.count; i++) {
    const delay = (i / o.count) * o.window + rand(0, o.window / o.count);
    const blocked = o.stopX !== undefined && Math.random() < blockedShare;
    const size = o.kind === 'bot' ? rand(5, 8) : rand(4, 6);
    const el = dot(layer, o.kind, size);
    const sx = o.from.x + rand(-6, 6);
    const sy = o.from.y + rand(-1, 1) * (o.spreadFrom ?? 26);
    const ex = blocked ? o.stopX! : o.to.x;
    const ey = o.to.y + rand(-1, 1) * (o.spreadTo ?? 14);
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2 - rand(0.3, 1) * (o.arc ?? 30);
    const end = blocked
      ? { transform: `translate(${ex}px, ${ey}px) scale(2.8)`, opacity: 0, background: '#34d399' }
      : { transform: `translate(${ex}px, ${ey}px) scale(0.3)`, opacity: 0 };
    const anim = el.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) scale(0.6)`, opacity: 0 },
        { opacity: 1, offset: 0.08 },
        { transform: `translate(${mx}px, ${my}px) scale(1)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${ex}px, ${ey}px) scale(1)`, opacity: 1, offset: 0.88 },
        end,
      ],
      { duration: o.flight * rand(0.85, 1.15), delay, easing: 'cubic-bezier(0.35, 0.1, 0.55, 1)', fill: 'forwards' },
    );
    anim.onfinish = () => el.remove();
    if (!blocked && o.onHit && i % 3 === 0) setTimeout(o.onHit, delay + o.flight * 0.88);
  }
  await wait(o.window + o.flight * 1.15);
}

/** Counter-attack: a few bright bolts flying from `from` to `to`. */
export async function bolts(layer: HTMLElement, from: Pt, to: Pt, n: number, onHit?: () => void) {
  if (reduced() || n <= 0) {
    onHit?.();
    return;
  }
  const count = Math.min(10, Math.max(2, Math.round(n / 2)));
  for (let i = 0; i < count; i++) {
    const el = dot(layer, 'counter', 9);
    const delay = i * 70;
    const sy = from.y + rand(-20, 20);
    const ey = to.y + rand(-16, 16);
    const my = (sy + ey) / 2 - rand(30, 70);
    const anim = el.animate(
      [
        { transform: `translate(${from.x}px, ${sy}px) scale(0.5)`, opacity: 0 },
        { opacity: 1, offset: 0.1 },
        { transform: `translate(${(from.x + to.x) / 2}px, ${my}px) scale(1.2)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${to.x}px, ${ey}px) scale(1)`, opacity: 1, offset: 0.9 },
        { transform: `translate(${to.x}px, ${ey}px) scale(3)`, opacity: 0 },
      ],
      { duration: 520, delay, easing: 'cubic-bezier(0.5, 0, 0.6, 1)', fill: 'forwards' },
    );
    anim.onfinish = () => el.remove();
  }
  await wait(520 * 0.9 + (count - 1) * 70);
  onHit?.();
  await wait(200);
}

export function shake(el: Element | null, px = 7, ms = 420) {
  if (!el || reduced()) return;
  el.animate(
    [0, -px, px, -px * 0.7, px * 0.7, -px * 0.3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
    { duration: ms, easing: 'ease-out' },
  );
}

/** Brief colored glow around an element (a hit). */
export function glow(el: Element | null, color: string, ms = 260) {
  if (!el || reduced()) return;
  el.animate(
    [{ boxShadow: `0 0 0 0 ${color}` }, { boxShadow: `0 0 22px 6px ${color}`, offset: 0.3 }, { boxShadow: `0 0 0 0 transparent` }],
    { duration: ms, easing: 'ease-out' },
  );
}

/** Wind-up before an attack. */
export function pulse(el: Element | null, scale = 1.12, ms = 380) {
  if (!el || reduced()) return;
  el.animate([{ transform: 'scale(1)' }, { transform: `scale(${scale})`, offset: 0.4 }, { transform: 'scale(1)' }], {
    duration: ms,
    easing: 'cubic-bezier(0.3, 0, 0.3, 1)',
  });
}

export { wait };
