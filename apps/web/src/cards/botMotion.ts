// How each enemy and minion moves: an idle gait (CSS keyframes in styles.css,
// played inside the SVG), a strike style for its attack, and reactions to hits,
// summons and defeat that differ by tier (warmup mini bot, normal, elite, floor
// boss). DOM-only, like fx.ts: these illustrate, the rules decide.
import { reduced } from './fx';
import { LORD, LORD_DIE_MS, lordHit, lordStrike, lordSummon } from './ddosLord';

export type BotTier = 'mini' | 'normal' | 'elite' | 'boss';

/** Idle movement, as `gait-<name>` keyframes. */
export type Gait =
  | 'hover'
  | 'hop'
  | 'march'
  | 'stomp'
  | 'beat'
  | 'drift'
  | 'prowl'
  | 'swing'
  | 'dangle'
  | 'jitter'
  | 'tick'
  | 'slither'
  | 'creep'
  | 'scan'
  | 'levitate';

/** How it attacks at the start of the enemy turn. */
export type Strike = 'lunge' | 'charge' | 'slam' | 'spin' | 'blink' | 'spit';

export interface Motion {
  gait: Gait;
  strike: Strike;
}

/** Seconds per idle cycle. */
const GAIT_S: Record<Gait, number> = {
  hover: 3.2,
  hop: 1.1,
  march: 0.9,
  stomp: 2.8,
  beat: 1.4,
  drift: 6,
  prowl: 3.6,
  swing: 2.4,
  dangle: 3,
  jitter: 0.8,
  tick: 1,
  slither: 1.8,
  creep: 8,
  scan: 3,
  levitate: 3.4,
};

/** Where the gait pivots, in the 160×160 avatar box: feet for hops and stomps, the top for things that hang. */
const GAIT_ORIGIN: Partial<Record<Gait, string>> = {
  hop: '80px 140px',
  march: '80px 140px',
  stomp: '80px 140px',
  swing: '80px 20px',
  dangle: '80px 0px',
  slither: '80px 140px',
};

const MOTIONS: Record<string, Motion> = {
  // warmup mini bots: bouncy and quick
  script_kiddie: { gait: 'hop', strike: 'lunge' },
  ping_bot: { gait: 'hover', strike: 'spit' },
  spam_bot: { gait: 'march', strike: 'spit' },
  uptime_bot: { gait: 'beat', strike: 'charge' },
  // classic enemies
  swarm: { gait: 'drift', strike: 'charge' },
  retry_storm: { gait: 'drift', strike: 'spin' },
  herd: { gait: 'stomp', strike: 'charge' },
  // floor 1
  crawler: { gait: 'dangle', strike: 'lunge' },
  memory_leak: { gait: 'jitter', strike: 'slam' },
  cron_storm: { gait: 'tick', strike: 'spin' },
  // floor 2
  scraper: { gait: 'prowl', strike: 'charge' },
  cred_stuffer: { gait: 'prowl', strike: 'blink' },
  slowloris: { gait: 'creep', strike: 'lunge' },
  sneaker_bot: { gait: 'hop', strike: 'charge' },
  click_farm: { gait: 'jitter', strike: 'spit' },
  api_abuser: { gait: 'march', strike: 'blink' },
  // floor 3
  iot_botnet: { gait: 'scan', strike: 'spit' },
  amplifier: { gait: 'beat', strike: 'spit' },
  worm: { gait: 'slither', strike: 'lunge' },
  ransom_gang: { gait: 'swing', strike: 'slam' },
  apt_group: { gait: 'hover', strike: 'blink' },
  hydra: { gait: 'slither', strike: 'lunge' },
  // floor bosses
  cache_poisoner: { gait: 'prowl', strike: 'spit' },
  black_friday: { gait: 'swing', strike: 'slam' },
  ddos_lord: { gait: 'levitate', strike: 'slam' }, // its own strike, hit and summon: ddosLord.tsx
};

export const motionOf = (enemyId: string): Motion => MOTIONS[enemyId] ?? { gait: 'hover', strike: 'lunge' };

