// The DDoS Lord, last floor boss, gets a move set of its own instead of the
// shared gait + strike styles in botMotion.ts:
// - idle: it levitates under a crown that floats on its own, a third eye opens
//   now and then, a ring of packets circles it (behind the body, then in front);
// - strike "Flood": it rears back, the third eye charges and fires a beam of packets;
// - hit: a hex proxy shield soaks the blow (in phase 2 the shield shatters and the
//   body glitches into red/cyan copies);
// - summon: the crown spins up, a portal opens on the ground, the minion orbit speeds up;
// - phase 2: crown tilted and glowing red, eye wide open, packets race, RGB glitches;
// - defeat: the body switches off like an old CRT (glitch, a line, a dot) and the
//   crown drops to the floor.
// The pattern every move set in moves/ follows (see kit.ts).
import type { ReactNode } from 'react';
import { fx, isEnraged, reduced, wait, type MoveSet, type Palette } from './kit';

export const LORD = 'ddos_lord';
export const LORD_DIE_MS = 2600;

const RED = '#ef4444';
const hexPts = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => `${(cx + r * Math.cos((i * Math.PI) / 3)).toFixed(1)},${(cy + r * Math.sin((i * Math.PI) / 3)).toFixed(1)}`).join(' ');

// ---------------------------------------------------------------- layers

