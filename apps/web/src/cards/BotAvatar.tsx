import { forwardRef, useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Intent } from './types';
import { BOT_DIE_MS, gaitStyle, minionGaitStyle, type BotTier } from './botMotion';

/**
 * The enemy, drawn in SVG. Each enemy has its own body (warmup kid, radar,
 * mailbox, heart monitor, ant drone, storm cloud, bull, spider, RAM stick,
 * alarm clock, vacuum, burglar, loris, sneaker, phone rack, braces, camera,
 * megaphone, worm, padlock, hooded shadow, hydra, plague doctor, price tag,
 * crowned lord) and palette; the current intent sets its stance on top of
 * that body. Minions get a small body of their own (`MinionAvatar`).
 *
 * - probe: scanning beam, a reticle eye
 * - spike: spikes out, angry slits, shaking
 * - retry: spinning retry arrows, ghost copies of itself
 * - slow:  sleepy lids, hourglass, slow sway
 * - debt:  chains, floating bug cards, glitching
 * - heal:  shield bubble, rising crosses, happy eyes
 *
 * Bosses in phase 2 burn; elites wear a gold rim; HP below half cracks it.
 *
 * On top of the stance, each body has its own idle gait (hop, stomp, dangle,
 * slither… see botMotion.ts) and its tier adds a layer: warmup mini bots are
 * smaller and twinkle, elites flex inside a spinning gold rim, floor bosses
 * breathe over a shadow that sends out shockwaves. Defeat plays by tier.
 */

export type BotStance = Intent['icon'];
export type BotRank = 'normal' | 'elite' | 'boss';

interface Palette {
  main: string;
  light: string;
  dark: string;
}

interface Look {
  palette: Palette;
  /** Where the eyes sit and how big they are. */
  eyes: { l: [number, number]; r: [number, number]; s: number };
  body: (p: Palette, ids: Ids) => ReactNode;
  /** One orbiting minion, drawn around (0, 0). */
  minion: (p: Palette, i: number) => ReactNode;
  minions: number;
}

interface Ids {
  head: string;
  glow: string;
}

const STANCE: Record<BotStance, { color: string; label: string }> = {
  probe: { color: '#38bdf8', label: 'Dò quét' },
  spike: { color: '#f43f5e', label: 'Dồn tải' },
  retry: { color: '#f59e0b', label: 'Retry' },
  slow: { color: '#94a3b8', label: 'Làm chậm' },
  debt: { color: '#a855f7', label: 'Gieo nợ' },
  heal: { color: '#34d399', label: 'Hồi phục' },
};

/** Orbit speed (seconds per turn) by stance. */
const ORBIT_S: Record<BotStance, number> = { probe: 16, spike: 7, retry: 4, slow: 40, debt: 14, heal: 22 };

/** Body animation by stance (keyframes in styles.css). */
const BODY_ANIM: Record<BotStance, string> = {
  probe: 'bot-bob 3s ease-in-out infinite',
  spike: 'bot-rage 0.45s linear infinite',
  retry: 'bot-bob 1.2s ease-in-out infinite',
  slow: 'bot-sway 5s ease-in-out infinite',
  debt: 'bot-glitch 2.4s steps(1) infinite',
  heal: 'bot-bob 2.6s ease-in-out infinite',
};

// ---------------------------------------------------------------- bodies

