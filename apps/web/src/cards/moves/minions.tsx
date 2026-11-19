// The minions that fight next to an enemy: each one's small body (48×48 box),
// idle, strike, hit reaction and defeat. Like the enemies' move sets, the body's
// moving parts are tagged data-fx and the motion functions look them up from
// the avatar's wrapper. The player stands to the left: attacks go toward -x.
//
// Defeats are CSS (moves.css, under `.minion-out [data-minion=id]`): the card
// around the minion holds still and fades late while the body plays its own end.
import type { CSSProperties, ReactNode } from 'react';
import { flash, fx, fxAll, play, ready, Shots, volley } from './kit';

export interface MinionMoves {
  color: string;
  /** Idle: CSS keyframes name and seconds per cycle (pivot 24 40). */
  gait: { kf: string; s: number };
  /** The body, inside the idle layer. */
  body: (c: string) => ReactNode;
  /** Over the body but outside the idle: projectiles, rings, puddles. */
  fx?: (c: string) => ReactNode;
  /** Joining its master's attack. */
  strike?: (el: Element) => void;
  hit?: (el: Element) => void;
}

/** Pivot for a part, in the 48×48 box. */
const o = (x: number, y: number): CSSProperties => ({ transformOrigin: `${x}px ${y}px` });
/** Shown only while animated. */
const hidden = { opacity: 0 } as const;
const pop = (peak: string, end = 'none'): Keyframe[] => [
  { transform: 'none', opacity: 0 },
  { transform: peak, opacity: 1, offset: 0.3 },
  { transform: end, opacity: 0 },
];

/** The shared knock-back on taking a hit (the card shakes, the body flashes). */
export function knock(el: Element, amp = 1) {
  play(
    el,
    [
      { transform: 'none', filter: 'brightness(1)' },
      { transform: `translateX(${5 * amp}px) scale(${1 + 0.18 * amp}, ${1 - 0.18 * amp})`, filter: 'brightness(2)', offset: 0.3 },
      { transform: `translateX(${-2 * amp}px) scale(0.95, 1.05)`, offset: 0.6 },
      { transform: 'none', filter: 'brightness(1)' },
    ],
    { duration: 360, easing: 'ease-out' },
  );
}

const shake = (px: number, n = 6): Keyframe[] => [
  { transform: 'none' },
  ...Array.from({ length: n }, (_, i) => ({ transform: `translateX(${i % 2 ? -px : px}px)` })),
  { transform: 'none' },
];

// ---------------------------------------------------------------- the minions