/** The body without crown or third eye (those move on their own, see LordExtra). */
export function lordBody(p: Palette, head: string): ReactNode {
  return (
    <>
      <path
        d="M24 140 Q34 104 60 104 L100 104 Q126 104 136 140 Q122 134 108 141 Q94 134 80 141 Q66 134 52 141 Q38 134 24 140 Z"
        fill={p.dark}
        stroke={p.main}
        strokeOpacity="0.6"
        style={{ animation: 'lord-cape 3.4s ease-in-out infinite' }}
      />
      <path d="M60 104 L80 126 L100 104" fill="none" stroke="#fbbf24" strokeWidth="2" />
      <rect x="44" y="48" width="72" height="62" rx="16" fill={`url(#${head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.85" />
      {/* where the crown used to sit: a dent of light */}
      <path d="M52 50 Q80 44 108 50" fill="none" stroke={p.main} strokeWidth="1.5" strokeOpacity="0.5" />
      <rect x="52" y="70" width="56" height="20" rx="9" fill="#09090b" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={63 + i * 7} y="96" width="4" height="8" rx="1" fill="#52525b" />
      ))}
    </>
  );
}

/** One tilted ring of packets, as two halves: the back half goes behind the body, the front half over it. */
function PacketArc({ half, p, enraged }: { half: 'back' | 'front'; p: Palette; enraged: boolean }) {
  const d = half === 'back' ? 'M150 100 A70 18 0 0 0 10 100' : 'M10 100 A70 18 0 0 0 150 100';
  const dur = enraged ? 2.2 : 4.6;
  const n = 6;
  const c = enraged ? RED : p.main;
  return (
    <g data-fx="ring" transform="rotate(-10 80 100)" opacity={half === 'back' ? 0.45 : 0.95} style={{ transition: 'opacity 500ms' }}>
      <path d={d} fill="none" stroke={c} strokeOpacity="0.18" strokeDasharray="1 5" />
      {Array.from({ length: n }, (_, i) => (
        <g key={i}>
          <rect x="-3" y="-2.5" width="6" height="5" rx="1" fill="#18181b" stroke={c} strokeWidth="1" transform={half === 'back' ? 'scale(0.75)' : undefined} />
          <animateMotion dur={`${dur / 2}s`} begin={`${(-(i * dur) / 2 / n).toFixed(2)}s`} repeatCount="indefinite" path={d} />
        </g>
      ))}
    </g>
  );
}

/** Behind the body: the back of the packet ring and the summoning portal. */
export function LordBack({ p, enraged }: { p: Palette; enraged: boolean }) {
  return (
    <>
      <g data-fx="portal" opacity="0" style={{ transformOrigin: '80px 146px' }}>
        <ellipse cx="80" cy="146" rx="62" ry="12" fill={p.main} fillOpacity="0.18" stroke={p.main} strokeWidth="3" />
        <ellipse cx="80" cy="146" rx="42" ry="7" fill="none" stroke={p.light} strokeWidth="1.5" strokeDasharray="4 3" />
        <ellipse cx="80" cy="146" rx="20" ry="3.5" fill={p.light} fillOpacity="0.6" />
      </g>
      <PacketArc key={`b${enraged}`} half="back" p={p} enraged={enraged} />
    </>
  );
}

/** In front of everything: the front of the ring, the proxy shield, the beam and its packets, the phase 2 burst. */
export function LordFront({ p, enraged }: { p: Palette; enraged: boolean }) {
  const cells: [number, number][] = [];
  for (let k = 0; k < 7; k++) cells.push([32, 52 + k * 12.2]);
  for (let k = 0; k < 6; k++) cells.push([21.5, 58 + k * 12.2]);
  const c = enraged ? RED : p.main;
  return (
    <>
      <PacketArc key={`f${enraged}`} half="front" p={p} enraged={enraged} />
      <g data-fx="shield" opacity="0" style={{ transformOrigin: '40px 90px' }}>
        {cells.map(([x, y], i) => {
          const cx = x + ((y - 90) / 40) ** 2 * 9;
          return (
            <polygon
              key={i}
              data-fx="hex"
              points={hexPts(cx, y, 6.6)}
              fill={c}
              fillOpacity="0.2"
              stroke={enraged ? '#fca5a5' : p.light}
              strokeWidth="1.2"
              style={{ transformOrigin: `${cx}px ${y}px` }}
            />
          );
        })}
      </g>
      <g data-fx="beam" opacity="0" style={{ transformOrigin: '80px 62px', transform: 'scaleX(0)' }}>
        <defs>
          <linearGradient id="lord-beam" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor="#fff" />
            <stop offset="25%" stopColor={c} />
            <stop offset="100%" stopColor={c} stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="-280" y="58" width="360" height="8" rx="4" fill="url(#lord-beam)" />
        <rect x="-200" y="61" width="280" height="2" fill="#fff" opacity="0.8" />
      </g>
      {Array.from({ length: 14 }, (_, i) => (
        <rect
          key={i}
          data-fx="bolt"
          x="76"
          y="59"
          width="7"
          height="6"
          rx="1.2"
          fill="#18181b"
          stroke={i % 3 ? c : '#fff'}
          strokeWidth="1.2"
          opacity="0"
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        />
      ))}
      {/* phase 2 starts: a one-off shock ring when it overclocks */}
      {enraged && (
        <circle cx="80" cy="80" r="30" fill="none" stroke={RED} strokeWidth="4" style={{ transformOrigin: '80px 80px', animation: 'lord-burst 1s ease-out forwards' }} />
      )}
    </>
  );
}

/** Inside the moving body, next to it: the floating crown, the third eye, glitch copies and the CRT dot. */
export function LordExtra({ p, enraged, bodyId, glow }: { p: Palette; enraged: boolean; bodyId: string; glow: string }) {
  const crown = enraged ? RED : '#fbbf24';
  return (
    <>
      {/* phase 2: red and cyan copies flicker out of step */}
      {[
        ['#ff2a55', -4],
        ['#22d3ee', 4],
      ].map(([color, dx]) => (
        <g key={color} data-fx="rgb" opacity="0" style={{ animation: enraged ? `lord-rgb 2.6s steps(1) ${dx === 4 ? '0.08s' : '0s'} infinite` : undefined, ['--dx' as string]: `${dx}px` }}>
          <filter id={`${glow}-${String(color).slice(1)}`}>
            <feFlood floodColor={String(color)} />
            <feComposite in2="SourceAlpha" operator="in" />
          </filter>
          <use href={`#${bodyId}`} filter={`url(#${glow}-${String(color).slice(1)})`} opacity="0.55" />
        </g>
      ))}
      {/* light leaking between head and crown */}
      <ellipse cx="80" cy="46" rx="26" ry="4" fill={enraged ? RED : p.main} filter={`url(#${glow})`} style={{ animation: 'lord-leak 2.3s ease-in-out infinite' }} />
      <g data-fx="crown" style={{ transformOrigin: '80px 34px', animation: `lord-crown ${enraged ? 1.8 : 3.4}s ease-in-out infinite` }}>
        <g transform={enraged ? 'translate(0 -16) rotate(-9 80 34)' : 'translate(0 -10)'}>
          <path
            d="M46 52 L50 26 L64 40 L80 16 L96 40 L110 26 L114 52 Z"
            fill="#fbbf24"
            stroke={enraged ? '#7f1d1d' : '#92400e'}
            strokeWidth="1.5"
            strokeLinejoin="round"
            filter={enraged ? `url(#${glow})` : undefined}
            style={{ filter: enraged ? `drop-shadow(0 0 4px ${crown})` : undefined }}
          />
          {enraged && <path d="M84 22 L80 32 L85 38 L81 48" fill="none" stroke="#7f1d1d" strokeWidth="1.3" />}
          <circle cx="80" cy="36" r="3.5" fill="#e11d48" />
          <circle cx="62" cy="44" r="2.2" fill={enraged ? RED : '#22d3ee'} />
          <circle cx="98" cy="44" r="2.2" fill={enraged ? RED : '#22d3ee'} />
        </g>
      </g>
      {/* the third eye: mostly a slit, opens to stare; in phase 2 it stays wide open */}
      <g data-fx="eye" style={{ transformOrigin: '80px 62px' }}>
        <g style={{ transformOrigin: '80px 62px', animation: enraged ? 'lord-stare 0.9s ease-in-out infinite' : 'lord-eye 4.2s ease-in-out infinite' }}>
          <path d="M80 55 L87 62 L80 69 L73 62 Z" fill={enraged ? RED : p.main} filter={`url(#${glow})`} />
          <ellipse cx="80" cy="62" rx="1.3" ry={enraged ? 4.5 : 3} fill="#09090b" />
        </g>
      </g>
      <circle data-fx="crt-dot" cx="80" cy="80" r="3" fill="#fff" opacity="0" style={{ transformOrigin: '80px 80px' }} />
    </>
  );
}