const LOOKS: Record<string, Look> = {
  // warmup: a kid in a backwards cap and headphones; tiny skulls of copied scripts
  script_kiddie: {
    palette: { main: '#a3e635', light: '#d9f99d', dark: '#1a2e05' },
    eyes: { l: [70, 86], r: [90, 86], s: 0.9 },
    minions: 5,
    minion: (p) => (
      <g opacity="0.75">
        <circle r="3.2" fill={p.light} />
        <rect x="-2" y="1.5" width="4" height="2.4" rx="0.6" fill={p.light} />
        <circle cx="-1.2" cy="-0.4" r="0.8" fill="#18181b" />
        <circle cx="1.2" cy="-0.4" r="0.8" fill="#18181b" />
      </g>
    ),
    body: (p, ids) => (
      <>
        {/* hoodie */}
        <path d="M46 140 Q48 110 80 108 Q112 110 114 140 Z" fill="#27272a" stroke={p.main} strokeOpacity="0.5" />
        <path d="M74 112 L72 128 M86 112 L88 128" stroke={p.light} strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="80" cy="82" r="28" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.85" />
        {/* cap, worn backwards */}
        <path d="M52 76 Q54 50 80 50 Q106 50 108 76 Z" fill={p.main} opacity="0.9" />
        <path d="M100 62 Q118 62 122 70 L104 72 Z" fill={p.dark} stroke={p.main} />
        {/* headphones */}
        <path d="M50 84 Q50 46 80 44 Q110 46 110 84" fill="none" stroke="#52525b" strokeWidth="4" />
        <rect x="44" y="76" width="10" height="18" rx="4" fill="#3f3f46" stroke={p.main} />
        <rect x="106" y="76" width="10" height="18" rx="4" fill="#3f3f46" stroke={p.main} />
        <rect x="60" y="78" width="40" height="16" rx="8" fill="#09090b" />
        <path d="M74 100 Q80 104 86 100" fill="none" stroke={p.light} strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },

  // warmup: a radar dish sending out ping rings
  ping_bot: {
    palette: { main: '#38bdf8', light: '#bae6fd', dark: '#082f49' },
    eyes: { l: [71, 84], r: [89, 84], s: 0.85 },
    minions: 4,
    minion: (p) => (
      <g fill="none" stroke={p.light} strokeWidth="1.2" opacity="0.7">
        <circle r="1.5" fill={p.light} />
        <path d="M3 -3 A4.5 4.5 0 0 1 3 3" />
        <path d="M5.5 -5 A7.5 7.5 0 0 1 5.5 5" />
      </g>
    ),
    body: (p, ids) => (
      <>
        {[22, 32, 42].map((r, i) => (
          <circle key={r} cx="80" cy="84" r={r + 14} fill="none" stroke={p.main} strokeOpacity={0.35 - i * 0.1} style={{ animation: `bot-float 2s ease-in-out ${i * 0.3}s infinite` }} />
        ))}
        <path d="M70 112 L64 136 M90 112 L96 136 M66 128 H94" stroke="#52525b" strokeWidth="3" strokeLinecap="round" />
        <circle cx="80" cy="84" r="27" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" />
        <path d="M80 57 V40" stroke="#71717a" strokeWidth="2.5" />
        <circle cx="80" cy="38" r="4" fill={p.main} filter={`url(#${ids.glow})`} className="animate-pulse" />
        <rect x="62" y="77" width="36" height="15" rx="7.5" fill="#09090b" />
        <text x="80" y="104" textAnchor="middle" fontSize="7" fontFamily="monospace" fill={p.light}>
          PING
        </text>
      </>
    ),
  },

  // warmup: a mailbox robot spitting envelopes
  spam_bot: {
    palette: { main: '#f59e0b', light: '#fde68a', dark: '#451a03' },
    eyes: { l: [70, 74], r: [90, 74], s: 0.9 },
    minions: 6,
    minion: (p) => (
      <g opacity="0.8">
        <rect x="-4" y="-3" width="8" height="6" rx="1" fill="#27272a" stroke={p.light} strokeWidth="0.9" />
        <path d="M-3.6 -2.4 L0 0.6 L3.6 -2.4" fill="none" stroke={p.light} strokeWidth="0.9" />
      </g>
    ),
    body: (p, ids) => (
      <>
        <rect x="76" y="110" width="8" height="28" fill="#52525b" />
        <path d="M50 66 Q50 46 80 46 Q110 46 110 66 V110 H50 Z" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" />
        <rect x="58" y="66" width="44" height="16" rx="8" fill="#09090b" />
        <rect x="60" y="92" width="40" height="5" rx="2.5" fill="#09090b" stroke={p.main} strokeOpacity="0.6" />
        {/* the flag is up: mail to send */}
        <path d="M110 70 H122 V54 H132 V62 H122" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinejoin="round" />
        {[0, 1].map((i) => (
          <g key={i} transform={`translate(${70 + i * 18} 98) rotate(${i ? 12 : -10})`} style={{ animation: `bot-float 1.8s ease-in-out ${i * 0.6}s infinite` }}>
            <rect x="-7" y="0" width="14" height="10" rx="1.5" fill="#fafafa" stroke={p.main} />
            <path d="M-6 1 L0 6 L6 1" fill="none" stroke={p.main} />
          </g>
        ))}
      </>
    ),
  },

  // warmup: a heart monitor on legs, its screen showing a pulse line
  uptime_bot: {
    palette: { main: '#34d399', light: '#a7f3d0', dark: '#022c22' },
    eyes: { l: [68, 70], r: [92, 70], s: 0.85 },
    minions: 6,
    minion: (p) => <path d="M-5 0 H-2 L-1 -3 L1 3 L2 0 H5" fill="none" stroke={p.light} strokeWidth="1.2" opacity="0.75" />,
    body: (p, ids) => (
      <>
        <path d="M64 114 L58 138 M96 114 L102 138" stroke="#52525b" strokeWidth="3" strokeLinecap="round" />
        <rect x="44" y="48" width="72" height="66" rx="10" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" />
        <rect x="54" y="62" width="52" height="16" rx="8" fill="#09090b" />
        <rect x="54" y="84" width="52" height="22" rx="3" fill="#09090b" stroke={p.main} strokeOpacity="0.5" />
        <path d="M56 96 H70 L74 88 L79 104 L83 92 L86 96 H104" fill="none" stroke={p.main} strokeWidth="2" strokeLinejoin="round" filter={`url(#${ids.glow})`} />
        <circle cx="108" cy="54" r="2.5" fill="#22c55e" className="animate-pulse" />
      </>
    ),
  },

  // a red ant drone with antennae and mandibles; a swarm of tiny ants
  swarm: {
    palette: { main: '#f43f5e', light: '#fda4af', dark: '#4c0519' },
    eyes: { l: [68, 76], r: [92, 76], s: 1 },
    minions: 12,
    minion: (p, i) => (
      <g opacity={i % 3 === 0 ? 0.95 : 0.55}>
        <ellipse cx="-2.5" cy="0" rx="2.4" ry="1.8" fill={p.main} />
        <ellipse cx="2.2" cy="0" rx="2.8" ry="2.1" fill={p.light} />
      </g>
    ),
    body: (p, ids) => (
      <>
        <path d="M68 50 Q60 34 50 24" fill="none" stroke="#71717a" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M92 50 Q100 34 110 24" fill="none" stroke="#71717a" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="50" cy="24" r="4" fill={p.main} filter={`url(#${ids.glow})`} />
        <circle cx="110" cy="24" r="4" fill={p.main} filter={`url(#${ids.glow})`} />
        {/* thorax and legs */}
        <ellipse cx="80" cy="122" rx="18" ry="10" fill="#27272a" stroke={p.main} strokeOpacity="0.6" />
        {[-1, 1].map((d) =>
          [0, 1, 2].map((k) => (
            <path
              key={`${d}${k}`}
              d={`M${80 + d * 14} ${118 + k * 4} l${d * 14} ${-6 + k * 7} l${d * 6} ${6 + k * 2}`}
              fill="none"
              stroke="#52525b"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )),
        )}
        <ellipse cx="80" cy="78" rx="36" ry="32" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.85" />
        <ellipse cx="80" cy="76" rx="27" ry="15" fill="#09090b" />
        {/* mandibles */}
        <path d="M66 102 Q56 112 64 118 Q66 110 72 106 Z" fill={p.light} opacity="0.85" />
        <path d="M94 102 Q104 112 96 118 Q94 110 88 106 Z" fill={p.light} opacity="0.85" />
      </>
    ),
  },

  // a storm cloud with a visor; lightning underneath, retry arrows around
  retry_storm: {
    palette: { main: '#38bdf8', light: '#bae6fd', dark: '#0c4a6e' },
    eyes: { l: [70, 84], r: [90, 84], s: 1 },
    minions: 6,
    minion: (p) => (
      <g fill="none" stroke={p.light} strokeWidth="1.6" strokeLinecap="round" opacity="0.8">
        <path d="M4 -2 A4.5 4.5 0 1 0 4 2.5" />
        <path d="M4 -5 L4.4 -1.6 L1 -1.8" />
      </g>
    ),
    body: (p, ids) => {
      const puffs: [number, number, number][] = [
        [56, 86, 20],
        [80, 70, 27],
        [105, 84, 21],
        [80, 94, 22],
        [66, 74, 16],
        [96, 72, 16],
      ];
      return (
        <>
          {/* lightning */}
          <g filter={`url(#${ids.glow})`} className="animate-pulse">
            <path d="M66 108 L60 124 L66 124 L60 138" fill="none" stroke="#fde047" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M96 110 L102 122 L96 122 L101 134" fill="none" stroke="#fde047" strokeWidth="2" strokeLinejoin="round" />
          </g>
          {[72, 82, 90].map((x, i) => (
            <line key={x} x1={x} y1={114 + i * 3} x2={x - 3} y2={126 + i * 3} stroke={p.light} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
          ))}
          {/* outline: the same puffs, a little bigger, under the fill */}
          {puffs.map(([x, y, r]) => (
            <circle key={`o${x}${y}`} cx={x} cy={y} r={r + 2} fill={p.main} opacity="0.85" />
          ))}
          {puffs.map(([x, y, r]) => (
            <circle key={`f${x}${y}`} cx={x} cy={y} r={r} fill={`url(#${ids.head})`} />
          ))}
          <rect x="56" y="74" width="48" height="21" rx="10.5" fill="#09090b" />
        </>
      );
    },
  },

  // a horned bull robot with a nose ring; a stampede of small bulls
  herd: {
    palette: { main: '#f97316', light: '#fed7aa', dark: '#431407' },
    eyes: { l: [67, 76], r: [93, 76], s: 1 },
    minions: 9,
    minion: (p, i) => (
      <g opacity={i % 2 ? 0.55 : 0.9}>
        <rect x="-3.5" y="-2.5" width="7" height="5" rx="1.5" fill={p.main} />
        <path d="M-3.5 -2 l-2 -2.5 M3.5 -2 l2 -2.5" stroke={p.light} strokeWidth="1.2" strokeLinecap="round" />
      </g>
    ),
    body: (p, ids) => (
      <>
        <path d="M52 58 Q26 52 20 26 Q34 44 58 48 Z" fill="#e7e5e4" stroke={p.main} strokeWidth="1.5" strokeOpacity="0.7" />
        <path d="M108 58 Q134 52 140 26 Q126 44 102 48 Z" fill="#e7e5e4" stroke={p.main} strokeWidth="1.5" strokeOpacity="0.7" />
        <path d="M46 62 L32 70 L46 78 Z" fill="#3f3f46" stroke={p.main} strokeOpacity="0.5" />
        <path d="M114 62 L128 70 L114 78 Z" fill="#3f3f46" stroke={p.main} strokeOpacity="0.5" />
        <rect x="44" y="46" width="72" height="66" rx="22" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.85" />
        <rect x="52" y="66" width="56" height="20" rx="9" fill="#09090b" />
        <ellipse cx="80" cy="104" rx="22" ry="13" fill="#27272a" stroke={p.main} strokeOpacity="0.5" />
        <ellipse cx="72" cy="103" rx="3.5" ry="2.5" fill={p.main} filter={`url(#${ids.glow})`} />
        <ellipse cx="88" cy="103" rx="3.5" ry="2.5" fill={p.main} filter={`url(#${ids.glow})`} />
        <circle cx="80" cy="117" r="6" fill="none" stroke="#fbbf24" strokeWidth="2.5" />
      </>
    ),
  },

  // boss: a hooded plague doctor with a gas mask, dripping poison
  cache_poisoner: {
    palette: { main: '#84cc16', light: '#d9f99d', dark: '#2e1065' },
    eyes: { l: [69, 80], r: [91, 80], s: 1.1 },
    minions: 8,
    minion: (p, i) => (
      <g>
        <rect x="-4" y="-4" width="8" height="8" rx="1.5" fill={i % 2 ? '#7c3aed' : p.main} opacity="0.85" />
        <text x="0" y="2.6" textAnchor="middle" fontSize="7" fontFamily="monospace" fontWeight="bold" fill="#09090b">
          ?
        </text>
      </g>
    ),
    body: (p, ids) => (
      <>
        <path d="M80 22 Q124 36 124 92 L120 124 Q80 136 40 124 L36 92 Q36 36 80 22 Z" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.8" />
        <path d="M80 22 Q66 50 64 60" fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="2" />
        <ellipse cx="80" cy="86" rx="27" ry="30" fill="#050505" />
        {/* gas mask: lens rims and a filter canister */}
        <circle cx="69" cy="80" r="9" fill="#18181b" stroke="#52525b" strokeWidth="2" />
        <circle cx="91" cy="80" r="9" fill="#18181b" stroke="#52525b" strokeWidth="2" />
        <path d="M72 96 L88 96 L84 102 L76 102 Z" fill="#3f3f46" />
        <circle cx="80" cy="108" r="8" fill={p.main} stroke="#365314" strokeWidth="2" />
        {[-3, 0, 3].map((d) => (
          <circle key={d} cx={80 + d} cy={108} r="1" fill="#1a2e05" />
        ))}
        {/* poison drips from the hood */}
        {[52, 80, 106].map((x, i) => (
          <path
            key={x}
            d={`M${x} 126 q-3 6 0 8 q3 -2 0 -8`}
            fill={p.main}
            style={{ animation: `bot-drip 2.2s ease-in ${i * 0.6}s infinite` }}
          />
        ))}
        {/* a flask in hand */}
        <g transform="translate(126 104) rotate(14)">
          <path d="M-3 -12 L3 -12 L3 -5 L9 8 Q10 12 6 12 L-6 12 Q-10 12 -9 8 L-3 -5 Z" fill="#18181b" stroke={p.light} strokeWidth="1.2" />
          <path d="M-7 4 L7 4 L9 8 Q10 11 6 11 L-6 11 Q-10 11 -9 8 Z" fill={p.main} filter={`url(#${ids.glow})`} />
        </g>
      </>
    ),
  },

  // boss: a black price tag shouting a discount; shopping bags and coins
  black_friday: {
    palette: { main: '#facc15', light: '#fef08a', dark: '#09090b' },
    eyes: { l: [65, 70], r: [87, 70], s: 1 },
    minions: 8,
    minion: (p, i) =>
      i % 2 ? (
        <g>
          <circle r="4" fill={p.main} />
          <text x="0" y="2.5" textAnchor="middle" fontSize="6.5" fontFamily="monospace" fontWeight="bold" fill="#09090b">
            $
          </text>
        </g>
      ) : (
        <g>
          <path d="M-2.5 -3 Q0 -7 2.5 -3" fill="none" stroke={p.light} strokeWidth="1.2" />
          <rect x="-4" y="-3" width="8" height="8" rx="1" fill="#e11d48" />
        </g>
      ),
    body: (p, ids) => (
      <>
        <path d="M112 80 Q130 60 122 34" fill="none" stroke="#a1a1aa" strokeWidth="1.5" />
        <path
          d="M50 44 L102 44 L126 80 L102 116 L50 116 Q42 116 42 108 L42 52 Q42 44 50 44 Z"
          fill={`url(#${ids.head})`}
          stroke={p.main}
          strokeWidth="2.5"
        />
        <circle cx="112" cy="80" r="4.5" fill="#09090b" stroke={p.main} strokeWidth="1.5" />
        <rect x="50" y="56" width="52" height="28" rx="7" fill="#09090b" />
        <rect x="50" y="92" width="52" height="16" rx="4" fill={p.main} />
        <text x="76" y="104.5" textAnchor="middle" fontSize="12" fontFamily="monospace" fontWeight="900" fill="#09090b">
          -70%
        </text>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <rect key={i} x={54 + i * 5.5} y="48" width={i % 3 ? 1.5 : 3} height="5" fill={p.light} opacity="0.6" />
        ))}
      </>
    ),
  },

  // boss: a crowned lord with a third eye and a cape; an army of minions
  ddos_lord: {
    palette: { main: '#d946ef', light: '#f5d0fe', dark: '#3b0764' },
    eyes: { l: [67, 80], r: [93, 80], s: 1.1 },
    minions: 14,
    minion: (p, i) => (
      <g opacity={i % 2 ? 0.6 : 0.95}>
        <rect x="-3.5" y="-3" width="7" height="6" rx="1.5" fill="#27272a" stroke={p.main} strokeWidth="0.8" />
        <circle cx="-1.3" cy="0" r="0.9" fill={p.light} />
        <circle cx="1.3" cy="0" r="0.9" fill={p.light} />
      </g>
    ),
    body: (p, ids) => (
      <>
        <path d="M24 140 Q34 104 60 104 L100 104 Q126 104 136 140 Z" fill={p.dark} stroke={p.main} strokeOpacity="0.6" />
        <path d="M60 104 L80 126 L100 104" fill="none" stroke="#fbbf24" strokeWidth="2" />
        <rect x="44" y="48" width="72" height="62" rx="16" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.85" />
        <path d="M46 52 L50 26 L64 40 L80 16 L96 40 L110 26 L114 52 Z" fill="#fbbf24" stroke="#92400e" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="80" cy="36" r="3.5" fill="#e11d48" />
        <circle cx="62" cy="44" r="2.2" fill="#22d3ee" />
        <circle cx="98" cy="44" r="2.2" fill="#22d3ee" />
        <rect x="52" y="70" width="56" height="20" rx="9" fill="#09090b" />
        <path d="M80 56 L85 62 L80 68 L75 62 Z" fill={p.main} filter={`url(#${ids.glow})`} className="animate-pulse" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={63 + i * 7} y="96" width="4" height="8" rx="1" fill="#52525b" />
        ))}
      </>
    ),
  },

  // ---- floor 1

  // a spider robot hanging from a thread; tiny spiders
  crawler: {
    palette: { main: '#14b8a6', light: '#99f6e4', dark: '#042f2e' },
    eyes: { l: [70, 79], r: [90, 79], s: 0.9 },
    minions: 10,
    minion: (p, i) => (
      <g opacity={i % 2 ? 0.55 : 0.9} stroke={p.light} strokeWidth="0.8">
        <path d="M-4 -3 L4 3 M-4 3 L4 -3 M-5 0 H5" />
        <circle r="2.2" fill={p.main} stroke="none" />
      </g>
    ),
    body: (p, ids) => (
      <>
        <line x1="80" y1="0" x2="80" y2="52" stroke={p.light} strokeOpacity="0.5" strokeDasharray="2 2" />
        {[-1, 1].map((d) =>
          [0, 1, 2, 3].map((k) => (
            <path
              key={`${d}${k}`}
              d={`M${80 + d * 18} ${72 + k * 8} Q${80 + d * (44 + k * 2)} ${48 + k * 14} ${80 + d * (56 - k * 2)} ${94 + k * 12}`}
              fill="none"
              stroke="#52525b"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          )),
        )}
        <ellipse cx="80" cy="114" rx="22" ry="18" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="1.5" />
        <path d="M74 106 L86 106 L80 114 L86 122 L74 122 L80 114 Z" fill={p.main} filter={`url(#${ids.glow})`} />
        <circle cx="80" cy="78" r="28" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.85" />
        <rect x="58" y="70" width="44" height="18" rx="9" fill="#09090b" />
        <path d="M72 100 L74 108 L77 100 M83 100 L86 108 L88 100" fill={p.light} />
      </>
    ),
  },

  // elite: a stick of RAM leaking into a puddle; floating bits
  memory_leak: {
    palette: { main: '#ec4899', light: '#fbcfe8', dark: '#500724' },
    eyes: { l: [68, 74], r: [92, 74], s: 1 },
    minions: 10,
    minion: (p, i) => (
      <text x="0" y="3" textAnchor="middle" fontSize="8" fontFamily="monospace" fontWeight="bold" fill={i % 2 ? p.light : p.main}>
        {i % 3 ? '1' : '0'}
      </text>
    ),
    body: (p, ids) => (
      <>
        <ellipse cx="80" cy="138" rx="36" ry="6" fill={p.main} opacity="0.4" />
        {[56, 80, 104].map((x, i) => (
          <path key={x} d={`M${x} 114 q-3 6 0 8 q3 -2 0 -8`} fill={p.main} style={{ animation: `bot-drip 1.8s ease-in ${i * 0.5}s infinite` }} />
        ))}
        <rect x="40" y="40" width="80" height="64" rx="6" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.85" />
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x={44 + i * 6.2} y="104" width="3.6" height="9" rx="0.8" fill={i === 6 ? 'transparent' : '#fbbf24'} />
        ))}
        <rect x="52" y="64" width="56" height="20" rx="8" fill="#09090b" />
        {[48, 70, 92].map((x) => (
          <rect key={x} x={x} y="88" width="18" height="10" rx="1.5" fill="#18181b" stroke={p.main} strokeOpacity="0.5" />
        ))}
        <text x="80" y="55" textAnchor="middle" fontSize="9" fontFamily="monospace" fontWeight="bold" fill={p.light}>
          99% RAM
        </text>
      </>
    ),
  },

  // elite: an alarm clock stuck at midnight; tiny clocks
  cron_storm: {
    palette: { main: '#fbbf24', light: '#fef3c7', dark: '#451a03' },
    eyes: { l: [68, 78], r: [92, 78], s: 1 },
    minions: 8,
    minion: (p) => (
      <g>
        <circle r="4" fill="#18181b" stroke={p.main} strokeWidth="1" />
        <path d="M0 0 V-2.6 M0 0 H2" stroke={p.light} strokeWidth="0.9" strokeLinecap="round" />
      </g>
    ),
    body: (p, ids) => (
      <>
        <path d="M58 114 L48 132 M102 114 L112 132" stroke="#52525b" strokeWidth="5" strokeLinecap="round" />
        <path d="M62 34 Q80 20 98 34" fill="none" stroke="#71717a" strokeWidth="4" strokeLinecap="round" />
        <g style={{ transformOrigin: '80px 34px', animation: 'bot-rage 0.3s linear infinite' }}>
          <circle cx="50" cy="42" r="13" fill={p.main} stroke={p.dark} strokeWidth="2" />
          <circle cx="110" cy="42" r="13" fill={p.main} stroke={p.dark} strokeWidth="2" />
        </g>
        <circle cx="80" cy="82" r="40" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="3" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return <line key={i} x1={80 + 33 * Math.cos(a)} y1={82 + 33 * Math.sin(a)} x2={80 + 37 * Math.cos(a)} y2={82 + 37 * Math.sin(a)} stroke={p.light} strokeWidth={i % 3 ? 1 : 2.5} />;
        })}
        <rect x="58" y="68" width="44" height="20" rx="10" fill="#09090b" />
        <rect x="62" y="96" width="36" height="14" rx="3" fill="#09090b" />
        <text x="80" y="107" textAnchor="middle" fontSize="11" fontFamily="monospace" fontWeight="bold" fill="#ef4444" className="animate-pulse">
          00:00
        </text>
      </>
    ),
  },

  // ---- floor 2

  // a vacuum robot sucking up price tags
  scraper: {
    palette: { main: '#22c55e', light: '#bbf7d0', dark: '#052e16' },
    eyes: { l: [66, 74], r: [88, 74], s: 1 },
    minions: 8,
    minion: (p, i) => (
      <g opacity={i % 2 ? 0.6 : 0.95}>
        <path d="M-4 -3 L3 -3 L5 0 L3 3 L-4 3 Z" fill={p.main} />
        <circle cx="2.6" cy="0" r="0.9" fill="#09090b" />
      </g>
    ),
    body: (p, ids) => (
      <>
        <path d="M108 84 Q142 86 134 114 Q128 130 112 130" fill="none" stroke="#52525b" strokeWidth="7" strokeLinecap="round" />
        <path d="M108 84 Q142 86 134 114 Q128 130 112 130" fill="none" stroke={p.main} strokeOpacity="0.4" strokeWidth="2" strokeDasharray="3 4" />
        <rect x="90" y="126" width="30" height="9" rx="3" fill={p.main} />
        {[0, 1, 2].map((i) => (
          <text key={i} x={64 + i * 10} y="144" fontSize="7" fontFamily="monospace" fill={p.light} style={{ animation: `bot-float 1.4s ease-in-out ${i * 0.3}s infinite` }}>
            $
          </text>
        ))}
        <circle cx="58" cy="110" r="8" fill="#27272a" stroke={p.main} strokeOpacity="0.6" />
        <circle cx="96" cy="110" r="8" fill="#27272a" stroke={p.main} strokeOpacity="0.6" />
        <rect x="40" y="44" width="70" height="62" rx="20" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.85" />
        <rect x="48" y="64" width="54" height="20" rx="9" fill="#09090b" />
        <g transform="translate(58 42) rotate(-18)">
          <path d="M-10 -6 L6 -6 L11 0 L6 6 L-10 6 Z" fill={p.light} />
          <text x="-2" y="3.5" textAnchor="middle" fontSize="8" fontFamily="monospace" fontWeight="bold" fill={p.dark}>
            $
          </text>
        </g>
      </>
    ),
  },

  // a burglar in a beanie and eye mask, a ring of stolen keys
  cred_stuffer: {
    palette: { main: '#94a3b8', light: '#e2e8f0', dark: '#0f172a' },
    eyes: { l: [68, 79], r: [92, 79], s: 1 },
    minions: 9,
    minion: (p, i) => (
      <g stroke={i % 3 ? p.light : '#fbbf24'} strokeWidth="1.2" fill="none" opacity={i % 2 ? 0.6 : 0.95}>
        <circle cx="-3" r="2.2" />
        <path d="M-0.8 0 H5 M3 0 V2 M5 0 V2" />
      </g>
    ),
    body: (p, ids) => (
      <>
        <ellipse cx="36" cy="112" rx="15" ry="18" fill="#44403c" stroke="#78716c" />
        <text x="36" y="118" textAnchor="middle" fontSize="14" fontFamily="monospace" fontWeight="bold" fill="#fbbf24">
          $
        </text>
        <circle cx="80" cy="84" r="32" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.85" />
        <path d="M46 72 Q46 32 80 32 Q114 32 114 72 Z" fill="#27272a" stroke={p.main} strokeOpacity="0.6" />
        {[54, 66, 78, 90, 102].map((x) => (
          <line key={x} x1={x} y1="44" x2={x} y2="70" stroke="#3f3f46" strokeWidth="2" />
        ))}
        <circle cx="80" cy="30" r="6" fill="#e11d48" />
        <rect x="44" y="70" width="72" height="18" rx="9" fill="#09090b" />
        <path d="M70 104 Q80 108 90 104" fill="none" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" />
        <circle cx="118" cy="110" r="8" fill="none" stroke="#fbbf24" strokeWidth="2.5" />
        {[-10, 8, 26].map((rot) => (
          <g key={rot} transform={`translate(118 118) rotate(${rot})`}>
            <path d="M0 0 V14 M0 10 H3 M0 14 H3" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
          </g>
        ))}
      </>
    ),
  },

  // a slow loris with huge dark eye patches, hugging a cable
  slowloris: {
    palette: { main: '#d6a067', light: '#fde68a', dark: '#292524' },
    eyes: { l: [63, 78], r: [97, 78], s: 1.2 },
    minions: 6,
    minion: (p, i) => (
      <text x="0" y="3" textAnchor="middle" fontSize={6 + (i % 3) * 2} fontFamily="monospace" fontWeight="bold" fill={p.light} opacity="0.7">
        z
      </text>
    ),
    body: (p, ids) => (
      <>
        <path d="M14 128 Q80 116 146 124" fill="none" stroke="#52525b" strokeWidth="5" strokeLinecap="round" />
        <rect x="132" y="118" width="12" height="9" rx="2" fill="#71717a" />
        <path d="M144 120 h5 M144 125 h5" stroke="#a1a1aa" strokeWidth="1.5" />
        <circle cx="46" cy="50" r="11" fill={p.main} stroke={p.dark} strokeWidth="2" />
        <circle cx="114" cy="50" r="11" fill={p.main} stroke={p.dark} strokeWidth="2" />
        <circle cx="80" cy="82" r="38" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2.5" />
        <path d="M76 46 L84 46 L86 104 L74 104 Z" fill={p.light} opacity="0.45" />
        <circle cx="63" cy="78" r="15" fill="#09090b" stroke={p.dark} strokeWidth="2" />
        <circle cx="97" cy="78" r="15" fill="#09090b" stroke={p.dark} strokeWidth="2" />
        <ellipse cx="80" cy="100" rx="4.5" ry="3" fill="#1c1917" />
        <path d="M48 112 Q64 130 80 124 Q96 130 112 112" fill="none" stroke={p.main} strokeWidth="9" strokeLinecap="round" />
      </>
    ),
  },

  // a running sneaker with speed lines; shoe boxes
  sneaker_bot: {
    palette: { main: '#06b6d4', light: '#a5f3fc', dark: '#083344' },
    eyes: { l: [60, 82], r: [80, 82], s: 0.95 },
    minions: 8,
    minion: (p, i) => (
      <g opacity={i % 2 ? 0.6 : 0.95}>
        <rect x="-5" y="-3" width="10" height="6" rx="1" fill="#e11d48" />
        <line x1="-5" y1="-1" x2="5" y2="-1" stroke={p.light} strokeWidth="0.7" />
      </g>
    ),
    body: (p, ids) => (
      <>
        {[78, 92, 106].map((y, i) => (
          <line key={y} x1={4 + i * 4} y1={y} x2={22 + i * 4} y2={y} stroke={p.light} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
        ))}
        <path d="M30 112 L134 112 Q140 112 138 120 L136 124 L32 124 Q26 124 28 118 Z" fill="#e5e7eb" stroke="#a1a1aa" />
        <path
          d="M34 112 L38 68 Q42 54 58 58 L74 64 Q90 74 108 84 L128 96 Q138 102 134 112 Z"
          fill={`url(#${ids.head})`}
          stroke={p.main}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <ellipse cx="48" cy="60" rx="10" ry="4" fill="#09090b" />
        <rect x="44" y="73" width="48" height="18" rx="9" fill="#09090b" />
        {[0, 1, 2].map((k) => (
          <path key={k} d={`M${98 + k * 8} ${80 + k * 4} l6 -6 M${98 + k * 8} ${74 + k * 4} l6 6`} stroke={p.light} strokeWidth="1.5" strokeLinecap="round" />
        ))}
        <path d="M54 102 L72 96 L70 102 L96 94" fill="none" stroke={p.main} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      </>
    ),
  },

  // elite: a rack of phones tapped by hand; mouse cursors
  click_farm: {
    palette: { main: '#a3e635', light: '#ecfccb', dark: '#1a2e05' },
    eyes: { l: [71, 80], r: [89, 80], s: 0.85 },
    minions: 10,
    minion: (p, i) => <path d="M-2 -4 L-2 4 L0 2 L2 5 L3 4.4 L1 1.6 L4 1.4 Z" fill={i % 2 ? p.light : p.main} stroke="#09090b" strokeWidth="0.5" />,
    body: (p, ids) => (
      <>
        <rect x="30" y="30" width="100" height="104" rx="6" fill="#18181b" stroke={p.main} strokeOpacity="0.6" strokeWidth="2" />
        {[0, 1, 2].map((r) =>
          [0, 1, 2].map((c) =>
            r === 1 && c === 1 ? null : (
              <g key={`${r}${c}`}>
                <rect x={36 + c * 31} y={36 + r * 33} width="26" height="29" rx="3.5" fill={`url(#${ids.head})`} stroke={p.main} strokeOpacity="0.5" />
                <rect x={39 + c * 31} y={40 + r * 33} width="20" height="19" rx="1.5" fill={p.main} opacity="0.22" />
                <circle cx={49 + c * 31} cy={50 + r * 33} r="2.5" fill={p.light} className={(r + c) % 2 ? 'animate-ping' : undefined} />
              </g>
            ),
          ),
        )}
        <rect x="60" y="62" width="40" height="40" rx="5" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" />
        <rect x="64" y="69" width="32" height="22" rx="4" fill="#09090b" />
        <circle cx="80" cy="96" r="2" fill={p.main} />
      </>
    ),
  },

  // elite: a robot between curly braces, wearing a stolen key
  api_abuser: {
    palette: { main: '#6366f1', light: '#c7d2fe', dark: '#1e1b4b' },
    eyes: { l: [68, 80], r: [92, 80], s: 1 },
    minions: 8,
    minion: (p, i) => (
      <text x="0" y="3" textAnchor="middle" fontSize="8" fontFamily="monospace" fontWeight="bold" fill={i % 2 ? p.light : p.main}>
        {i % 2 ? '{}' : '[]'}
      </text>
    ),
    body: (p, ids) => (
      <>
        {[-1, 1].map((d) => (
          <path
            key={d}
            d={`M${80 - d * 34} 34 Q${80 - d * 46} 34 ${80 - d * 46} 48 L${80 - d * 46} 70 Q${80 - d * 46} 80 ${80 - d * 56} 80 Q${80 - d * 46} 80 ${80 - d * 46} 90 L${80 - d * 46} 112 Q${80 - d * 46} 126 ${80 - d * 34} 126`}
            fill="none"
            stroke={p.main}
            strokeWidth="5"
            strokeLinecap="round"
            filter={`url(#${ids.glow})`}
          />
        ))}
        <rect x="50" y="46" width="60" height="68" rx="14" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.85" />
        <rect x="56" y="70" width="48" height="20" rx="9" fill="#09090b" />
        <g transform="translate(80 58)">
          <circle cx="-6" r="4" fill="none" stroke="#fbbf24" strokeWidth="2" />
          <path d="M-2 0 H9 M6 0 V3 M9 0 V3" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
        </g>
        <rect x="65" y="96" width="30" height="12" rx="3" fill={p.main} />
        <text x="80" y="105" textAnchor="middle" fontSize="9" fontFamily="monospace" fontWeight="900" fill="#09090b">
          API
        </text>
      </>
    ),
  },

  // ---- floor 3

  // a hacked security camera over a blinking router; tiny cameras
  iot_botnet: {
    palette: { main: '#ef4444', light: '#fecaca', dark: '#450a0a' },
    eyes: { l: [62, 75], r: [82, 75], s: 0.95 },
    minions: 14,
    minion: (p, i) => (
      <g opacity={i % 2 ? 0.55 : 0.95}>
        <rect x="-4" y="-2.5" width="7" height="5" rx="1" fill="#3f3f46" stroke={p.main} strokeWidth="0.6" />
        <circle cx="-4.5" cy="0" r="1.6" fill={p.main} />
      </g>
    ),
    body: (p, ids) => (
      <>
        <rect x="114" y="22" width="10" height="28" rx="2" fill="#3f3f46" />
        <path d="M119 50 L106 62" stroke="#52525b" strokeWidth="6" strokeLinecap="round" />
        <rect x="22" y="58" width="18" height="36" rx="4" fill="#27272a" stroke={p.main} strokeOpacity="0.5" />
        <rect x="36" y="56" width="80" height="40" rx="8" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.85" />
        <rect x="46" y="65" width="52" height="20" rx="9" fill="#09090b" />
        <circle cx="106" cy="66" r="3.5" fill="#ef4444" filter={`url(#${ids.glow})`} className="animate-pulse" />
        <text x="106" y="90" textAnchor="middle" fontSize="6" fontFamily="monospace" fill={p.light}>
          REC
        </text>
        <path d="M50 114 L38 100 M110 114 L122 100" stroke="#71717a" strokeWidth="3" strokeLinecap="round" />
        <rect x="44" y="110" width="72" height="18" rx="4" fill="#27272a" stroke={p.main} strokeOpacity="0.5" />
        {[0, 1, 2, 3, 4].map((i) => (
          <circle key={i} cx={58 + i * 11} cy="119" r="2.2" fill="#4ade80" style={{ animation: `bot-flicker 0.5s ease-in-out ${i * 0.15}s infinite alternate` }} />
        ))}
      </>
    ),
  },

  // a megaphone blasting sound waves
  amplifier: {
    palette: { main: '#f59e0b', light: '#fde68a', dark: '#451a03' },
    eyes: { l: [66, 80], r: [84, 80], s: 0.95 },
    minions: 8,
    minion: (p, i) => <path d="M-2 -4 Q2 0 -2 4 M1 -6 Q7 0 1 6" fill="none" stroke={i % 2 ? p.light : p.main} strokeWidth="1.2" strokeLinecap="round" />,
    body: (p, ids) => (
      <>
        {[0, 1, 2].map((i) => (
          <path
            key={i}
            d={`M${134 + i * 9} ${62 - i * 10} Q${144 + i * 12} 80 ${134 + i * 9} ${98 + i * 10}`}
            fill="none"
            stroke={p.main}
            strokeWidth="3"
            strokeLinecap="round"
            style={{ animation: `bot-flicker 0.6s ease-in-out ${i * 0.2}s infinite alternate` }}
          />
        ))}
        <path d="M58 100 L52 126 L66 126 L72 104 Z" fill="#27272a" stroke={p.main} strokeOpacity="0.5" />
        <rect x="32" y="62" width="22" height="36" rx="6" fill="#3f3f46" stroke={p.main} strokeOpacity="0.6" />
        <path d="M52 60 L118 34 Q126 32 126 40 L126 120 Q126 128 118 126 L52 100 Z" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeLinejoin="round" />
        <ellipse cx="124" cy="80" rx="7" ry="44" fill="#18181b" stroke={p.main} strokeWidth="2" />
        <rect x="54" y="70" width="44" height="20" rx="9" fill="#09090b" />
        <text x="90" y="110" textAnchor="middle" fontSize="10" fontFamily="monospace" fontWeight="bold" fill={p.light}>
          ×50
        </text>
      </>
    ),
  },

  // a segmented worm rearing up; baby worms
  worm: {
    palette: { main: '#a855f7', light: '#e9d5ff', dark: '#3b0764' },
    eyes: { l: [96, 62], r: [114, 62], s: 0.9 },
    minions: 9,
    minion: (p, i) => (
      <g opacity={i % 2 ? 0.55 : 0.9}>
        <circle cx="-4" r="1.8" fill={p.main} />
        <circle cx="0" r="2.1" fill={p.main} />
        <circle cx="4" r="2.4" fill={p.light} />
      </g>
    ),
    body: (p, ids) => {
      const segs: [number, number, number][] = [
        [30, 124, 10],
        [46, 120, 12],
        [62, 124, 13],
        [78, 116, 14],
        [90, 100, 15],
        [98, 86, 15],
      ];
      return (
        <>
          {segs.map(([x, y, r]) => (
            <g key={x}>
              <circle cx={x} cy={y} r={r} fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="1.5" />
              <path d={`M${x - r * 0.6} ${y - r * 0.4} Q${x} ${y + r * 0.3} ${x + r * 0.6} ${y - r * 0.4}`} fill="none" stroke={p.main} strokeOpacity="0.6" strokeWidth="1.5" />
            </g>
          ))}
          <path d="M98 42 L90 26 M114 42 L122 26" stroke="#71717a" strokeWidth="2" strokeLinecap="round" />
          <circle cx="90" cy="26" r="3.5" fill={p.main} filter={`url(#${ids.glow})`} />
          <circle cx="122" cy="26" r="3.5" fill={p.main} filter={`url(#${ids.glow})`} />
          <circle cx="105" cy="64" r="24" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.85" />
          <rect x="86" y="54" width="38" height="18" rx="9" fill="#09090b" />
          <path d="M96 80 L101 86 L105 80 L109 86 L114 80" fill="none" stroke={p.light} strokeWidth="1.8" strokeLinejoin="round" />
          <text x="62" y="128" textAnchor="middle" fontSize="6" fontFamily="monospace" fontWeight="bold" fill={p.light}>
            0day
          </text>
        </>
      );
    },
  },

  // a padlock with a ransom note
  ransom_gang: {
    palette: { main: '#e11d48', light: '#fecdd3', dark: '#4c0519' },
    eyes: { l: [68, 90], r: [92, 90], s: 1 },
    minions: 8,
    minion: (p, i) => (
      <g>
        <circle r="4" fill={i % 2 ? '#fbbf24' : p.main} />
        <text x="0" y="2.5" textAnchor="middle" fontSize="6.5" fontFamily="monospace" fontWeight="bold" fill="#09090b">
          $
        </text>
      </g>
    ),
    body: (p, ids) => (
      <>
        <path d="M54 66 L54 46 Q54 22 80 22 Q106 22 106 46 L106 66" fill="none" stroke="#a1a1aa" strokeWidth="10" strokeLinecap="round" />
        <path d="M106 40 Q122 40 124 52" fill="none" stroke="#a1a1aa" strokeWidth="1" />
        <g transform="translate(126 62) rotate(10)">
          <rect x="-12" y="-9" width="24" height="18" rx="1.5" fill="#fef3c7" />
          <text x="0" y="-1" textAnchor="middle" fontSize="5.5" fontFamily="monospace" fontWeight="bold" fill="#991b1b">
            PAY
          </text>
          <text x="0" y="6" textAnchor="middle" fontSize="5.5" fontFamily="monospace" fontWeight="bold" fill="#991b1b">
            $$$
          </text>
        </g>
        <rect x="40" y="62" width="80" height="68" rx="12" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.85" />
        <rect x="50" y="80" width="60" height="20" rx="9" fill="#09090b" />
        <circle cx="80" cy="112" r="5" fill="#09090b" />
        <rect x="78" y="113" width="4" height="10" rx="1" fill="#09090b" />
        {[46, 114].map((x) => (
          <circle key={x} cx={x} cy="70" r="2" fill="#71717a" />
        ))}
      </>
    ),
  },

  // elite: a hooded shadow whose face is a void; watching eyes
  apt_group: {
    palette: { main: '#64748b', light: '#67e8f9', dark: '#020617' },
    eyes: { l: [71, 82], r: [89, 82], s: 0.85 },
    minions: 6,
    minion: (p, i) => (
      <g opacity={i % 2 ? 0.35 : 0.7}>
        <path d="M-5 0 Q0 -4 5 0 Q0 4 -5 0 Z" fill="none" stroke={p.light} strokeWidth="0.8" />
        <circle r="1.4" fill={p.light} />
      </g>
    ),
    body: (p, ids) => (
      <>
        <path d="M26 142 Q34 98 52 90 L108 90 Q126 98 134 142 Z" fill={p.dark} stroke={p.main} strokeOpacity="0.5" />
        <path d="M116 58 Q134 50 148 40 Q140 56 146 66 Q132 64 118 70 Z" fill={p.main} opacity="0.5" />
        <path d="M80 22 Q120 28 122 80 Q120 106 80 112 Q40 106 38 80 Q40 28 80 22 Z" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.8" />
        <ellipse cx="80" cy="84" rx="25" ry="22" fill="#020202" />
        <path d="M66 96 h6 M76 96 h10 M90 96 h4" stroke={p.light} strokeOpacity="0.5" strokeWidth="1.5" />
        <path d="M120 112 L136 128 L132 132 L116 116 Z" fill="#a1a1aa" />
        <rect x="112" y="108" width="8" height="8" rx="1" transform="rotate(45 116 112)" fill="#3f3f46" />
      </>
    ),
  },

  // elite: a three-headed serpent; baby heads
  hydra: {
    palette: { main: '#10b981', light: '#a7f3d0', dark: '#022c22' },
    eyes: { l: [70, 76], r: [90, 76], s: 0.95 },
    minions: 9,
    minion: (p, i) => (
      <g opacity={i % 2 ? 0.55 : 0.9}>
        <ellipse rx="4" ry="2.8" fill={p.main} />
        <circle cx="1.5" cy="-0.8" r="0.9" fill="#fde047" />
      </g>
    ),
    body: (p, ids) => (
      <>
        {[-1, 1].map((d) => (
          <g key={d}>
            <path d={`M${80 + d * 12} 128 Q${80 + d * 36} 112 ${80 + d * 44} 70`} fill="none" stroke={p.dark} strokeWidth="12" strokeLinecap="round" />
            <path d={`M${80 + d * 12} 128 Q${80 + d * 36} 112 ${80 + d * 44} 70`} fill="none" stroke={p.main} strokeWidth="2" strokeOpacity="0.6" strokeDasharray="4 5" />
            <ellipse cx={80 + d * 46} cy="60" rx="16" ry="13" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="1.5" />
            <path d={`M${80 + d * 40} 56 l${d * 8} 3`} stroke="#fde047" strokeWidth="2.5" strokeLinecap="round" filter={`url(#${ids.glow})`} />
            <path d={`M${80 + d * 52} 68 l${d * 3} 5 l${d * 2} -5`} fill={p.light} />
          </g>
        ))}
        <ellipse cx="80" cy="130" rx="34" ry="12" fill={`url(#${ids.head})`} stroke={p.main} strokeOpacity="0.7" />
        <rect x="72" y="94" width="16" height="36" rx="6" fill={p.dark} stroke={p.main} strokeOpacity="0.5" />
        <path d="M60 58 L54 40 L68 52 Z M100 58 L106 40 L92 52 Z" fill={p.light} opacity="0.8" />
        <ellipse cx="80" cy="76" rx="28" ry="24" fill={`url(#${ids.head})`} stroke={p.main} strokeWidth="2" strokeOpacity="0.85" />
        <rect x="58" y="67" width="44" height="18" rx="9" fill="#09090b" />
        <path d="M70 94 l3 7 l3 -7 M84 94 l3 7 l3 -7" fill={p.light} />
      </>
    ),
  },
};

