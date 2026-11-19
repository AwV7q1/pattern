import { forwardRef, useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Intent } from './types';

/**
 * The enemy, drawn in SVG. Each enemy has its own body (ant drone, storm
 * cloud, bull, plague doctor, price tag, crowned lord) and palette; the
 * current intent sets its stance on top of that body:
 *
 * - probe: scanning beam, a reticle eye
 * - spike: spikes out, angry slits, shaking
 * - retry: spinning retry arrows, ghost copies of itself
 * - slow:  sleepy lids, hourglass, slow sway
 * - debt:  chains, floating bug cards, glitching
 * - heal:  shield bubble, rising crosses, happy eyes
 *
 * Bosses in phase 2 burn; elites wear a gold rim; HP below half cracks it.
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
  className?: string;
}

export const BotAvatar = forwardRef<HTMLDivElement, BotAvatarProps>(function BotAvatar(
  { enemyId, stance, hpRatio, enraged = false, rank = 'normal', className },
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
  return (
    <div ref={ref} className={cn('relative size-44', className)} data-stance={stance} title={STANCE[stance].label}>
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
            {rank === 'elite' && <circle cx="80" cy="80" r="50" fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="3 4" opacity="0.8" />}
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

        <StanceFront stance={stance} />
      </svg>
    </div>
  );
});