// ---------------------------------------------------------------- motion

/** "Flood": rear back, charge the third eye, fire a beam of packets at your system. */
export async function lordStrike(el: Element): Promise<void> {
  const body = el.querySelector('svg');
  if (!body || reduced()) return;
  const fast = isEnraged(el) ? 0.8 : 1;
  const ms = 1200 * fast;
  const anim = body.animate(
    [
      { transform: 'none' },
      { transform: 'translate(10px, -12px) rotate(4deg) scale(1.04)', offset: 0.45 },
      { transform: 'translate(12px, -14px) rotate(5deg) scale(1.05)', offset: 0.68 },
      { transform: 'translate(-8px, -2px) rotate(-3deg) scale(0.97)', offset: 0.76 },
      { transform: 'translate(-4px, 0)', offset: 0.88 },
      { transform: 'none' },
    ],
    { duration: ms, easing: 'cubic-bezier(0.3, 0, 0.3, 1)' },
  );
  fx(el, 'eye')?.animate(
    [
      { transform: 'scale(1)', filter: 'brightness(1)' },
      { transform: 'scale(1.6, 2.2)', filter: 'brightness(2.6)', offset: 0.6 },
      { transform: 'scale(2.4, 1.4)', filter: 'brightness(3.5)', offset: 0.72 },
      { transform: 'scale(1.2)', filter: 'brightness(1.4)', offset: 0.85 },
      { transform: 'scale(1)', filter: 'brightness(1)' },
    ],
    { duration: ms },
  );
  fx(el, 'crown')?.animate(
    [{ transform: 'none' }, { transform: 'translateY(-8px) rotate(6deg)', offset: 0.6 }, { transform: 'translateY(2px) rotate(-4deg)', offset: 0.8 }, { transform: 'none' }],
    { duration: ms, composite: 'add' },
  );
  await wait(ms * 0.7);
  fx(el, 'beam')?.animate(
    [
      { transform: 'scaleX(0)', opacity: 0 },
      { transform: 'scaleX(1)', opacity: 1, offset: 0.25 },
      { transform: 'scaleX(1) scaleY(0.4)', opacity: 0.8, offset: 0.6 },
      { transform: 'scaleX(1) scaleY(0.1)', opacity: 0 },
    ],
    { duration: 460, easing: 'ease-out' },
  );
  el.querySelectorAll<SVGElement>('[data-fx="bolt"]').forEach((b, i) => {
    const dx = -(230 + ((i * 37) % 110));
    const dy = (((i * 53) % 60) - 30) * (i % 2 ? 1 : 0.5);
    b.animate(
      [
        { transform: 'translate(0, 0) scale(0.4)', opacity: 0 },
        { transform: `translate(${dx * 0.15}px, ${dy * 0.15}px) scale(1.2)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${i * 40}deg)`, opacity: 0 },
      ],
      { duration: 420, delay: i * 28, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)', fill: 'backwards' },
    );
  });
  await anim.finished.catch(() => undefined);
}