const lookOf = (id: string) => LOOKS[id] ?? LOOKS.swarm;

// ---------------------------------------------------------------- eyes

function Eyes({ look, stance, dying, glow }: { look: Look; stance: BotStance; dying: boolean; glow: string }) {
  const { l, r, s } = look.eyes;
  const c = stance === 'spike' ? '#fb7185' : dying && stance !== 'heal' ? '#fbbf24' : STANCE[stance].color;
  /** One eye drawn around (0, 0); `side` -1 is the left eye. */
  const shape = (side: -1 | 1) => {
    switch (stance) {
      case 'spike': // angry slits, slanted to the middle
        return <path d={`M${-8 * side} -5 L${7 * side} -1 L${7 * side} 4 L${-8 * side} 3 Z`} fill={c} />;
      case 'probe': // a plain eye and a targeting reticle
        return side === 1 ? (
          <>
            <circle r={6.5} fill="none" stroke={c} strokeWidth="1.6" />
            <circle r={2} fill={c} />
            <path d="M-10 0 h4 M6 0 h4 M0 -10 v4 M0 6 v4" stroke={c} strokeWidth="1.4" />
          </>
        ) : (
          <circle r={4.5} fill={c} />
        );
      case 'retry': // spinning spirals
        return (
          <g style={{ transformOrigin: '0px 0px', animation: 'spin 1.1s linear infinite' }}>
            <path d="M-1 0 a1 1 0 0 1 2 0 a2.5 2.5 0 0 1 -5 0 a4 4 0 0 1 8 0 a5.5 5.5 0 0 1 -11 0" fill="none" stroke={c} strokeWidth="1.6" />
          </g>
        );
      case 'slow': // half-closed lids
        return (
          <>
            <path d="M-7 0 Q0 6 7 0 Z" fill={c} />
            <line x1={-8} y1={0} x2={8} y2={0} stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" />
          </>
        );
      case 'debt': // glitched crosses
        return <path d="M-5 -5 L5 5 M5 -5 L-5 5" stroke={c} strokeWidth="2.6" strokeLinecap="round" />;
      case 'heal': // happy arcs
        return <path d="M-6 2 Q0 -7 6 2" fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="round" />;
    }
  };
  return (
    <g filter={`url(#${glow})`} className={dying ? 'animate-pulse' : undefined}>
      <g transform={`translate(${l[0]} ${l[1]}) scale(${s})`}>{shape(-1)}</g>
      <g transform={`translate(${r[0]} ${r[1]}) scale(${s})`}>{shape(1)}</g>
    </g>
  );
}