export const MINIONS: Record<string, MinionMoves> = {
  // Spam message: the flap opens and small letters fly out; a hit pops its badge; it ends crumpled and tossed.
  spam_msg: {
    color: '#f59e0b',
    gait: { kf: 'm-flutter', s: 1.6 },
    body: (c) => (
      <>
        <rect x="9" y="14" width="30" height="21" rx="3" fill="#27272a" stroke={c} strokeWidth="2" />
        <g data-fx="flap" style={o(24, 15)}>
          <path d="M10 16 L24 27 L38 16" fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" />
        </g>
        <g data-fx="badge" style={o(37, 14)}>
          <circle cx="37" cy="14" r="5" fill="#ef4444" />
          <text x="37" y="16.5" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#fff">!</text>
        </g>
      </>
    ),
    fx: (c) => (
      <Shots k="mail" n={3} x={12} y={22}>
        {() => (
          <>
            <rect x="-5" y="-3.5" width="10" height="7" rx="1" fill="#27272a" stroke={c} strokeWidth="1.2" />
            <path d="M-4.2 -2.5 L0 0.8 L4.2 -2.5" fill="none" stroke={c} strokeWidth="1" />
          </>
        )}
      </Shots>
    ),
    strike: (el) => {
      const s = ready(el);
      if (!s) return;
      play(fx(el, 'flap'), [{ transform: 'none' }, { transform: 'scaleY(-1)', offset: 0.25 }, { transform: 'scaleY(-1)', offset: 0.75 }, { transform: 'none' }], 760);
      play(s, [{ transform: 'none' }, { transform: 'translateX(3px) rotate(8deg)', offset: 0.25 }, { transform: 'translateX(-9px) rotate(-10deg)', offset: 0.5 }, { transform: 'none' }], { duration: 620, easing: 'ease-out' });
      setTimeout(() => void volley(el, 'mail', (i) => [-46, -12 + i * 12], { ms: 560, stagger: 80, spin: 35 }), 200);
    },
    hit: (el) => {
      if (!ready(el)) return;
      play(fx(el, 'badge'), [{ transform: 'none' }, { transform: 'scale(1.9)', offset: 0.3 }, { transform: 'none' }], 420);
      play(fx(el, 'flap'), [{ transform: 'none' }, { transform: 'scaleY(0.4)', offset: 0.3 }, { transform: 'none' }], 360);
      knock(el);
    },
  },

  // Worker ant: turns to face you, scurries in and bites; a hit tips it over; it ends on its back, legs kicking.
  bot_con: {
    color: '#f43f5e',
    gait: { kf: 'gait-hop', s: 0.9 },
    body: (c) => (
      <>
        <g data-fx="legs" style={o(24, 27)}>
          {[-1, 1].map((d) => [0, 1, 2].map((k) => <path key={`${d}${k}`} d={`M${24 + d * 4} ${24 + k * 3} l${d * 9} ${-4 + k * 4}`} stroke="#71717a" strokeWidth="1.6" strokeLinecap="round" />))}
        </g>
        <ellipse cx="24" cy="32" rx="6" ry="5" fill="#3f3f46" stroke={c} />
        <ellipse cx="24" cy="21" rx="9" ry="8" fill="#27272a" stroke={c} strokeWidth="1.8" />
        <g data-fx="feelers" style={o(24, 14)}>
          <path d="M20 14 Q17 8 14 6 M28 14 Q31 8 34 6" fill="none" stroke="#a1a1aa" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      </>
    ),
    fx: () => (
      <g data-fx="bite" style={{ ...hidden, ...o(5, 24) }}>
        <path d="M0 17 Q7 24 0 31 M10 17 Q3 24 10 31" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </g>
    ),
    strike: (el) => {
      const s = ready(el);
      if (!s) return;
      play(s, [{ transform: 'none' }, { transform: 'rotate(-60deg)', offset: 0.25 }, { transform: 'translateX(-12px) rotate(-75deg)', offset: 0.5 }, { transform: 'translateX(-12px) rotate(-75deg)', offset: 0.62 }, { transform: 'none' }], { duration: 760, easing: 'ease-in-out' });
      play(fx(el, 'legs'), [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.6)' }, { transform: 'scaleX(1)' }], { duration: 110, iterations: 4 });
      play(fx(el, 'feelers'), [{ transform: 'none' }, { transform: 'scaleY(1.3) rotate(8deg)' }, { transform: 'scaleY(0.8) rotate(-8deg)' }, { transform: 'none' }], { duration: 300, delay: 120 });
      play(fx(el, 'bite'), [{ transform: 'scaleX(1.8)', opacity: 0 }, { transform: 'scaleX(1.6)', opacity: 1, offset: 0.3 }, { transform: 'scaleX(0.3)', opacity: 1, offset: 0.6 }, { transform: 'scaleX(0.3)', opacity: 0 }], { duration: 360, delay: 330 });
    },
    hit: (el) => {
      const s = ready(el);
      if (!s) return;
      play(s, [{ transform: 'none' }, { transform: 'translate(5px, -3px) rotate(40deg)', offset: 0.3 }, { transform: 'rotate(-6deg)', offset: 0.7 }, { transform: 'none' }], { duration: 480, easing: 'ease-out' });
      play(fx(el, 'legs'), [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.5)' }, { transform: 'scaleX(1.1)' }], { duration: 90, iterations: 4 });
      flash(el, 300, 2);
    },
  },

  // Cron job: the hand whirls to 00:00, the alarm rings out; a hit jams its gear; it ends with its teeth flying off.
  cron_job: {
    color: '#a78bfa',
    gait: { kf: 'gait-tick', s: 1 },
    body: (c) => {
      const teeth = Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return (
          <g key={i} data-fx="tooth" style={{ ['--dx' as string]: `${(Math.sin(a) * 22).toFixed(1)}px`, ['--dy' as string]: `${(-Math.cos(a) * 22).toFixed(1)}px` }}>
            <rect x="22" y="7" width="4" height="7" rx="1" fill={c} transform={`rotate(${i * 45} 24 24)`} />
          </g>
        );
      });
      return (
        <>
          <g data-fx="teeth" style={o(24, 24)}>
            {teeth}
          </g>
          <circle cx="24" cy="24" r="12" fill="#27272a" stroke={c} strokeWidth="2" />
          <g data-fx="hand" style={o(24, 24)}>
            <path d="M24 17 V24 L29 27" fill="none" stroke="#e4e4e7" strokeWidth="2" strokeLinecap="round" />
          </g>
        </>
      );
    },
    fx: (c) => (
      <>
        <g data-fx="ring" style={{ ...hidden, ...o(24, 24) }}>
          <circle cx="24" cy="24" r="13" fill="none" stroke={c} strokeWidth="2" />
        </g>
        <g data-fx="stamp" style={{ ...hidden, ...o(24, 4) }}>
          <rect x="9" y="-1" width="30" height="10" rx="2" fill="#18181b" stroke={c} />
          <text x="24" y="6.8" textAnchor="middle" fontSize="7.5" fontWeight="bold" fontFamily="monospace" fill="#fde68a">00:00</text>
        </g>
      </>
    ),
    strike: (el) => {
      const s = ready(el);
      if (!s) return;
      play(fx(el, 'hand'), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(720deg)' }], { duration: 560, easing: 'cubic-bezier(0.5, 0, 0.3, 1)' });
      play(fx(el, 'teeth'), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-90deg)' }], { duration: 560, easing: 'ease-in-out' });
      play(s, [{ transform: 'none' }, { transform: 'none', offset: 0.55 }, { transform: 'translateX(-9px) scale(1.15)', offset: 0.7 }, { transform: 'none' }], { duration: 820, easing: 'ease-out' });
      play(fx(el, 'stamp'), pop('translateY(-6px) scale(1.15)', 'translateY(-12px)'), { duration: 700, delay: 450 });
      play(fx(el, 'ring'), [{ transform: 'none', opacity: 1 }, { transform: 'translateX(-14px) scale(2.2)', opacity: 0 }], { duration: 480, delay: 460, easing: 'ease-out' });
    },
    hit: (el) => {
      const s = ready(el);
      if (!s) return;
      play(s, shake(2), { duration: 360 });
      play(fx(el, 'hand'), [{ transform: 'none' }, { transform: 'rotate(30deg)' }, { transform: 'rotate(-20deg)' }, { transform: 'rotate(25deg)' }, { transform: 'none' }], { duration: 420 });
      flash(el, 320, 2);
    },
  },

  // Click-farm phone: tilts toward you and taps, "+1"s fly; a hit cracks the screen; it ends dark and face down.
  phone: {
    color: '#22d3ee',
    gait: { kf: 'm-buzz', s: 1.8 },
    body: (c) => (
      <>
        <rect x="15" y="7" width="18" height="34" rx="3.5" fill="#18181b" stroke={c} strokeWidth="2" />
        <rect data-fx="screen" x="18" y="11" width="12" height="22" rx="1" fill={c} opacity="0.25" />
        <g data-fx="tap" style={o(24, 22)}>
          <circle cx="24" cy="22" r="3" fill={c} />
        </g>
        <g data-fx="tapring" style={o(24, 22)}>
          <circle cx="24" cy="22" r="6" fill="none" stroke={c} strokeOpacity="0.6" />
        </g>
        <path data-fx="crack" d="M28 11 L24 17 L27 20 L20 28 M24 17 L19 15" fill="none" stroke="#f4f4f5" strokeWidth="1" opacity="0" />
        <circle cx="24" cy="37" r="1.5" fill="#71717a" />
      </>
    ),
    fx: (c) => (
      <Shots k="like" n={3} x={14} y={18}>
        {() => (
          <>
            <rect x="-6.5" y="-4" width="13" height="8" rx="4" fill={c} />
            <text x="0" y="2.4" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#082f49">+1</text>
          </>
        )}
      </Shots>
    ),
    strike: (el) => {
      const s = ready(el);
      if (!s) return;
      play(s, [{ transform: 'none' }, { transform: 'translateX(-5px) rotate(-14deg)', offset: 0.2 }, { transform: 'translateX(-5px) rotate(-14deg)', offset: 0.8 }, { transform: 'none' }], { duration: 820, easing: 'ease-in-out' });
      play(fx(el, 'tap'), [{ transform: 'scale(1)' }, { transform: 'scale(0.4)' }, { transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 200, delay: 140, iterations: 3 });
      play(fx(el, 'screen'), [{ opacity: 0.25 }, { opacity: 0.85 }, { opacity: 0.25 }], { duration: 200, delay: 140, iterations: 3 });
      setTimeout(() => void volley(el, 'like', (i) => [-44, -14 + i * 11], { ms: 560, stagger: 200 }), 180);
    },
    hit: (el) => {
      if (!ready(el)) return;
      play(fx(el, 'crack'), [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], 700);
      play(fx(el, 'screen'), [{ opacity: 0.25 }, { opacity: 0.9, offset: 0.15 }, { opacity: 0.05, offset: 0.4 }, { opacity: 0.25 }], 600);
      knock(el);
    },
  },

  // Scalper: lunges with its mouth open and gobbles boxes; a hit knocks a coin out; it ends deflating, its loot spilling.
  scalper: {
    color: '#fb923c',
    gait: { kf: 'm-dash', s: 2.2 },
    body: (c) => (
      <>
        <g data-fx="handle" style={o(24, 16)}>
          <path d="M18 16 Q18 8 24 8 Q30 8 30 16" fill="none" stroke={c} strokeWidth="2" />
        </g>
        <path d="M11 16 H37 L35 40 H13 Z" fill="#27272a" stroke={c} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="19" cy="24" r="2" fill={c} />
        <circle cx="29" cy="24" r="2" fill={c} />
        <g data-fx="grin" style={o(24, 32)}>
          <path d="M18 31 Q24 36 30 31" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" />
        </g>
      </>
    ),
    fx: () => (
      <>
        <Shots k="box" n={3} x={8} y={26} scatter={(i) => [-14 + i * 14, 8 - (i % 2) * 14]}>
          {() => (
            <>
              <rect x="-3.5" y="-3.5" width="7" height="7" fill="#a16207" stroke="#fde68a" strokeWidth="0.8" />
              <path d="M-3.5 -1 H3.5 M0 -3.5 V-1" stroke="#fde68a" strokeWidth="0.6" />
            </>
          )}
        </Shots>
        <g data-fx="coin" style={{ ...hidden, ...o(14, 30) }}>
          <circle cx="14" cy="30" r="3.4" fill="#fbbf24" stroke="#92400e" strokeWidth="0.8" />
          <text x="14" y="32.2" textAnchor="middle" fontSize="5" fontWeight="bold" fill="#92400e">$</text>
        </g>
      </>
    ),
    strike: (el) => {
      const s = ready(el);
      if (!s) return;
      play(s, [{ transform: 'none' }, { transform: 'translateX(-11px) scale(1.08)', offset: 0.3 }, { transform: 'translateX(-11px) scale(1.08)', offset: 0.55 }, { transform: 'scale(1.16)', offset: 0.78 }, { transform: 'none' }], { duration: 900, easing: 'ease-in-out' });
      play(fx(el, 'grin'), [{ transform: 'none' }, { transform: 'scaleY(2.2)', offset: 0.3 }, { transform: 'scaleY(2.2)', offset: 0.55 }, { transform: 'scale(1.3, 1.2)', offset: 0.8 }, { transform: 'none' }], 900);
      play(fx(el, 'handle'), [{ transform: 'none' }, { transform: 'rotate(-12deg)', offset: 0.3 }, { transform: 'none' }], 600);
      fxAll(el, 'box').forEach((b, i) =>
        play(
          b,
          [
            { transform: `translate(-30px, ${-8 + i * 8}px) scale(1)`, opacity: 0 },
            { transform: `translate(-22px, ${-6 + i * 6}px) scale(1)`, opacity: 1, offset: 0.25 },
            { transform: 'translate(8px, 2px) scale(0.3)', opacity: 0.9, offset: 0.9 },
            { transform: 'translate(10px, 2px) scale(0.2)', opacity: 0 },
          ],
          { duration: 420, delay: 200 + i * 90, easing: 'ease-in', fill: 'backwards' },
        ),
      );
    },
    hit: (el) => {
      const s = ready(el);
      if (!s) return;
      play(s, [{ transform: 'none' }, { transform: 'rotate(14deg)', offset: 0.3 }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
      play(fx(el, 'coin'), [{ transform: 'none', opacity: 1 }, { transform: 'translate(-8px, -12px) rotate(-180deg)', opacity: 1, offset: 0.4 }, { transform: 'translate(-14px, 12px) rotate(-360deg)', opacity: 0 }], { duration: 620, easing: 'ease-out' });
      knock(el, 0.7);
    },
  },

  // Zombie laptop: its skull glitches and code bits spray out; a hit fills it with static; it ends on a blue screen, lid shut.
  zombie: {
    color: '#84cc16',
    gait: { kf: 'm-shamble', s: 2.6 },
    body: (c) => (
      <>
        <g data-fx="lid" style={o(24, 31)}>
          <rect x="10" y="11" width="28" height="19" rx="2" fill="#18181b" stroke={c} strokeWidth="2" />
          <g data-fx="skull" style={o(24, 21)}>
            <circle cx="24" cy="19" r="5" fill={c} opacity="0.85" />
            <rect x="21" y="22" width="6" height="4" rx="1" fill={c} opacity="0.85" />
            <circle cx="22" cy="19" r="1.3" fill="#18181b" />
            <circle cx="26" cy="19" r="1.3" fill="#18181b" />
          </g>
          <g data-fx="bsod" opacity="0">
            <rect x="11.5" y="12.5" width="25" height="16" rx="1" fill="#1d4ed8" />
            <text x="15" y="23.5" fontSize="8" fontWeight="bold" fill="#fff">:(</text>
          </g>
        </g>
        <path d="M6 34 H42 L39 38 H9 Z" fill="#3f3f46" stroke={c} strokeWidth="1.5" />
      </>
    ),
    fx: (c) => (
      <Shots k="bit" n={4} x={12} y={20}>
        {(i) => (
          <text x="0" y="2.2" textAnchor="middle" fontSize="7" fontWeight="bold" fontFamily="monospace" fill={c}>
            {i % 2 ? '1' : '0'}
          </text>
        )}
      </Shots>
    ),
    strike: (el) => {
      const s = ready(el);
      if (!s) return;
      play(s, [{ transform: 'none' }, { transform: 'translateX(-8px) rotate(-10deg)', offset: 0.35 }, { transform: 'translateX(-6px) rotate(-6deg)', offset: 0.7 }, { transform: 'none' }], { duration: 760, easing: 'ease-in-out' });
      play(fx(el, 'skull'), [{ transform: 'none' }, { transform: 'translateX(-2px) scale(1.35)' }, { transform: 'translateX(2px) scale(1.25)' }, { transform: 'translateX(-1px) scale(1.35)' }, { transform: 'none' }], { duration: 520, delay: 80 });
      play(fx(el, 'lid'), [{ transform: 'none' }, { transform: 'scaleY(0.75)', offset: 0.3 }, { transform: 'scaleY(1.08)', offset: 0.6 }, { transform: 'none' }], 480);
      setTimeout(() => void volley(el, 'bit', (i) => [-42, -16 + i * 10], { ms: 520, stagger: 60 }), 220);
    },
    hit: (el) => {
      if (!ready(el)) return;
      play(fx(el, 'skull'), [{ opacity: 1 }, { opacity: 0 }, { opacity: 1 }, { opacity: 0.1 }, { opacity: 1 }], 380);
      play(fx(el, 'lid'), [{ transform: 'none' }, { transform: 'skewX(12deg)' }, { transform: 'skewX(-8deg)' }, { transform: 'none' }], 380);
      knock(el);
    },
  },

  // Proxy shield: bashes forward and sends a shockwave; a hit ripples off it (it is the guard); it ends cracked, its mask falling.
  proxy_shield: {
    color: '#60a5fa',
    gait: { kf: 'm-pulse', s: 2.4 },
    body: (c) => (
      <>
        <path d="M24 6 L39 12 V23 Q39 35 24 42 Q9 35 9 23 V12 Z" fill="#1e293b" stroke={c} strokeWidth="2.2" strokeLinejoin="round" />
        <path data-fx="crack" d="M24 7 L21.5 16 L26 22 L22 30 L25 41" fill="none" stroke="#e2e8f0" strokeWidth="1.4" strokeLinejoin="round" opacity="0" />
        <g data-fx="mask" style={o(24, 22)}>
          <path d="M14 21 Q24 16 34 21 Q33 27 28 27 Q24 24 20 27 Q15 27 14 21 Z" fill={c} opacity="0.9" />
          <g data-fx="eyes" style={o(24, 22.5)}>
            <circle cx="19.5" cy="22.5" r="1.6" fill="#0f172a" />
            <circle cx="28.5" cy="22.5" r="1.6" fill="#0f172a" />
          </g>
        </g>
      </>
    ),
    fx: (c) => (
      <>
        <g data-fx="arc" style={{ ...hidden, ...o(8, 24) }}>
          <path d="M12 9 Q1 24 12 39" fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="round" />
        </g>
        <g data-fx="ripple" style={{ ...hidden, ...o(24, 24) }}>
          <path d="M24 6 L39 12 V23 Q39 35 24 42 Q9 35 9 23 V12 Z" fill="none" stroke="#e0f2fe" strokeWidth="1.6" />
        </g>
        <Shots k="spark" n={3} x={11} y={18}>
          {() => <path d="M0 -3 L0.8 -0.8 L3 0 L0.8 0.8 L0 3 L-0.8 0.8 L-3 0 L-0.8 -0.8 Z" fill="#e0f2fe" />}
        </Shots>
      </>
    ),
    strike: (el) => {
      const s = ready(el);
      if (!s) return;
      play(s, [{ transform: 'none' }, { transform: 'translateX(4px) scale(0.95)', offset: 0.3 }, { transform: 'translateX(-12px) scale(1.1)', offset: 0.5 }, { transform: 'none' }], { duration: 700, easing: 'ease-in-out' });
      play(fx(el, 'eyes'), [{ transform: 'none', filter: 'none' }, { transform: 'scale(1.6)', offset: 0.35 }, { transform: 'scale(1.6)', offset: 0.6 }, { transform: 'none' }], 700);
      play(fx(el, 'mask'), [{ opacity: 1 }, { opacity: 0.5, offset: 0.4 }, { opacity: 1 }], 500);
      play(fx(el, 'arc'), [{ transform: 'scaleY(0.6)', opacity: 0 }, { transform: 'translateX(-6px) scaleY(1)', opacity: 1, offset: 0.2 }, { transform: 'translateX(-38px) scaleY(1.5)', opacity: 0 }], { duration: 480, delay: 330, easing: 'ease-out' });
    },
    hit: (el) => {
      const s = ready(el);
      if (!s) return;
      play(fx(el, 'ripple'), [{ transform: 'none', opacity: 0.95 }, { transform: 'scale(1.35)', opacity: 0 }], { duration: 460, easing: 'ease-out' });
      void volley(el, 'spark', (i) => [-12 - i * 5, -16 + i * 9], { ms: 340, stagger: 30 });
      play(s, [{ transform: 'none' }, { transform: 'translateX(2px)', offset: 0.3 }, { transform: 'none' }], 300);
      flash(el, 260, 1.6);
    },
  },

  // Hydra head: rears back and bites, spitting venom; a hit makes it recoil and squint; it ends drooping to the ground.
  hydra_head: {
    color: '#10b981',
    gait: { kf: 'gait-slither', s: 1.6 },
    body: (c) => (
      <g data-fx="neck" style={o(30, 44)}>
        <path d="M30 44 Q36 32 28 24 Q22 18 26 12" fill="none" stroke={c} strokeWidth="6" strokeLinecap="round" />
        <g data-fx="head" style={o(26, 13)}>
          <ellipse cx="23" cy="12" rx="10" ry="7" fill="#064e3b" stroke={c} strokeWidth="2" />
          <g data-fx="eye" style={o(21, 10)}>
            <circle cx="21" cy="10" r="2" fill="#fde047" />
          </g>
          <g data-fx="tongue" style={o(14, 15)}>
            <path d="M14 14 l-5 1 l4 2" fill="none" stroke="#f43f5e" strokeWidth="1.4" strokeLinecap="round" />
          </g>
        </g>
      </g>
    ),
    fx: () => (
      <Shots k="venom" n={2} x={11} y={16}>
        {() => <path d="M0 -3.5 Q2.8 0.8 0 3 Q-2.8 0.8 0 -3.5 Z" fill="#a3e635" />}
      </Shots>
    ),
    strike: (el) => {
      if (!ready(el)) return;
      play(fx(el, 'neck'), [{ transform: 'none' }, { transform: 'rotate(14deg)', offset: 0.3 }, { transform: 'translateX(-4px) rotate(-16deg)', offset: 0.5 }, { transform: 'rotate(-10deg)', offset: 0.65 }, { transform: 'none' }], { duration: 760, easing: 'ease-in-out' });
      play(fx(el, 'head'), [{ transform: 'none' }, { transform: 'rotate(12deg)', offset: 0.3 }, { transform: 'rotate(-18deg) scale(1.15)', offset: 0.5 }, { transform: 'none' }], 760);
      play(fx(el, 'tongue'), [{ transform: 'none' }, { transform: 'scaleX(1.9)' }, { transform: 'none' }], { duration: 200, delay: 360, iterations: 2 });
      setTimeout(() => void volley(el, 'venom', (i) => [-34, 8 + i * 6], { ms: 440, stagger: 90 }), 360);
    },
    hit: (el) => {
      if (!ready(el)) return;
      play(fx(el, 'neck'), [{ transform: 'none' }, { transform: 'translateX(3px) rotate(18deg)', offset: 0.3 }, { transform: 'rotate(-4deg)', offset: 0.7 }, { transform: 'none' }], { duration: 500, easing: 'ease-out' });
      play(fx(el, 'eye'), [{ transform: 'none' }, { transform: 'scaleY(0.15)', offset: 0.2 }, { transform: 'scaleY(0.15)', offset: 0.7 }, { transform: 'none' }], 500);
      flash(el, 300, 2);
    },
  },

  // Poisoned cache node: its lid pops and globs of poison arc out; a hit splits its crack; it ends melting into a puddle.
  poison_node: {
    color: '#a3e635',
    gait: { kf: 'gait-hover', s: 2.8 },
    body: (c) => (
      <>
        <path d="M12 12 V32 Q24 39 36 32 V12" fill="#27272a" stroke={c} strokeWidth="1.8" />
        <path d="M12 22 Q24 28 36 22" fill="none" stroke={c} strokeOpacity="0.5" />
        <g data-fx="crack" style={o(25, 22)}>
          <path d="M27 14 L23 21 L27 24 L22 31" fill="none" stroke="#d4d4d8" strokeWidth="1.3" />
        </g>
        <g data-fx="lid" style={o(24, 12)}>
          <ellipse cx="24" cy="12" rx="12" ry="4.5" fill="#3f3f46" stroke={c} strokeWidth="1.8" />
        </g>
        <path data-fx="drip" d="M18 34 Q17 40 18.5 42 Q20 40 19 34 Z" fill={c} style={{ ['--i' as string]: 0 }} />
        <path data-fx="drip" d="M30 35 Q29 39 30.5 40.5 Q32 39 31 35 Z" fill={c} style={{ ['--i' as string]: 1 }} />
      </>
    ),
    fx: (c) => (
      <>
        <g data-fx="puddle" style={{ ...hidden, ...o(24, 43) }}>
          <ellipse cx="24" cy="43" rx="15" ry="3.2" fill={c} opacity="0.75" />
        </g>
        <Shots k="glob" n={3} x={14} y={24}>
          {() => <circle r="2.8" fill={c} />}
        </Shots>
      </>
    ),
    strike: (el) => {
      const s = ready(el);
      if (!s) return;
      play(fx(el, 'lid'), [{ transform: 'none' }, { transform: 'translateY(-7px) rotate(-18deg)', offset: 0.35 }, { transform: 'translateY(1px)', offset: 0.75 }, { transform: 'none' }], { duration: 640, easing: 'ease-out' });
      play(s, [{ transform: 'none' }, { transform: 'scale(1.1, 0.92)', offset: 0.2 }, { transform: 'scale(0.95, 1.08)', offset: 0.45 }, { transform: 'none' }], 640);
      fxAll(el, 'glob').forEach((g, i) =>
        play(
          g,
          [
            { transform: 'translate(0, 0) scale(0.4)', opacity: 0 },
            { transform: `translate(-14px, ${-16 - i * 3}px) scale(1.1)`, opacity: 1, offset: 0.45 },
            { transform: `translate(-40px, ${4 + i * 5}px) scale(1.2, 0.6)`, opacity: 0.9, offset: 0.92 },
            { transform: `translate(-40px, ${4 + i * 5}px) scale(0.2)`, opacity: 0 },
          ],
          { duration: 560, delay: 160 + i * 90, easing: 'ease-in', fill: 'backwards' },
        ),
      );
    },
    hit: (el) => {
      if (!ready(el)) return;
      play(fx(el, 'crack'), [{ transform: 'none', filter: 'brightness(1)' }, { transform: 'scale(1.35)', filter: 'brightness(2.5)', offset: 0.3 }, { transform: 'none', filter: 'brightness(1)' }], 460);
      fxAll(el, 'drip').forEach((d) => play(d, [{ transform: 'none' }, { transform: 'translateY(5px) scaleY(1.6)', offset: 0.4 }, { transform: 'none' }], 460));
      knock(el, 0.8);
    },
  },

  // C2 relay: its beacon blazes and signal arcs fly out; a hit makes it lose signal; it ends going dark and toppling over.
  c2_relay: {
    color: '#f472b6',
    gait: { kf: 'm-pulse', s: 1.8 },
    body: (c) => (
      <>
        <path d="M24 16 L15 42 M24 16 L33 42 M18 33 H30 M20 26 H28" stroke="#a1a1aa" strokeWidth="1.8" strokeLinecap="round" />
        {[
          ['M16 8 Q12 14 16 20 M32 8 Q36 14 32 20', 0],
          ['M12 5 Q6 14 12 23 M36 5 Q42 14 36 23', 1],
        ].map(([d, i]) => (
          <path key={i} data-fx="wave" d={d as string} fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" opacity="0.8" style={{ ['--i' as string]: i }} />
        ))}
        <g data-fx="beacon" style={o(24, 14)}>
          <circle cx="24" cy="14" r="3.5" fill={c} />
        </g>
      </>
    ),
    fx: (c) => (
      <Shots k="sig" n={3} x={9} y={14}>
        {() => <path d="M3 -6 Q-2 0 3 6" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" />}
      </Shots>
    ),
    strike: (el) => {
      const s = ready(el);
      if (!s) return;
      play(s, [{ transform: 'none' }, { transform: 'rotate(-7deg)', offset: 0.3 }, { transform: 'rotate(-7deg)', offset: 0.7 }, { transform: 'none' }], { duration: 820, easing: 'ease-in-out' });
      play(fx(el, 'beacon'), [{ transform: 'none', filter: 'brightness(1)' }, { transform: 'scale(2)', filter: 'brightness(1.8)', offset: 0.25 }, { transform: 'scale(1.4)', offset: 0.6 }, { transform: 'none', filter: 'brightness(1)' }], 760);
      fxAll(el, 'wave').forEach((w, i) => play(w, [{ opacity: 0.2 }, { opacity: 1, strokeWidth: 2.6 }, { opacity: 0.2 }], { duration: 300, delay: 100 + i * 120, iterations: 2 }));
      setTimeout(() => void volley(el, 'sig', () => [-40, 0], { ms: 520, stagger: 130 }), 160);
    },
    hit: (el) => {
      const s = ready(el);
      if (!s) return;
      play(fx(el, 'beacon'), [{ opacity: 1 }, { opacity: 0.1 }, { opacity: 1 }, { opacity: 0.1 }, { opacity: 1 }], 480);
      fxAll(el, 'wave').forEach((w) => play(w, [{ opacity: 0.8 }, { opacity: 0, offset: 0.2 }, { opacity: 0, offset: 0.7 }, { opacity: 0.8 }], 560));
      play(s, [{ transform: 'none' }, { transform: 'rotate(5deg)' }, { transform: 'rotate(-4deg)' }, { transform: 'rotate(2deg)' }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
      flash(el, 300, 1.8);
    },
  },
};

export const minionOf = (id: string | null | undefined): MinionMoves | undefined => (id ? MINIONS[id] : undefined);