/** Taking a hit: the proxy shield soaks it. In phase 2 the shield shatters and the body glitches. */
export function lordHit(el: Element) {
  if (reduced()) return;
  const enraged = isEnraged(el);
  fx(el, 'shield')?.animate(
    [
      { opacity: 0, transform: 'scale(0.85)' },
      { opacity: 0.95, transform: 'scale(1.04)', offset: 0.18 },
      { opacity: enraged ? 0.9 : 0.4, transform: 'scale(1)', offset: 0.45 },
      { opacity: 0, transform: 'scale(1.06)' },
    ],
    { duration: enraged ? 640 : 520, easing: 'ease-out' },
  );
  el.querySelectorAll<SVGElement>('[data-fx="hex"]').forEach((h, i) => {
    if (enraged) {
      // shards fly back and away
      const dx = -10 - ((i * 7) % 16);
      const dy = ((i * 13) % 24) - 12;
      h.animate(
        [
          { transform: 'none' },
          { transform: 'none', offset: 0.35 },
          { transform: `translate(${dx}px, ${dy}px) rotate(${(i % 2 ? 1 : -1) * 70}deg) scale(0.5)` },
        ],
        { duration: 640, easing: 'ease-in' },
      );
    } else {
      // a ripple runs down the cells
      h.animate([{ fillOpacity: 0.2 }, { fillOpacity: 0.8 }, { fillOpacity: 0.2 }], { duration: 260, delay: Math.abs(i % 7 - 3) * 45 });
    }
  });
  el.querySelector('svg')?.animate(
    enraged
      ? [{ transform: 'none' }, { transform: 'translateX(6px) skewX(-6deg)', offset: 0.2 }, { transform: 'translateX(-3px) skewX(4deg)', offset: 0.45 }, { transform: 'none' }]
      : [{ transform: 'none' }, { transform: 'translateX(2px)', offset: 0.3 }, { transform: 'none' }],
    { duration: 380, easing: 'ease-out' },
  );
  fx(el, 'crown')?.animate([{ transform: 'none' }, { transform: 'rotate(8deg)', offset: 0.3 }, { transform: 'rotate(-5deg)', offset: 0.6 }, { transform: 'none' }], {
    duration: 520,
    composite: 'add',
  });
  if (enraged)
    el.querySelectorAll<SVGElement>('[data-fx="rgb"]').forEach((g, i) =>
      g.animate(
        [
          { opacity: 0, transform: 'none' },
          { opacity: 0.9, transform: `translateX(${i ? 5 : -5}px)`, offset: 0.15 },
          { opacity: 0.6, transform: `translate(${i ? -3 : 3}px, 1px)`, offset: 0.5 },
          { opacity: 0, transform: 'none' },
        ],
        { duration: 340, easing: 'steps(4)' },
      ),
    );
}

/** Raising the army: the crown spins up, a portal opens underneath, the orbit speeds up. */
export async function lordSummon(el: Element): Promise<void> {
  const body = el.querySelector('svg');
  if (!body || reduced()) return;
  const ms = 1000;
  fx(el, 'crown')?.animate(
    [{ transform: 'none' }, { transform: 'translateY(-22px) rotate(0deg)', offset: 0.3 }, { transform: 'translateY(-22px) rotate(360deg)', offset: 0.75 }, { transform: 'none' }],
    { duration: ms, easing: 'ease-in-out', composite: 'add' },
  );
  fx(el, 'portal')?.animate(
    [
      { opacity: 0, transform: 'scale(0.2, 0.2)' },
      { opacity: 1, transform: 'scale(1.1, 1)', offset: 0.35 },
      { opacity: 0.9, transform: 'scale(1, 1) rotate(0deg)', offset: 0.7 },
      { opacity: 0, transform: 'scale(1.4, 1.2)' },
    ],
    { duration: ms * 1.2, easing: 'ease-out' },
  );
  fx(el, 'eye')?.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(3)', offset: 0.4 }, { filter: 'brightness(1)' }], { duration: ms });
  const orbit = el.querySelector('[data-fx="orbit"]');
  const spins = orbit?.getAnimations() ?? [];
  spins.forEach((a) => a.updatePlaybackRate(7));
  const anim = body.animate(
    [
      { transform: 'none', filter: 'brightness(1)' },
      { transform: 'translateY(-14px) scale(1.07)', filter: 'brightness(1.5) drop-shadow(0 0 12px #d946ef)', offset: 0.45 },
      { transform: 'translateY(-10px) scale(1.05)', filter: 'brightness(1.3) drop-shadow(0 0 8px #d946ef)', offset: 0.75 },
      { transform: 'none', filter: 'brightness(1)' },
    ],
    { duration: ms, easing: 'ease-out' },
  );
  await anim.finished.catch(() => undefined);
  spins.forEach((a) => a.updatePlaybackRate(1));
}

export const lordMoves: MoveSet = {
  gait: { kf: 'gait-levitate', s: 3.4 },
  back: ({ p, enraged }) => <LordBack p={p} enraged={enraged} />,
  extra: ({ p, enraged, bodyId, glow }) => <LordExtra p={p} enraged={enraged} bodyId={bodyId} glow={glow} />,
  front: ({ p, enraged }) => <LordFront p={p} enraged={enraged} />,
  strike: lordStrike,
  hit: lordHit,
  summon: lordSummon,
  die: { cls: 'bot-die-lord', ms: LORD_DIE_MS },
};