// ---------------------------------------------------------------- stance effects

/** Effects drawn behind the body. */
function StanceBack({ stance, look }: { stance: BotStance; look: Look }) {
  const c = STANCE[stance].color;
  switch (stance) {
    case 'spike':
      return (
        <g style={{ transformOrigin: '80px 80px', animation: 'bot-spikes 0.9s ease-in-out infinite' }}>
          {Array.from({ length: 14 }, (_, i) => {
            const a = (i / 14) * Math.PI * 2;
            const p = (r: number, da = 0) => `${80 + r * Math.cos(a + da)} ${80 + r * Math.sin(a + da)}`;
            return <path key={i} d={`M${p(46, -0.14)} L${p(i % 2 ? 66 : 74)} L${p(46, 0.14)} Z`} fill={c} opacity={i % 2 ? 0.45 : 0.7} />;
          })}
        </g>
      );
    case 'probe': {
      const [x, y] = look.eyes.r;
      return (
        <g style={{ transformOrigin: `${x}px ${y}px`, animation: 'bot-sweep 3s ease-in-out infinite alternate' }}>
          <path d={`M${x} ${y} L170 ${y - 34} L170 ${y + 34} Z`} fill={`url(#scan-${c.slice(1)})`} />
        </g>
      );
    }
    case 'heal':
      return <circle cx="80" cy="80" r="66" fill={c} fillOpacity="0.07" stroke={c} strokeOpacity="0.55" strokeWidth="2" strokeDasharray="10 5" style={{ transformOrigin: '80px 80px', animation: 'spin 24s linear infinite' }} />;
    default:
      return null;
  }
}

