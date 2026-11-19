// Shared pieces for the per-enemy move sets (moves/*.tsx). A move set gives an
// enemy its own idle props, strike, hit reaction, summon and defeat instead of
// the shared gait + strike styles in botMotion.ts. Each piece is optional:
// whatever a move set leaves out falls back to the shared, tier-based motion.
//
// The SVG layers are placed by BotAvatar (back: behind the body; extra: inside
// the moving body, after it; front: over everything). The motion functions take
// the avatar's wrapper element and look the layers up by data-fx.
import type { ReactNode } from 'react';
import { reduced } from '../fx';
import type { BotTier } from '../botMotion';

export interface Palette {
  main: string;
  light: string;
  dark: string;
}

export interface LayerProps {
  p: Palette;
  enraged: boolean;
  tier: BotTier;
  /** The body's <g id>, for <use> copies. */
  bodyId: string;
  /** The glow filter's id. */
  glow: string;
}

export interface MoveSet {
  /** Its own idle gait: CSS keyframes name, seconds per cycle, pivot in the 160×160 box. */
  gait?: { kf: string; s: number; origin?: string };
  back?: (a: LayerProps) => ReactNode;
  extra?: (a: LayerProps) => ReactNode;
  front?: (a: LayerProps) => ReactNode;
  /** The attack at the start of the enemy turn. Resolves when it lands. */
  strike?: (el: Element, tier: BotTier) => Promise<void>;
  /** A smaller follow-up while the attack keeps going. */
  jab?: (el: Element, tier: BotTier) => void;
  hit?: (el: Element, tier: BotTier) => void;
  summon?: (el: Element, tier: BotTier) => Promise<void>;
  /** Its own defeat: a CSS class on the wrapper (keyframes in moves.css) and how long it runs. */
  die?: { cls: string; ms: number };
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export { reduced };

/** The first layer tagged data-fx=k. */
export const fx = (el: Element, k: string) => el.querySelector<SVGElement>(`[data-fx="${k}"]`);
/** Every layer tagged data-fx=k. */
export const fxAll = (el: Element, k: string) => Array.from(el.querySelectorAll<SVGElement>(`[data-fx="${k}"]`));
/** The whole avatar SVG: moving it moves body and layers together. */
export const svgOf = (el: Element) => el.querySelector('svg');
export const isEnraged = (el: Element) => el.getAttribute('data-enraged') === 'true';

/** Animate if the node is there; resolves when done (or right away). */
export function play(node: Element | null | undefined, frames: Keyframe[], opts: KeyframeAnimationOptions | number): Promise<void> {
  if (!node) return Promise.resolve();
  return node.animate(frames, opts).finished.then(
    () => undefined,
    () => undefined,
  );
}

/** Same, added on top of whatever the node already plays (its idle). */
export const playAdd = (node: Element | null | undefined, frames: Keyframe[], ms: number, easing = 'ease-out') =>
  play(node, frames, { duration: ms, composite: 'add', easing });

/** Fly each tagged projectile from where it sits to (dx, dy), staggered; resolves when the first lands. */
export async function volley(
  el: Element,
  k: string,
  to: (i: number) => [number, number],
  { ms = 420, stagger = 50, spin = 0, easing = 'cubic-bezier(0.2, 0.6, 0.4, 1)' } = {},
) {
  const nodes = fxAll(el, k);
  nodes.forEach((n, i) => {
    const [dx, dy] = to(i);
    n.animate(
      [
        { transform: 'translate(0, 0) scale(0.4)', opacity: 0 },
        { transform: `translate(${dx * 0.12}px, ${dy * 0.12}px) scale(1.15)`, opacity: 1, offset: 0.15 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${spin * (i % 2 ? 1 : -1)}deg) scale(0.9)`, opacity: 0.9, offset: 0.9 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.3)`, opacity: 0 },
      ],
      { duration: ms, delay: i * stagger, easing, fill: 'backwards' },
    );
  });
  await wait(ms * 0.8);
}

/** A quick white flash on the whole avatar, for hits. */
export const flash = (el: Element, ms = 300, b = 1.8) =>
  play(el, [{ filter: 'brightness(1)' }, { filter: `brightness(${b})`, offset: 0.25 }, { filter: 'brightness(1)' }], { duration: ms, easing: 'ease-out' });

/** Everything a move set needs before animating: the SVG, unless motion is reduced. */
export const ready = (el: Element) => (reduced() ? null : svgOf(el));

/**
 * N hidden copies of a projectile at (x, y), tagged data-fx=k, for volley().
 * Each gets --i (its index) and, if given, --dx/--dy for CSS defeats that scatter them.
 */
export function Shots({ k, n, x, y, scatter, children }: { k: string; n: number; x: number; y: number; scatter?: (i: number) => [number, number]; children: (i: number) => ReactNode }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const [dx, dy] = scatter?.(i) ?? [0, 0];
        return (
          <g key={i} transform={`translate(${x} ${y})`}>
            <g data-fx={k} opacity="0" style={{ transformBox: 'fill-box', transformOrigin: 'center', ['--i' as string]: i, ['--dx' as string]: `${dx}px`, ['--dy' as string]: `${dy}px` }}>
              {children(i)}
            </g>
          </g>
        );
      })}
    </>
  );
}