/** Mini bots move quicker, bosses heavier; a boss in phase 2 speeds back up. */
const TIER_PACE: Record<BotTier, number> = { mini: 0.75, normal: 1, elite: 1.1, boss: 1.35 };

/** The CSS for the idle gait layer. */
export function gaitStyle(enemyId: string, tier: BotTier, enraged = false) {
  const { gait } = motionOf(enemyId);
  const s = GAIT_S[gait] * TIER_PACE[tier] * (enraged ? 0.6 : 1);
  return { transformOrigin: GAIT_ORIGIN[gait] ?? '80px 80px', animation: `gait-${gait} ${s.toFixed(2)}s ease-in-out infinite` };
}

// ---------------------------------------------------------------- actions

/** Bigger and slower for a boss, small and snappy for a mini bot. */
const TIER_AMP: Record<BotTier, { amp: number; time: number }> = {
  mini: { amp: 0.8, time: 0.85 },
  normal: { amp: 1, time: 1 },
  elite: { amp: 1.15, time: 1.1 },
  boss: { amp: 1.35, time: 1.3 },
};

/** The enemy stands right of your system: an attack moves left. */
function strikeFrames(strike: Strike, a: number): { frames: Keyframe[]; ms: number; times?: number } {
  const x = (px: number) => `${(px * a).toFixed(1)}px`;
  switch (strike) {
    case 'lunge':
      return {
        ms: 520,
        frames: [
          { transform: 'none' },
          { transform: `translateX(${x(10)})`, offset: 0.2 },
          { transform: `translateX(${x(-34)}) scale(1.08)`, offset: 0.45 },
          { transform: `translateX(${x(-30)})`, offset: 0.6 },
          { transform: 'none' },
        ],
      };
    case 'charge':
      return {
        ms: 640,
        frames: [
          { transform: 'none' },
          { transform: `translateX(${x(16)}) skewX(8deg)`, offset: 0.3 },
          { transform: `translateX(${x(-46)}) skewX(-10deg)`, offset: 0.55 },
          { transform: `translateX(${x(-40)})`, offset: 0.65 },
          { transform: 'none' },
        ],
      };
    case 'slam':
      return {
        ms: 620,
        frames: [
          { transform: 'none' },
          { transform: `translateY(${x(-26)}) scale(1.05)`, offset: 0.35 },
          { transform: `translateY(${x(6)}) scale(1.1, 0.86)`, offset: 0.55 },
          { transform: 'translateY(0) scale(0.98, 1.03)', offset: 0.7 },
          { transform: 'none' },
        ],
      };
    case 'spin':
      return {
        ms: 600,
        frames: [
          { transform: 'rotate(0deg) scale(1)' },
          { transform: `rotate(-200deg) scale(${(1 + 0.12 * a).toFixed(2)}) translateX(${x(-10)})`, offset: 0.5 },
          { transform: 'rotate(-360deg) scale(1)' },
        ],
      };
    case 'blink':
      return {
        ms: 700,
        frames: [
          { transform: 'none', opacity: 1 },
          { transform: 'scale(0.6, 1.2)', opacity: 0, offset: 0.2 },
          { transform: `translateX(${x(-40)}) scale(0.6, 1.2)`, opacity: 0, offset: 0.4 },
          { transform: `translateX(${x(-40)}) scale(1.08)`, opacity: 1, offset: 0.55 },
          { transform: 'none', opacity: 1 },
        ],
      };
    case 'spit':
      return {
        ms: 420,
        times: 2,
        frames: [
          { transform: 'none' },
          { transform: `translateX(${x(6)}) scale(1.1)`, offset: 0.3 },
          { transform: `translateX(${x(-8)}) scale(0.94)`, offset: 0.5 },
          { transform: 'none' },
        ],
      };
  }
}

const bodyOf = (el: Element | null) => el?.querySelector('svg') ?? null;