/** Effects drawn over the body. */
function StanceFront({ stance }: { stance: BotStance }) {
  const c = STANCE[stance].color;
  switch (stance) {
    case 'retry':
      return (
        <g style={{ transformOrigin: '80px 80px', animation: 'spin 2.2s linear infinite' }}>
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`rotate(${i * 120} 80 80)`}>
              <path d="M80 18 A62 62 0 0 1 130 44" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" />
              <path d="M131 34 L131 46 L120 44" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ))}
        </g>
      );
    case 'slow':
      return (
        <g transform="translate(128 34)">
          <g style={{ animation: 'bot-tip 4s ease-in-out infinite', transformOrigin: '0px 0px' }}>
            <path d="M-8 -12 H8 M-8 12 H8 M-6 -12 Q-6 -2 0 0 Q-6 2 -6 12 M6 -12 Q6 -2 0 0 Q6 2 6 12" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" />
            <path d="M-4 -7 L4 -7 L0 -1 Z M0 2 L-4 10 L4 10 Z" fill="#fbbf24" />
          </g>
        </g>
      );
    case 'debt':
      return (
        <>
          <g stroke="#a1a1aa" strokeWidth="3" strokeDasharray="6 3" strokeLinecap="round" opacity="0.8">
            <line x1="34" y1="54" x2="126" y2="112" />
            <line x1="126" y1="54" x2="34" y2="112" />
          </g>
          {[
            [28, 40, -14],
            [132, 120, 12],
          ].map(([x, y, rot], i) => (
            <g key={i} transform={`translate(${x} ${y}) rotate(${rot})`}>
              <g style={{ animation: `bot-float 2.4s ease-in-out ${i * 0.8}s infinite` }}>
                <rect x="-8" y="-11" width="16" height="22" rx="2.5" fill="#1e1b4b" stroke={c} strokeWidth="1.5" />
                <circle cx="0" cy="-1" r="3.5" fill={c} />
                <path d="M-5 -4 l2 1.5 M5 -4 l-2 1.5 M-5 3 l2 -1 M5 3 l-2 -1" stroke={c} strokeWidth="1" />
                <text x="0" y="8.5" textAnchor="middle" fontSize="5" fontFamily="monospace" fill={c}>
                  TODO
                </text>
              </g>
            </g>
          ))}
        </>
      );
    case 'heal':
      return (
        <g fill={c}>
          {[
            [40, 0],
            [118, 0.7],
            [62, 1.4],
            [104, 2.1],
          ].map(([x, d]) => (
            <path key={x} d={`M${x - 2} ${110} h4 v-4 h4 v-4 h-4 v-4 h-4 v4 h-4 v4 h4 Z`} style={{ animation: `bot-rise 2.8s ease-out ${d}s infinite` }} opacity="0" />
          ))}
        </g>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------- avatar

export interface BotAvatarProps {
  enemyId: string;
  stance: BotStance;
  hpRatio: number;
  /** Boss phase 2: on fire. */
  enraged?: boolean;
  rank?: BotRank;
  /** A warmup fight's mini bot. */
  mini?: boolean;
  /** The fight is won: play the defeat animation and stay down. */
  defeated?: boolean;
  className?: string;
}

export const tierOf = (rank: BotRank = 'normal', mini = false): BotTier => (rank === 'normal' && mini ? 'mini' : rank);

export const BotAvatar = forwardRef<HTMLDivElement, BotAvatarProps>(function BotAvatar(
  { enemyId, stance, hpRatio, enraged = false, rank = 'normal', mini = false, defeated = false, className },
  ref,
) {
  const uid = useId().replace(/:/g, '');
  const ids: Ids = { head: `${uid}-head`, glow: `${uid}-glow` };
  const look = lookOf(enemyId);
  const p = look.palette;
  const accent = STANCE[stance].color;
  const hurt = hpRatio < 0.5;
  const dying = hpRatio < 0.25;
  const orbit = ORBIT_S[stance];
  const bodyId = `${uid}-body`;
  const tier = tierOf(rank, mini);
  const quake = enraged ? 1.6 : 2.6;
  return (
    <div
      ref={ref}
      className={cn('relative size-44', defeated && `bot-die-${tier}`, className)}
      style={defeated ? { animationDuration: `${BOT_DIE_MS[tier]}ms` } : undefined}
      data-stance={stance}
      data-tier={tier}
      title={STANCE[stance].label}
    >
      <svg viewBox="0 0 160 160" className="bot-avatar size-full overflow-visible" aria-hidden>
        <defs>
          <radialGradient id={`${uid}-aura`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={accent} stopOpacity={stance === 'spike' ? 0.6 : 0.4} />
            <stop offset="55%" stopColor={p.main} stopOpacity="0.14" />
            <stop offset="100%" stopColor={p.main} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={ids.head} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3f3f46" />
            <stop offset="100%" stopColor={p.dark} />
          </linearGradient>
          <linearGradient id={`scan-${accent.slice(1)}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={accent} stopOpacity="0.55" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
          <filter id={ids.glow} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx="80" cy="80" r="80" fill={`url(#${uid}-aura)`} style={{ transition: 'opacity 300ms' }} />

        {/* floor boss: a heavy shadow that breathes, and shockwaves along the ground */}
        {tier === 'boss' && (
          <g>
            <ellipse cx="80" cy="146" rx="46" ry="7" fill="#000" style={{ transformOrigin: '80px 146px', animation: `tier-shadow ${quake * 1.5}s ease-in-out infinite` }} />
            {[0, 0.5].map((d) => (
              <ellipse
                key={d}
                cx="80"
                cy="146"
                rx="56"
                ry="10"
                fill="none"
                stroke={enraged ? '#f97316' : p.main}
                strokeWidth="2"
                opacity="0"
                style={{ transformOrigin: '80px 146px', animation: `tier-quake ${quake}s ease-out ${d * quake}s infinite` }}
              />
            ))}
          </g>
        )}

        {/* boss phase 2: a ring of flames */}
        {enraged && (
          <g style={{ transformOrigin: '80px 80px', animation: 'spin 9s linear infinite' }}>
            {Array.from({ length: 18 }, (_, i) => {
              const a = (i / 18) * Math.PI * 2;
              const x = 80 + 62 * Math.cos(a);
              const y = 80 + 62 * Math.sin(a);
              return (
                <path
                  key={i}
                  d={`M${x - 4} ${y} Q${x} ${y - 14} ${x + 4} ${y} Q${x} ${y + 4} ${x - 4} ${y} Z`}
                  transform={`rotate(${(a * 180) / Math.PI + 90} ${x} ${y})`}
                  fill={i % 2 ? '#f97316' : '#ef4444'}
                  style={{ animation: `bot-flicker 0.6s ease-in-out ${(i % 5) * 0.12}s infinite alternate` }}
                />
              );
            })}
          </g>
        )}

        {/* orbiting minions */}
        <g style={{ transformOrigin: '80px 80px', animation: `spin ${orbit}s linear infinite` }}>
          <circle cx="80" cy="80" r="70" fill="none" stroke={p.main} strokeOpacity="0.18" strokeDasharray="2 6" />
          {Array.from({ length: look.minions }, (_, i) => {
            const a = (i / look.minions) * Math.PI * 2;
            const r = i % 2 && look.minions > 10 ? 58 : 70;
            return (
              <g key={i} transform={`translate(${80 + r * Math.cos(a)} ${80 + r * Math.sin(a)}) rotate(${(a * 180) / Math.PI + 90})`}>
                {look.minion(p, i)}
              </g>
            );
          })}
        </g>

        <StanceBack stance={stance} look={look} />

        {/* tier layer: mini bots are small, elites flex now and then, bosses breathe */}
        <g
          style={{
            transformOrigin: '80px 140px',
            transform: tier === 'mini' ? 'scale(0.86)' : undefined,
            animation: tier === 'elite' ? 'tier-flex 4s ease-in-out infinite' : tier === 'boss' ? `tier-breathe ${enraged ? 2 : 3.6}s ease-in-out infinite` : undefined,
          }}
        >
        {/* idle gait: how this body moves */}
        <g style={gaitStyle(enemyId, tier, enraged)}>
        {/* the body: re-keyed on a stance change so it pops into the new pose */}
        <g key={stance} style={{ transformOrigin: '80px 80px', animation: 'bot-morph 450ms ease-out' }}>
          <g
            style={{
              transformOrigin: '80px 80px',
              animation: BODY_ANIM[stance],
              filter: stance === 'slow' ? 'saturate(0.55)' : stance === 'debt' ? 'hue-rotate(-25deg)' : undefined,
            }}
          >
            {/* retry: two ghost copies echo the body */}
            {stance === 'retry' && (
              <>
                <use href={`#${bodyId}`} opacity="0.22" style={{ animation: 'bot-echo-l 1.2s ease-in-out infinite' }} />
                <use href={`#${bodyId}`} opacity="0.22" style={{ animation: 'bot-echo-r 1.2s ease-in-out infinite' }} />
              </>
            )}
            <g id={bodyId}>
              {look.body(p, ids)}
              <Eyes look={look} stance={stance} dying={dying} glow={ids.glow} />
            </g>
            {tier === 'elite' && (
              <>
                <circle cx="80" cy="80" r="50" fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="3 4" opacity="0.8" style={{ transformOrigin: '80px 80px', animation: 'spin 14s linear infinite' }} />
                <circle cx="80" cy="80" r="55" fill="none" stroke="#fbbf24" strokeWidth="0.8" strokeDasharray="1 7" opacity="0.6" style={{ transformOrigin: '80px 80px', animation: 'spin 9s linear infinite reverse' }} />
              </>
            )}
            {/* damage */}
            {hurt && <path d="M106 52 L98 64 L104 68 L94 82" fill="none" stroke="#d4d4d8" strokeWidth="1.5" strokeLinecap="round" opacity="0.85" />}
            {dying && (
              <>
                <path d="M50 96 L60 90 L56 84" fill="none" stroke="#d4d4d8" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="112" cy="42" r="3" fill="#71717a" opacity="0.6" className="animate-ping" />
              </>
            )}
          </g>
        </g>
        </g>
        </g>

        {/* mini bot: a few twinkles, it is just a beginner */}
        {tier === 'mini' &&
          [
            [36, 40, 0],
            [124, 50, 0.7],
            [118, 118, 1.4],
          ].map(([x, y, d]) => (
            <path
              key={x}
              d={`M${x} ${y - 5} L${x + 1.5} ${y - 1.5} L${x + 5} ${y} L${x + 1.5} ${y + 1.5} L${x} ${y + 5} L${x - 1.5} ${y + 1.5} L${x - 5} ${y} L${x - 1.5} ${y - 1.5} Z`}
              fill="#fde68a"
              opacity="0"
              style={{ transformOrigin: `${x}px ${y}px`, animation: `tier-twinkle 2.1s ease-in-out ${d}s infinite` }}
            />
          ))}

        <StanceFront stance={stance} />
      </svg>
    </div>
  );
});

// ---------------------------------------------------------------- minions

/** Small bodies for the minions that fight next to an enemy, drawn in a 48×48 box. */
const MINION_LOOKS: Record<string, { color: string; body: (c: string) => ReactNode }> = {
  // an envelope with a red badge
  spam_msg: {
    color: '#f59e0b',
    body: (c) => (
      <>
        <rect x="9" y="14" width="30" height="21" rx="3" fill="#27272a" stroke={c} strokeWidth="2" />
        <path d="M10 16 L24 27 L38 16" fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="37" cy="14" r="5" fill="#ef4444" />
        <text x="37" y="16.5" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#fff">!</text>
      </>
    ),
  },
  // a tiny red ant
  bot_con: {
    color: '#f43f5e',
    body: (c) => (
      <>
        {[-1, 1].map((d) => [0, 1, 2].map((k) => <path key={`${d}${k}`} d={`M${24 + d * 4} ${24 + k * 3} l${d * 9} ${-4 + k * 4}`} stroke="#71717a" strokeWidth="1.6" strokeLinecap="round" />))}
        <ellipse cx="24" cy="32" rx="6" ry="5" fill="#3f3f46" stroke={c} />
        <ellipse cx="24" cy="21" rx="9" ry="8" fill="#27272a" stroke={c} strokeWidth="1.8" />
        <path d="M20 14 Q17 8 14 6 M28 14 Q31 8 34 6" fill="none" stroke="#a1a1aa" strokeWidth="1.4" strokeLinecap="round" />
      </>
    ),
  },
  // a gear with a clock face
  cron_job: {
    color: '#a78bfa',
    body: (c) => (
      <>
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x="22" y="7" width="4" height="7" rx="1" fill={c} transform={`rotate(${i * 45} 24 24)`} />
        ))}
        <circle cx="24" cy="24" r="12" fill="#27272a" stroke={c} strokeWidth="2" />
        <path d="M24 17 V24 L29 27" fill="none" stroke="#e4e4e7" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
  // a phone with a tapping finger mark
  phone: {
    color: '#22d3ee',
    body: (c) => (
      <>
        <rect x="15" y="7" width="18" height="34" rx="3.5" fill="#18181b" stroke={c} strokeWidth="2" />
        <rect x="18" y="11" width="12" height="22" rx="1" fill={c} opacity="0.25" />
        <circle cx="24" cy="22" r="3" fill={c} />
        <circle cx="24" cy="22" r="6" fill="none" stroke={c} strokeOpacity="0.6" />
        <circle cx="24" cy="37" r="1.5" fill="#71717a" />
      </>
    ),
  },
  // a shopping bag with a greedy grin
  scalper: {
    color: '#fb923c',
    body: (c) => (
      <>
        <path d="M18 16 Q18 8 24 8 Q30 8 30 16" fill="none" stroke={c} strokeWidth="2" />
        <path d="M11 16 H37 L35 40 H13 Z" fill="#27272a" stroke={c} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="19" cy="24" r="2" fill={c} />
        <circle cx="29" cy="24" r="2" fill={c} />
        <path d="M18 31 Q24 36 30 31" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
  // a hijacked laptop with a skull on screen
  zombie: {
    color: '#84cc16',
    body: (c) => (
      <>
        <rect x="10" y="11" width="28" height="19" rx="2" fill="#18181b" stroke={c} strokeWidth="2" />
        <path d="M6 34 H42 L39 38 H9 Z" fill="#3f3f46" stroke={c} strokeWidth="1.5" />
        <circle cx="24" cy="19" r="5" fill={c} opacity="0.85" />
        <rect x="21" y="22" width="6" height="4" rx="1" fill={c} opacity="0.85" />
        <circle cx="22" cy="19" r="1.3" fill="#18181b" />
        <circle cx="26" cy="19" r="1.3" fill="#18181b" />
      </>
    ),
  },
  // a shield with a mask
  proxy_shield: {
    color: '#60a5fa',
    body: (c) => (
      <>
        <path d="M24 6 L39 12 V23 Q39 35 24 42 Q9 35 9 23 V12 Z" fill="#1e293b" stroke={c} strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M14 21 Q24 16 34 21 Q33 27 28 27 Q24 24 20 27 Q15 27 14 21 Z" fill={c} opacity="0.9" />
        <circle cx="19.5" cy="22.5" r="1.6" fill="#0f172a" />
        <circle cx="28.5" cy="22.5" r="1.6" fill="#0f172a" />
      </>
    ),
  },
  // one serpent head on a neck
  hydra_head: {
    color: '#10b981',
    body: (c) => (
      <>
        <path d="M18 44 Q12 32 20 24 Q26 18 22 12" fill="none" stroke={c} strokeWidth="6" strokeLinecap="round" />
        <ellipse cx="25" cy="12" rx="10" ry="7" fill="#064e3b" stroke={c} strokeWidth="2" />
        <circle cx="27" cy="10" r="2" fill="#fde047" />
        <path d="M34 14 l5 1 l-4 2" fill="none" stroke="#f43f5e" strokeWidth="1.4" strokeLinecap="round" />
      </>
    ),
  },
  // a cracked cache cylinder dripping green
  poison_node: {
    color: '#a3e635',
    body: (c) => (
      <>
        <ellipse cx="24" cy="12" rx="12" ry="4.5" fill="#3f3f46" stroke={c} strokeWidth="1.8" />
        <path d="M12 12 V32 Q24 39 36 32 V12" fill="#27272a" stroke={c} strokeWidth="1.8" />
        <path d="M12 22 Q24 28 36 22" fill="none" stroke={c} strokeOpacity="0.5" />
        <path d="M27 14 L23 21 L27 24 L22 31" fill="none" stroke="#d4d4d8" strokeWidth="1.3" />
        <path d="M18 34 Q17 40 18.5 42 Q20 40 19 34 Z" fill={c} />
        <path d="M30 35 Q29 39 30.5 40.5 Q32 39 31 35 Z" fill={c} />
      </>
    ),
  },
  // a radio mast sending waves
  c2_relay: {
    color: '#f472b6',
    body: (c) => (
      <>
        <path d="M24 16 L15 42 M24 16 L33 42 M18 33 H30 M20 26 H28" stroke="#a1a1aa" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="24" cy="14" r="3.5" fill={c} />
        <path d="M16 8 Q12 14 16 20 M32 8 Q36 14 32 20 M12 5 Q6 14 12 23 M36 5 Q42 14 36 23" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
      </>
    ),
  },
};

export interface MinionAvatarProps {
  minionId: string;
  hpRatio: number;
  /** Bobs out of step with the others. */
  index?: number;
  className?: string;
}

export const MinionAvatar = forwardRef<HTMLDivElement, MinionAvatarProps>(function MinionAvatar({ minionId, hpRatio, index = 0, className }, ref) {
  const look = MINION_LOOKS[minionId] ?? MINION_LOOKS.bot_con;
  return (
    <div ref={ref} className={cn('relative size-12', className)}>
      <svg viewBox="0 0 48 48" className="bot-avatar size-full overflow-visible" aria-hidden>
        <circle cx="24" cy="24" r="23" fill={look.color} opacity="0.12" />
        <g style={minionGaitStyle(minionId, index)}>{look.body(look.color)}</g>
        {hpRatio < 0.5 && <path d="M33 10 L29 17 L32 19 L27 26" fill="none" stroke="#d4d4d8" strokeWidth="1.2" strokeLinecap="round" opacity="0.85" />}
      </svg>
    </div>
  );
});