/** The enemy's attack move, by its strike style and tier. Resolves when it lands. */
export async function botStrike(el: Element | null, enemyId: string, tier: BotTier): Promise<void> {
  if (el && enemyId === LORD) return lordStrike(el);
  const body = bodyOf(el);
  if (!body || reduced()) return;
  const t = TIER_AMP[tier];
  const { frames, ms, times = 1 } = strikeFrames(motionOf(enemyId).strike, t.amp);
  const anim = body.animate(frames, { duration: ms * t.time, iterations: times, easing: 'cubic-bezier(0.3, 0, 0.3, 1)' });
  await anim.finished.catch(() => undefined);
}

/** A smaller follow-up while the attack keeps going. */
export function botJab(el: Element | null, tier: BotTier) {
  const body = bodyOf(el);
  if (!body || reduced()) return;
  const a = TIER_AMP[tier].amp;
  body.animate(
    [{ transform: 'none' }, { transform: `translateX(${(-8 * a).toFixed(1)}px) scale(1.03)`, offset: 0.4 }, { transform: 'none' }],
    { duration: 300, easing: 'ease-out' },
  );
}

/** Taking a hit: a mini bot gets knocked around, a boss barely flinches. */
export function botHit(el: Element | null, tier: BotTier) {
  if (el?.getAttribute('data-enemy') === LORD) return lordHit(el);
  if (!el || reduced()) return;
  const frames: Record<BotTier, { f: Keyframe[]; ms: number }> = {
    mini: {
      ms: 480,
      f: [
        { transform: 'none', filter: 'brightness(1)' },
        { transform: 'translateX(14px) rotate(16deg)', filter: 'brightness(1.9)', offset: 0.25 },
        { transform: 'translateX(-4px) rotate(-7deg)', offset: 0.6 },
        { transform: 'none', filter: 'brightness(1)' },
      ],
    },
    normal: {
      ms: 420,
      f: [0, 9, -9, 6, -6, 3, 0].map((px, i) => ({ transform: `translateX(${px}px)`, filter: i === 1 ? 'brightness(1.7)' : 'brightness(1)' })),
    },
    elite: {
      ms: 360,
      f: [
        { transform: 'none', filter: 'brightness(1)' },
        { transform: 'translateX(6px) scale(0.97)', filter: 'brightness(1.6) sepia(0.6)', offset: 0.25 },
        { transform: 'translateX(-4px)', offset: 0.55 },
        { transform: 'none', filter: 'brightness(1)' },
      ],
    },
    boss: {
      ms: 320,
      f: [
        { transform: 'none', filter: 'brightness(1)' },
        { transform: 'translateX(3px) scale(0.985)', filter: 'brightness(1.5)', offset: 0.3 },
        { transform: 'none', filter: 'brightness(1)' },
      ],
    },
  };
  const { f, ms } = frames[tier];
  el.animate(f, { duration: ms, easing: 'ease-out' });
}

/** Calling minions: rise up and flare. */
export async function botSummon(el: Element | null, tier: BotTier): Promise<void> {
  if (el?.getAttribute('data-enemy') === LORD) return lordSummon(el);
  const body = bodyOf(el);
  if (!body || reduced()) return;
  const a = TIER_AMP[tier];
  const anim = body.animate(
    [
      { transform: 'none', filter: 'brightness(1)' },
      { transform: `translateY(${(-12 * a.amp).toFixed(1)}px) scale(1.08)`, filter: 'brightness(1.6) drop-shadow(0 0 10px #fb923c)', offset: 0.45 },
      { transform: 'translateY(-4px) scale(1.04)', filter: 'brightness(1.3) drop-shadow(0 0 6px #fb923c)', offset: 0.7 },
      { transform: 'none', filter: 'brightness(1)' },
    ],
    { duration: 620 * a.time, easing: 'ease-out' },
  );
  await anim.finished.catch(() => undefined);
}

// ---------------------------------------------------------------- minions

export type MinionStrike = 'hop' | 'dash' | 'buzz' | 'spin' | 'pulse';

const MINION_MOTIONS: Record<string, { gait: string; s: number; strike: MinionStrike }> = {
  spam_msg: { gait: 'm-flutter', s: 1.6, strike: 'dash' },
  bot_con: { gait: 'gait-hop', s: 0.9, strike: 'hop' },
  cron_job: { gait: 'gait-tick', s: 1, strike: 'spin' },
  phone: { gait: 'm-buzz', s: 1.8, strike: 'buzz' },
  scalper: { gait: 'm-dash', s: 2.2, strike: 'dash' },
  zombie: { gait: 'm-shamble', s: 2.6, strike: 'hop' },
  proxy_shield: { gait: 'm-pulse', s: 2.4, strike: 'pulse' },
  hydra_head: { gait: 'gait-slither', s: 1.6, strike: 'dash' },
  poison_node: { gait: 'gait-hover', s: 2.8, strike: 'pulse' },
  c2_relay: { gait: 'm-pulse', s: 1.8, strike: 'buzz' },
};

const minionMotion = (id: string) => MINION_MOTIONS[id] ?? { gait: 'gait-hover', s: 2.4, strike: 'hop' as const };

/** The CSS for a minion's idle layer (in its 48×48 box), out of step with the others. */
export function minionGaitStyle(minionId: string, index: number) {
  const m = minionMotion(minionId);
  return { transformOrigin: '24px 40px', animation: `${m.gait} ${m.s}s ease-in-out ${(index * 0.37).toFixed(2)}s infinite` };
}

/** A minion joining the attack. */
export function minionStrike(el: Element | null, minionId: string) {
  const body = bodyOf(el);
  if (!body || reduced()) return;
  const frames: Record<MinionStrike, Keyframe[]> = {
    hop: [{ transform: 'none' }, { transform: 'translate(-8px, -10px)', offset: 0.4 }, { transform: 'translate(-12px, 0) scale(1.1, 0.9)', offset: 0.65 }, { transform: 'none' }],
    dash: [{ transform: 'none' }, { transform: 'translateX(5px)', offset: 0.25 }, { transform: 'translateX(-16px) skewX(-12deg)', offset: 0.55 }, { transform: 'none' }],
    buzz: [0, -3, 3, -3, 3, -2, 2, 0].map((px) => ({ transform: `translateX(${px}px) rotate(${px * 2}deg)` })),
    spin: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-360deg) scale(1.15)' }],
    pulse: [{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.22)', filter: 'brightness(1.8)', offset: 0.4 }, { transform: 'scale(1)', filter: 'brightness(1)' }],
  };
  body.animate(frames[minionMotion(minionId).strike], { duration: 420, easing: 'ease-out' });
}

/** A minion taking a hit: squash and flash. */
export function minionHit(el: Element | null) {
  if (!el || reduced()) return;
  el.animate(
    [
      { transform: 'none', filter: 'brightness(1)' },
      { transform: 'translateX(5px) scale(1.18, 0.82)', filter: 'brightness(2)', offset: 0.3 },
      { transform: 'translateX(-2px) scale(0.95, 1.05)', offset: 0.6 },
      { transform: 'none', filter: 'brightness(1)' },
    ],
    { duration: 360, easing: 'ease-out' },
  );
}

/** How long a fallen minion stays on screen for its exit (keyframes `minion-die` / `minion-flee`). */
export const MINION_EXIT_MS = 1500;

/** How long the defeat animation runs (keyframes `bot-die-<tier>`). */
export const BOT_DIE_MS: Record<BotTier, number> = { mini: 1100, normal: 1300, elite: 1500, boss: 2200 };

/** The defeat's length for this enemy: by tier, or its own (keyframes `lord-*` for the DDoS Lord). */
export const botDieMs = (enemyId: string, tier: BotTier) => (enemyId === LORD ? LORD_DIE_MS : BOT_DIE_MS[tier]);
export const dieClass = (enemyId: string, tier: BotTier) => (enemyId === LORD ? 'bot-die-lord' : `bot-die-${tier}`);
