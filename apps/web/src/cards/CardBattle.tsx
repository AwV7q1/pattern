import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Bug,
  Crosshair,
  Filter,
  UserPlus,
  TriangleAlert,
  User,
  Users,
  ZapOff,
  EyeOff,
  ShieldOff,
  Unplug,
  Heart,
  Hourglass,
  Sparkles,
  HeartPulse,
  Info,
  LibraryBig,
  ScrollText,
  X,
  LoaderCircle,
  Network,
  Radar,
  Repeat,
  RotateCcw,
  Shield,
  ShieldAlert,
  Skull,
  Trophy,
  Turtle,
  Wallet,
  CloudDownload,
  Dices,
  Zap,
  Snowflake,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { compute } from '@/sim/compute';
import { cn } from '@/lib/utils';
import type { Design, WindowMetrics } from '@/types';
import {
  botCutNow,
  botRpsNow,
  bypassNow,
  canPlay,
  cardDef,
  activeCombos,
  currentIntent,
  designOf,
  moduleOf,
  placementsOf,
  budgetOf,
  alias,
  guardNow,
  hotfixable,
  hotNodes,
  deployFrozen,
  FREEZE_AT,
  riskBlock,
  chassisDef,
  MIGRATION,
  foresightOf,
  tracing,
  nodeCosts,
  spotOf,
  upcomingIntents,
  leakNow,
  intentsNow,
  legitRpsNow,
  minionDef,
  minionRpsNow,
  minionsOf,
  newBattle,
  nodeOf,
  planTurn,
  playCard,
  resolveTurn,
  scoreTurn,
  setTarget,
  statusDef,
  targetOf,
} from './rules';
import type { BattleSetup, BattleState, CardDef, Intent, MinionState, NodeCost, TurnPlan, TurnReport, TurnScore } from './types';
import { BillLine, CostBreakdown } from './Cost';
import { spendByNode } from './postmortem';
import { CONTENT } from './content';
import { statusIcon } from './cardArt';
import { NetBackdrop } from './NetBackdrop';
import { RelicBar } from './Relics';
import { CardLibrary } from './CardLibrary';
import { PostmortemPanel } from './Postmortem';
import { BotAvatar, MinionAvatar, tierOf, type BotRank } from './BotAvatar';
import { botDieMs, MINION_EXIT_MS, minionDieClass, botHit, botJab, botStrike, botSummon, minionHit, minionStrike } from './botMotion';
import { CARD_SIZE, CardFace, Hand, Pile, discardDuration, type DropTarget } from './Hand';
import { DropTag, InfraLine, keysK, pathOf, type InfraRefs, type NodeLoad, type Plug } from './Infra';
import { absorb, anchor, bolts, floatText, flow, glow, infuse, pulse, ring, shake, wait, wave } from './fx';

export const INTENT_ICON: Record<Intent['icon'], typeof Zap> = {
  probe: Radar,
  spike: Zap,
  retry: Repeat,
  slow: Turtle,
  debt: Bug,
  heal: HeartPulse,
};

/** Spark color of each card type, matching the card frames. */
const TYPE_FX: Record<CardDef['type'], string> = {
  infra: '#38bdf8',
  policy: '#a78bfa',
  action: '#34d399',
  attack: '#fb7185',
  curse: '#a1a1aa',
};

const n0 = (v: number) => Math.round(v).toLocaleString('vi-VN');
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** HP the minions there before lost between two states (a minion gone counts its whole HP; new ones are ignored). */
function minionLoss(prev: BattleState, next: BattleState): number {
  const after = new Map(minionsOf(next).map((m) => [m.uid, m.hp]));
  // a won fight clears the minions: they fled, they were not hit
  if (next.phase === 'won') return 0;
  return minionsOf(prev).reduce((sum, m) => sum + Math.max(0, m.hp - (after.get(m.uid) ?? 0)), 0);
}

/** $/h of a design with this turn's temporary instances. */
function costOf(design: Design, temp: BattleState['temp']) {
  return design.nodes.reduce((sum, node) => {
    const extra = node.id === 'api' ? temp.api : node.id === 'db' ? temp.db : 0;
    return sum + ((node.config?.instances ?? 1) + extra) * (node.config?.costPerHour ?? 0);
  }, 0);
}

type Flash = { key: number; player: number; enemy: number };

/** A turn's bill as the forecast saw it. */
type Spend = { costs: NodeCost[]; egress: number };

/** The design the engine would run now (temporary instances, statuses, the attacker's cost spike included). */
const planDesign = (state: BattleState) => planTurn(CONTENT, state).input.design;

/** Load on one node during the replay of a turn. */

/**
 * The turn as it plays out: what the meters show while the bot attacks.
 * 'attack' while the engine computes in the background, 'replay' while its
 * windows are played back second by second.
 */
type Live = {
  phase: 'attack' | 'replay';
  hp: number;
  headroom: number;
  tMs: number;
  rps: number;
  p99: number;
  errRate: number;
  nodes: Record<string, NodeLoad>;
};

/**
 * The enemy side as shown: it lags the rules until the attacks reach it, so
 * HP bars drop (and minions fall) when the bolts land, not when the card is played.
 */
type Foe = { enemyHp: number; minions: MinionState[]; target?: number };
const foeOf = (s: BattleState): Foe => ({ enemyHp: s.enemy.hp, minions: minionsOf(s), target: s.target });

/** `from` after `landed` points of damage reached each target (minion uid, or 'enemy'). */
function foeLanded(from: Foe, landed: Map<number | 'enemy', number>): Foe {
  return {
    enemyHp: from.enemyHp - (landed.get('enemy') ?? 0),
    minions: from.minions.map((m) => ({ ...m, hp: m.hp - (landed.get(m.uid) ?? 0) })),
    target: from.target,
  };
}

/**
 * Card battle prototype: defend a small system against a botnet. Your
 * infrastructure faces the bot across the arena; cards are dragged from the
 * fanned hand onto the arena to play them. When the turn ends the real engine
 * runs 10 simulated seconds of traffic while the bot's requests fly at your
 * gateway, and the engine's numbers decide the damage on both sides. Rules
 * live in `rules.ts` (pure, seeded); `fx.ts` only illustrates them.
 */
export interface CardBattleProps {
  seed: number;
  setup: BattleSetup;
  title: string;
  /** Run progress shown in the top bar. */
  progress?: ReactNode;
  /** The run's current deck (for the library). */
  deck: string[];
  /** Label of the end screen's main button. */
  continueLabel: string;
  /** Elite and boss fights dress the enemy up. */
  rank?: BotRank;
  /** The fight is over and the player moved on. Mount a new CardBattle (new `key`) for the next fight. */
  onFinish: (state: BattleState) => void;
  onAbandon: () => void;
}

export function CardBattle({ seed, setup, title, progress, deck, continueLabel, rank, onFinish, onAbandon }: CardBattleProps) {
  const [state, setState] = useState(() => newBattle(CONTENT, seed, setup));
  /** Mini bot, normal, elite or floor boss: sets how the enemy moves. */
  const tier = tierOf(rank, CONTENT.run.warmup.includes(state.enemy.id));
  const tierRef = useRef(tier);
  tierRef.current = tier;
  /** The enemy has fallen (after the last hit lands); the end screen waits for its defeat to play out. */
  const [down, setDown] = useState(false);
  const [endReady, setEndReady] = useState(false);
  useEffect(() => {
    if (!down) return;
    const t = setTimeout(() => setEndReady(true), botDieMs(state.enemy.id, tierRef.current) + 250);
    return () => clearTimeout(t);
  }, [down]);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  /** How many turn reports the player has looked at (the rest light the badge). */
  const [seenReports, setSeenReports] = useState(0);
  /** The card being dragged and the target under the pointer. */
  const [dragDef, setDragDef] = useState<CardDef | null>(null);
  const [dragOver, setDragOver] = useState<DropTarget | null>(null);
  /** The hand is flying into the discard pile (end of turn). */
  const [discarding, setDiscarding] = useState(false);
  const onDragChange = useCallback((def: CardDef | null, over: DropTarget | null) => {
    setDragDef(def);
    setDragOver(over);
  }, []);
  /** The enemy side while attacks fly at it (null: it shows the rules' state). */
  const [foe, setFoe] = useState<Foe | null>(null);
  /** Bumped by each new attack: a stale volley's landing must not move the shown enemy. */
  const foeToken = useRef(0);
  const [splash, setSplash] = useState<{ key: number; def: CardDef; x: number; y: number } | null>(null);
  const busy = useRef(false);
  const [live, setLive] = useState<Live | null>(null);
  /** Set by the skip button: the turn's playback jumps to the result. */
  const skip = useRef(false);
  /** Engine dry-run of the turn as it stands: what ending the turn now would do. */
  const [preview, setPreview] = useState<{ of: BattleState; score: TurnScore; bottleneck?: string; spend: Spend } | null>(null);
  useEffect(() => {
    if (state.phase !== 'player' || resolving) return;
    let stale = false;
    const t = setTimeout(() => {
      const plan = planTurn(CONTENT, state);
      // the dry run keeps its windows: each node's cost (autoscaled ones at their average size), and with tracing the bottleneck
      const run = compute.runDetailed(plan.input).then(({ summary, windows }) => {
        const top = tracing(CONTENT, state) ? hotNodes(plan.input.design, windows, 1)[0] : undefined;
        const spend = { costs: nodeCosts(plan.input.design, windows), egress: plan.egressPerHour ?? 0 };
        return { summary, spend, bottleneck: top && (top.down || top.rejected > 0 || top.util >= 0.8) ? top.node : undefined };
      });
      run
        .then(({ summary, bottleneck, spend }) => {
          if (!stale) setPreview({ of: state, score: scoreTurn(CONTENT, state, plan, summary), bottleneck, spend });
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [state, resolving]);
  const forecast = preview && preview.of === state && !resolving ? preview.score : null;
  const bottleneck = preview && preview.of === state && !resolving ? preview.bottleneck : undefined;
  const spend = preview && preview.of === state && !resolving ? preview.spend : undefined;

  const arenaRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const botRef = useRef<HTMLDivElement>(null);
  /** Drop zones: the whole system column and the enemy's body. */
  const systemZoneRef = useRef<HTMLDivElement>(null);
  const botZoneRef = useRef<HTMLDivElement>(null);
  const infraRef = useRef<HTMLDivElement>(null);
  const gateRef = useRef<HTMLDivElement>(null);
  const shieldRef = useRef<HTMLDivElement>(null);
  const hpRef = useRef<HTMLDivElement>(null);
  const usersRef = useRef<HTMLDivElement>(null);
  const opsRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const nodeEls = useRef<Record<string, HTMLDivElement | null>>({});
  /** Sockets of your system by id, and the modules in them by uid (socketed cards drop there). */
  const socketEls = useRef<Record<string, HTMLElement | null>>({});
  const modEls = useRef<Record<number, HTMLElement | null>>({});
  const infraRefs = useMemo<InfraRefs>(() => ({ nodes: nodeEls, sockets: socketEls, mods: modEls, gate: gateRef }), []);
  /** A role's node element (`api`, `db`, `ext`) in this fight's system. */
  const roleNode = (ref: 'api' | 'db' | 'ext') => nodeEls.current[alias(CONTENT, state, ref)] ?? null;
  /** Minion avatars by uid (bolts aimed at a minion land there). */
  const minionEls = useRef<Record<number, HTMLDivElement | null>>({});
  /** Where attacks land now: the targeted minion, or the enemy. */
  const aimEl = (s: BattleState) => {
    const m = targetOf(s);
    return (m && minionEls.current[m.uid]) || botRef.current;
  };

  /** Green bolts from your gateway into the bot. */
  /** Green bolts from your gateway into the bot (or a minion); `onLand` runs as they hit. */
  const counterFx = useCallback(async (damage: number, at?: HTMLElement | null, onLand?: () => void) => {
    const layer = fxRef.current;
    const bot = at ?? botRef.current;
    const source = shieldRef.current ?? gateRef.current;
    if (!layer || !bot || !source) {
      onLand?.();
      return;
    }
    const onMinion = bot !== botRef.current;
    await bolts(layer, anchor(source, layer), anchor(bot, layer, 0.5, 0.5), damage, () => {
      onLand?.();
      if (onMinion) minionHit(bot);
      else botHit(bot, tierRef.current);
      glow(bot, 'rgba(110,231,183,0.6)', 320);
    });
  }, []);

  /** The target under a screen point for a dragged card: minions and the enemy for attacks, your system for the rest. */
  const targetAt = useCallback(
    (x: number, y: number, def: CardDef): DropTarget | null => {
      const side = sidesOf(def);
      const inside = (el: Element | null | undefined, pad: number) => {
        const r = el?.getBoundingClientRect();
        return !!r && r.width > 0 && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
      };
      if (side.bot) {
        for (const m of minionsOf(state)) if (inside(minionEls.current[m.uid]?.parentElement, 6)) return { kind: 'minion', uid: m.uid };
        if (inside(botZoneRef.current, 0)) return { kind: 'bot' };
      }
      if (def.fits) {
        // a socketed card: onto a module it replaces, a socket with room, its own module (a level), or anywhere on the system when that is unambiguous
        const moves = placementsOf(CONTENT, state, def.id);
        const leveling = !!moduleOf(state, def.id);
        for (const m of moves) if (m.replace !== undefined && inside(modEls.current[m.replace], 3)) return { kind: 'socket', socket: m.socket, replace: m.replace };
        for (const m of moves) {
          if (m.replace !== undefined || !inside(socketEls.current[m.socket], 4)) continue;
          return { kind: 'socket', socket: m.socket };
        }
        // a full socket of one module: dropping on the socket replaces that module
        for (const m of moves) {
          if (m.replace === undefined || moves.filter((x) => x.socket === m.socket).length !== 1) continue;
          if (inside(socketEls.current[m.socket], 4)) return { kind: 'socket', socket: m.socket, replace: m.replace };
        }
        if ((leveling || moves.some((m) => m.replace === undefined)) && inside(systemZoneRef.current, 12)) return { kind: 'system' };
        return null;
      }
      if (side.system && !side.bot && inside(systemZoneRef.current, 12)) return { kind: 'system' };
      return null;
    },
    [state],
  );

  /** What a card touches in your system, and the label shown there. */
  const targetsOf = (def: CardDef, next: BattleState) => {
    const ids = nodeEls.current;
    const nodes = { api: roleNode('api'), db: roleNode('db'), ext: roleNode('ext'), cache: ids.cache ?? null, queue: ids.queue ?? null };
    const hits: { el: HTMLElement | null; label?: string }[] = [];
    // a socketed card lands in its socket (the module, once its node is drawn)
    const mod = def.fits ? moduleOf(next, def.id) : undefined;
    const home = mod ? (modEls.current[mod.uid] ?? socketEls.current[mod.socket] ?? null) : null;
    for (const e of def.effects) {
      switch (e.op) {
        case 'scale':
          hits.push({ el: (def.fits && home) || nodes[e.node], label: `+${e.n} instance${e.temp ? ' (lượt này)' : ''}` });
          break;
        case 'cache': {
          const cap = nodeOf(designOf(CONTENT, next), 'cache')?.config?.cache?.capacity ?? e.capacity;
          hits.push({ el: nodes.cache, label: `cache ${keysK(cap)} key` });
          break;
        }
        case 'cacheOpt':
          hits.push({ el: nodes.cache ?? nodes.db, label: e.swr ? 'stale-while-revalidate' : 'chuẩn hoá key' });
          break;
        case 'restart':
          hits.push({ el: nodes.api, label: 'restart: hết rò rỉ' });
          break;
        case 'edge': {
          const p = e.patch;
          const label = p.timeoutMs ? `timeout ${p.timeoutMs}ms` : p.retries ? `retry ×${p.retries} + backoff` : p.circuitBreaker ? 'circuit breaker' : 'policy';
          hits.push({ el: home ?? nodes.api, label });
          break;
        }
        case 'rateLimit':
          hits.push({ el: shieldRef.current, label: `rate limit −${Math.round(e.cut * 100)}% bot` });
          break;
        case 'waf':
          hits.push({ el: shieldRef.current, label: `WAF ${Math.round(next.waf * 100)}%` });
          break;
        case 'attack':
          hits.push({ el: shieldRef.current ?? gateRef.current });
          break;
        case 'headroom':
          hits.push({ el: infraRef.current, label: `+${e.n} headroom` });
          break;
        case 'hotfix':
          hits.push({ el: nodes.api, label: 'hotfix' }, { el: nodes.db });
          break;
        case 'autoscale':
          hits.push({ el: home ?? nodes.api, label: `autoscale +${e.extra} pod` });
          break;
        case 'queue':
          hits.push({ el: nodes.ext ?? nodes.api, label: 'hàng đợi' });
          break;
        case 'status':
          hits.push({ el: infraRef.current, label: `${statusDef(CONTENT, e.status).name} ${e.turns} lượt` });
          break;
        case 'cleanse':
          hits.push({ el: infraRef.current, label: e.n ? `gỡ ${e.n} debuff` : 'gỡ mọi debuff' });
          break;
        case 'draw':
          hits.push({ el: deckRef.current, label: `+${e.n} lá` });
          break;
        case 'ops':
          hits.push({ el: opsRef.current, label: `+${e.n} Ops` });
          break;
        case 'tune': {
          const m = e.mul;
          const label =
            m.latency !== undefined
              ? `latency ×${m.latency}`
              : m.concurrency !== undefined
                ? `kết nối ×${m.concurrency}`
                : m.queueSize !== undefined
                  ? `queue ×${m.queueSize}`
                  : 'tune';
          hits.push({ el: (def.fits && home) || nodes[e.node], label });
          break;
        }
        case 'purge':
          hits.push({ el: deckRef.current, label: 'dọn Tech Debt' });
          break;
      }
    }
    return hits.filter((h, i): h is { el: HTMLElement; label?: string } => !!h.el && hits.findIndex((k) => k.el === h.el) === i);
  };

  /** The played card's energy flies into the parts of the system it changes. */
  const cardFx = async (def: CardDef, at: { x: number; y: number }, next: BattleState) => {
    // wait for the new state to be laid out: a cache or shield may have just appeared
    await wait(150);
    const layer = fxRef.current;
    if (!layer) return;
    const l = layer.getBoundingClientRect();
    const from = { x: at.x - l.left, y: at.y - l.top };
    const color = TYPE_FX[def.type];
    await Promise.all(
      targetsOf(def, next).map(async (h, i) => {
        await wait(i * 110);
        const to = anchor(h.el, layer);
        await infuse(layer, from, to, color);
        absorb(h.el, color, h.el === infraRef.current ? 1.03 : 1.12);
        ring(layer, to, color, h.el === infraRef.current ? 160 : 70);
        if (h.label) floatText(layer, anchor(h.el, layer, 0.5, 0), h.label, color);
      }),
    );
  };

  /** Drawing ran the draw pile dry and the discard pile was shuffled back in. */
  const reshuffleFx = (prev: BattleState, next: BattleState) => {
    const layer = fxRef.current;
    const deck = deckRef.current;
    if (!layer || !deck || next.drawPile.length <= prev.drawPile.length) return;
    pulse(deck, 1.18, 420);
    floatText(layer, anchor(deck, layer, 0.5, 0), 'Xáo lại chồng bỏ', '#7dd3fc');
  };

  const play = (uid: number, at: { x: number; y: number } | undefined, target: DropTarget) => {
    if (resolving || state.phase !== 'player') return;
    const inst = state.hand.find((c) => c.uid === uid);
    // an attack dropped on a minion hits it; dropped on the enemy, it hits the enemy
    const aimedState = target.kind === 'minion' ? setTarget(state, target.uid) : target.kind === 'bot' ? setTarget(state, null) : state;
    // a socketed card goes into the socket it was dropped on (anywhere else: the first one with room)
    const next = playCard(CONTENT, aimedState, uid, target.kind === 'socket' ? { socket: target.socket, replace: target.replace } : {});
    if (!inst || next === aimedState) return;
    const def = cardDef(CONTENT, inst.id);
    const arena = arenaRef.current?.getBoundingClientRect();
    const pos = at ?? (arena ? { x: arena.left + arena.width / 2, y: arena.bottom - 320 } : { x: 0, y: 0 });
    setSplash({ key: Date.now(), def, x: pos.x, y: pos.y });
    const dmg = state.enemy.hp - next.enemy.hp;
    const minionHit = minionLoss(state, next);
    const aimed = aimEl(aimedState);
    // the enemy side keeps its HP until the bolts land
    const token = dmg > 0 || minionHit > 0 ? ++foeToken.current : 0;
    if (token) setFoe((f) => ({ ...(f ?? foeOf(state)), target: aimedState.target }));
    const land = (to: Partial<Foe> | null) => {
      if (token !== foeToken.current) return;
      setFoe((f) => (to && f ? { ...f, ...to } : null));
    };
    setState(next);
    reshuffleFx(state, next);
    // the system takes the card in first; an attack card then fires from it
    void cardFx(def, pos, next).then(async () => {
      if (minionHit > 0) {
        await counterFx(minionHit, aimed, () => {
          land(dmg > 0 ? { minions: minionsOf(next), target: next.target } : null);
          const layer = fxRef.current;
          if (layer && aimed) floatText(layer, anchor(aimed, layer, 0.5, 0), `−${minionHit}`, '#fb7185');
        });
      }
      if (dmg > 0) {
        await counterFx(dmg, botRef.current, () => {
          land(null);
          setFlash({ key: Date.now(), player: 0, enemy: dmg });
        });
      }
      if (next.phase === 'won') setDown(true);
    });
  };

  /** The request path inside your system, gateway first (Nginx → API → (Redis) → Postgres in a monolith). */
  const pathIds = () => pathOf(state);
  const pathPts = (layer: HTMLElement) =>
    pathIds()
      .map((id) => nodeEls.current[id])
      .filter((el): el is HTMLDivElement => !!el)
      .map((el) => anchor(el, layer));

  /** One burst of the bot's requests at the shield / gateway, plus your users' requests. */
  const botBurst = (plan: TurnPlan, ms: number) => {
    const layer = fxRef.current;
    const bot = botRef.current;
    const gate = gateRef.current;
    if (!layer || !bot || !gate) return;
    const from = anchor(bot, layer, 0.22, 0.55);
    const to = anchor(gate, layer, 0.92, 0.5);
    const stopX = shieldRef.current ? anchor(shieldRef.current, layer).x : undefined;
    void wave(layer, {
      from,
      to,
      count: clamp(Math.round(plan.botRps / 140), 4, 18),
      blocked: plan.botRps > 0 ? plan.botBlockedRps / plan.botRps : 0,
      stopX,
      kind: 'bot',
      window: ms,
      flight: 720,
      spreadFrom: 34,
      onHit: () => glow(gate, 'rgba(251,113,133,0.6)', 200),
    });
    // your real users stand around the bot: each request leaves from one of them
    const users = Array.from(usersRef.current?.querySelectorAll<HTMLElement>('[data-user]') ?? []);
    const n = clamp(Math.round(plan.legitRps / 120), 1, 4);
    for (let k = 0; k < n; k++) {
      const u = users[Math.floor(Math.random() * users.length)];
      void wave(layer, {
        from: u ? anchor(u, layer) : { x: from.x, y: -12 },
        to,
        count: 1,
        kind: 'user',
        window: ms,
        flight: 820,
        spreadFrom: 0,
        arc: 40,
        onHit: () => glow(gate, 'rgba(125,211,252,0.55)', 200),
      });
      if (u) pulse(u, 1.25, 220);
    }
  };

  /**
   * Phase 1, while the engine computes in the background: the bot winds up
   * and keeps attacking, requests run through the system. Lasts at least
   * `minMs` and until `isDone()`.
   */
  const attackPhase = async (plan: TurnPlan, isDone: () => boolean, minMs = 1300) => {
    const layer = fxRef.current;
    const bot = botRef.current;
    const minionAt = () => minionsOf(state).map((m) => ({ m, el: minionEls.current[m.uid] ?? null }));
    // calling minions first: rise and flare
    if (currentIntent(CONTENT, state).summon) {
      await botSummon(bot, tier);
      if (layer && bot) ring(layer, anchor(bot, layer), 'rgba(251,146,60,0.9)', 120);
    }
    // the strike, in this enemy's own style, with its minions jumping in one after another
    minionAt().forEach(({ m, el }, i) => setTimeout(() => minionStrike(el, m.id), 120 + i * 110));
    await botStrike(bot, state.enemy.id, tier);
    const t0 = performance.now();
    let beat = 0;
    while (!skip.current) {
      if (beat++ % 2 === 1) {
        botJab(bot, tier);
        const ms = minionAt();
        if (ms.length) {
          const { m, el } = ms[beat % ms.length];
          minionStrike(el, m.id);
        }
      }
      botBurst(plan, 700);
      if (layer) flow(layer, pathPts(layer), { count: 7, window: 700 });
      await wait(700);
      if (isDone() && performance.now() - t0 >= minMs) break;
    }
  };

  /**
   * Phase 2: the engine's windows played back. Each window updates the load
   * on every node, the live numbers in the middle and drains the Error Budget
   * (headroom first) and the bot's HP by its share of the turn's damage.
   */
  const replayPhase = async (plan: TurnPlan, windows: WindowMetrics[], r: TurnReport, start: BattleState, end: BattleState) => {
    const layer = fxRef.current;
    const ids = plan.input.design.nodes.map((n) => n.id);
    const n = windows.length;
    if (!n) return;
    const stepMs = clamp(Math.round(3600 / n), 140, 480);
    // where damage happens: failed requests and slow windows weigh most, cost spreads evenly
    const weight = windows.map((w) => w.errorCount + w.timeoutCount + (w.sloOk ? 0 : 20) + 1);
    const wsum = weight.reduce((a, b) => a + b, 0);
    // never below zero on screen: the rules clamp the final HP the same way
    const hpLoss = Math.min(r.damage.total, start.hp);
    const rawTotal = r.damage.absorbed + hpLoss;
    let cum = 0;
    let prev = { hp: start.hp, headroom: start.headroom };
    // the filtered traffic hits the target: a minion or the enemy, past its guards.
    // Its share of the damage shows as each window's bolts land.
    // the filtered traffic hits its target first (a minion, which may fall), then the enemy
    const enemyLoss = Math.max(0, start.enemy.hp - end.enemy.hp);
    const after = new Map(minionsOf(end).map((m) => [m.uid, m.hp]));
    const first = targetOf(start)?.uid;
    const segs: { key: number | 'enemy'; left: number }[] = [];
    if (end.phase !== 'won')
      for (const m of [...minionsOf(start)].sort((x, y) => Number(y.uid === first) - Number(x.uid === first))) {
        const lost = Math.max(0, m.hp - (after.get(m.uid) ?? 0));
        if (lost > 0) segs.push({ key: m.uid, left: lost });
      }
    if (enemyLoss > 0) segs.push({ key: 'enemy', left: enemyLoss });
    const total = segs.reduce((sum, x) => sum + x.left, 0);
    const fromFoe = foeOf(start);
    const toFoe = { ...foeOf(end), enemyHp: Math.min(start.enemy.hp, end.enemy.hp), minions: end.phase === 'won' ? fromFoe.minions : minionsOf(end) };
    const token = ++foeToken.current;
    setFoe(fromFoe);
    const landed = new Map<number | 'enemy', number>();
    let shownLoss = 0;
    const volleys: Promise<void>[] = [];
    for (let i = 0; i < n; i++) {
      if (skip.current) break;
      const w = windows[i];
      cum += weight[i];
      const raw = Math.round((rawTotal * cum) / wsum);
      const absorbed = Math.min(r.damage.absorbed, raw);
      const lost = Math.min(hpLoss, raw - absorbed);
      const cur = { hp: start.hp - lost, headroom: start.headroom - absorbed };
      const nodes: Record<string, NodeLoad> = {};
      w.nodes.forEach((nw, k) => {
        if (ids[k] && ids[k] !== 'client') nodes[ids[k]] = { util: nw.utilization, bad: nw.down || nw.rejected > 0 || nw.utilization > 0.95 };
      });
      const done = w.okCount + w.errorCount + w.timeoutCount;
      const errShare = done > 0 ? (w.errorCount + w.timeoutCount) / done : 0;
      setLive({ phase: 'replay', ...cur, tMs: w.tMs, rps: w.rps, p99: w.p99Ms, errRate: errShare, nodes });

      if (layer) {
        botBurst(plan, stepMs);
        // the request path, with this window's real outcomes
        const path = pathIds();
        const failing = path
          .map((id, k) => ({ k, nw: w.nodes[ids.indexOf(id)] }))
          .filter((x) => x.nw)
          .sort((a, b) => b.nw.rejected - a.nw.rejected || Number(b.nw.down) - Number(a.nw.down) || b.nw.utilization - a.nw.utilization)[0];
        const cacheAt = path.indexOf('cache');
        const hitRatio = cacheAt >= 0 ? (w.nodes[ids.indexOf('cache')]?.hitRatio ?? 0) : 0;
        flow(layer, pathPts(layer), {
          count: clamp(Math.round(w.rps / 70), 3, 12),
          window: stepMs,
          segMs: 200,
          errShare,
          errAt: failing?.k,
          hitShare: hitRatio * (1 - errShare),
          hitAt: cacheAt >= 0 ? cacheAt : undefined,
        });
        for (const id of path) if (nodes[id]?.bad) glow(nodeEls.current[id], 'rgba(244,63,94,0.7)', stepMs);

        const hpAt = hpRef.current ? anchor(hpRef.current, layer, 0.85, 0) : null;
        if (cur.headroom < prev.headroom && infraRef.current) {
          glow(infraRef.current, 'rgba(56,189,248,0.7)', 360);
          if (hpAt) floatText(layer, hpAt, `Headroom chặn ${prev.headroom - cur.headroom}`, '#7dd3fc');
        }
        if (cur.hp < prev.hp) {
          shake(infraRef.current, Math.min(8, 2 + prev.hp - cur.hp), 300);
          if (hpAt) floatText(layer, hpAt, `−${prev.hp - cur.hp}`, '#fb7185');
        }
      }
      // this window's share of the damage, in whole points, split across the targets in order
      let due = Math.floor((total * (i + 1)) / n) - shownLoss;
      shownLoss += Math.max(0, due);
      while (due > 0 && segs.length) {
        const seg = segs[0];
        const pts = Math.min(due, seg.left);
        seg.left -= pts;
        due -= pts;
        if (!seg.left) segs.shift();
        const key = seg.key;
        const onLand = () => {
          if (token !== foeToken.current) return;
          landed.set(key, (landed.get(key) ?? 0) + pts);
          setFoe(foeLanded(fromFoe, landed));
        };
        const at = key === 'enemy' ? botRef.current : minionEls.current[key] ?? botRef.current;
        if (layer) volleys.push(counterFx(pts, at, onLand));
        else onLand();
      }
      prev = cur;
      await wait(stepMs);
    }
    // the last bolts land before the result shows
    if (!skip.current) await Promise.all(volleys);
    if (token === foeToken.current) setFoe(toFoe);
    foeToken.current++;
    await wait(skip.current ? 0 : 450);
  };

  const endTurn = async () => {
    if (busy.current || state.phase !== 'player') return;
    busy.current = true;
    skip.current = false;
    setResolving(true);
    setError(null);
    setLive({ phase: 'attack', hp: state.hp, headroom: state.headroom, tMs: 0, rps: 0, p99: 0, errRate: 0, nodes: {} });
    // the hand goes to the discard pile first, so the arena is clear for the attack
    setDiscarding(true);
    let over = false;
    try {
      await wait(discardDuration(state.hand.length));
      const plan = planTurn(CONTENT, state);
      let done = false;
      // the engine runs in its worker while the attack plays
      const engine = compute.runDetailed(plan.input).finally(() => {
        done = true;
      });
      engine.catch(() => undefined); // awaited below; avoid an unhandled rejection meanwhile
      await attackPhase(plan, () => done);
      const { summary, windows } = await engine;
      const next = resolveTurn(CONTENT, state, plan, summary, hotNodes(plan.input.design, windows), nodeCosts(plan.input.design, windows));
      const r = next.reports.at(-1)!;
      await replayPhase(plan, windows, r, state, next);
      setFlash({ key: Date.now(), player: r.damage.total, enemy: Math.max(0, state.enemy.hp - next.enemy.hp) });
      setFoe(null);
      setState(next);
      reshuffleFx(state, next);
      if (next.phase === 'won') setDown(true);
      // a finished fight keeps its last hand in the rules: leave it in the pile on screen
      over = next.phase === 'won' || next.phase === 'lost';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busy.current = false;
      foeToken.current++;
      setFoe(null);
      setLive(null);
      setResolving(false);
      if (!over) setDiscarding(false);
    }
  };

  // no gameplay hotkeys (they were too easy to hit by accident); Escape only closes panels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setShowLibrary(false);
      setShowLog(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // an open log counts as read
  useEffect(() => {
    if (showLog) setSeenReports(state.reports.length);
  }, [showLog, state.reports.length]);
  const unseen = showLog ? 0 : state.reports.length - seenReports;

  const intent = currentIntent(CONTENT, state);

  // while a card is dragged, its possible targets light up and the other side dims
  const sides = dragDef ? sidesOf(dragDef) : { system: false, bot: false };
  const canSystem = sides.system && !sides.bot;
  const anyTarget = canSystem || sides.bot;
  const targetRing = (on: boolean) => (anyTarget && !on ? 'opacity-40' : '');
  /** The enemy side as drawn: lags the rules until attacks land. */
  const shown: BattleState = foe ? { ...state, enemy: { ...state.enemy, hp: foe.enemyHp }, minions: foe.minions, target: foe.target } : state;
  const aiming: Aiming | null = sides.bot ? { over: dragOver, card: dragDef?.name ?? '' } : null;
  const plug: Plug | null = dragDef?.fits ? { def: dragDef, moves: placementsOf(CONTENT, state, dragDef.id), over: dragOver } : null;
  const enemy = CONTENT.enemies.find((e) => e.id === state.enemy.id)!;
  const over = state.phase === 'won' || state.phase === 'lost';
  const hand = state.hand.map((inst) => ({
    uid: inst.uid,
    def: cardDef(CONTENT, inst.id),
    playable: canPlay(CONTENT, state, inst.uid) && !resolving,
    // a socketed card the system has no socket for
    blocked: cardDef(CONTENT, inst.id).fits && !placementsOf(CONTENT, state, inst.id).length ? 'Hệ thống không có ổ hợp lệ' : (riskBlock(state, cardDef(CONTENT, inst.id)) ?? undefined),
  }));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-clip">
      <NetBackdrop />
      {/* top bar */}
      <div className="relative z-30 flex items-center gap-3 px-4 py-2 text-sm">
        <Button size="sm" variant="ghost" asChild>
          <Link to="/play">
            <ArrowLeft /> Thoát
          </Link>
        </Button>
        <span className="font-semibold">{title}</span>
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">Prototype</span>
        <span className="text-muted-foreground">Lượt {state.turn}</span>
        {progress}
        <RelicBar relics={CONTENT.relics} ids={state.relics} fired={state.relicFired} />
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant={showLog ? 'secondary' : 'ghost'} className="relative" aria-expanded={showLog} onClick={() => setShowLog((v) => !v)}>
            <ScrollText /> Nhật ký
            {unseen > 0 && (
              <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-amber-400 font-mono text-[10px] font-bold text-black">{unseen}</span>
            )}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowLibrary(true)}>
            <LibraryBig /> Thư viện
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowRules((v) => !v)}>
            <Info /> Luật chơi
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (window.confirm('Bỏ ca trực này và bắt đầu ca mới? Tiến độ hiện tại sẽ mất.')) onAbandon();
            }}
          >
            <RotateCcw /> Ca mới
          </Button>
        </div>
      </div>

      {showRules && <RulesPanel onClose={() => setShowRules(false)} />}
      <div ref={arenaRef} className="relative min-h-0 flex-1">
        {/* the two sides face each other across the arena; equal side columns
            keep the middle on the exact center. Each side is its panel with its
            health bar under it. Padding: 200px below for the hand, 152px above
            (200 minus the 48px top bar) puts the row on the screen's vertical center. */}
        <div className="absolute inset-0 grid grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 overflow-y-auto px-6 pb-[200px] pt-[152px] [align-content:safe_center]">
          <div className="col-start-1 row-start-1 flex min-w-0 flex-col items-start">
            <div ref={systemZoneRef} className={cn('relative flex w-full max-w-[460px] flex-col items-center gap-3 transition-opacity duration-200', targetRing(canSystem))}>
              {canSystem && <SystemTarget over={dragOver?.kind === 'system'} text={dragDef?.fits ? (moduleOf(state, dragDef.id) ? `Thả để nâng cấp ${dragDef.name}` : 'Thả để lắp vào ổ trống') : undefined} />}
              <div className="w-full">
                <SystemPanel state={state} hp={live?.hp ?? state.hp} loads={live?.nodes} panelRef={infraRef} refs={infraRefs} plug={plug} shieldRef={shieldRef} hit={resolving} bottleneck={bottleneck} spend={spend} />
              </div>
                <HpBar
                  hpRef={hpRef}
                  icon={<Heart />}
                  label="Error Budget"
                  freeze={deployFrozen({ hp: live?.hp ?? state.hp, maxHp: state.maxHp })}
                  hp={live?.hp ?? state.hp}
                  max={state.maxHp}
                  headroom={live?.headroom ?? state.headroom}
                  flash={flash}
                  pop={flash?.player ?? 0}
                  barClass="from-rose-600 to-rose-400"
                />
                <StatusRow state={state} />
            </div>
          </div>

          <div className="col-start-2 row-start-1 flex min-w-0 flex-col items-center justify-center">
            <span className="select-none font-black italic tracking-tighter text-foreground/10 [font-size:64px]">VS</span>
          </div>

          <div className="col-start-3 row-start-1 flex min-w-0 flex-col items-end">
            <div className={cn('relative flex w-full max-w-[300px] flex-col items-center gap-3 transition-opacity duration-200', targetRing(sides.bot))}>
              <BotSide
                state={shown}
                enemyHp={shown.enemy.hp}
                intents={intentsNow(CONTENT, state)}
                intent={intent}
                rank={rank}
                mini={tier === 'mini'}
                defeated={down}
                botRef={botRef}
                usersRef={usersRef}
                attacking={resolving}
                aiming={aiming}
                botZoneRef={botZoneRef}
                minions={<MinionRow state={shown} minionEls={minionEls} aiming={aiming} onAim={resolving || over ? undefined : (uid) => setState((s) => setTarget(s, uid))} />}
                onAim={resolving ? undefined : () => setState((s) => setTarget(s, null))}
              />
                <HpBar
                  icon={<Skull />}
                  label={enemy.name}
                  title={enemy.description}
                  hp={shown.enemy.hp}
                  max={state.enemy.maxHp}
                  flash={flash}
                  pop={flash?.enemy ?? 0}
                  barClass="from-rose-600 to-orange-500"
                />
            </div>
          </div>

          {error && (
            <div className="col-start-1 row-start-2 flex min-w-0 flex-col items-start">
              <div className="w-full max-w-[460px] rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>
            </div>
          )}
        </div>

        <div ref={fxRef} className="pointer-events-none absolute inset-0 z-[15] overflow-hidden" />

        {/* bottom corners: resources and the end-turn button, either side of the hand */}
        <div className="absolute bottom-4 left-6 z-30 flex flex-col gap-1.5 text-xs text-muted-foreground">
          <div ref={opsRef} className="w-fit rounded-full">
            <OpsPips ops={state.ops} max={CONTENT.battle.opsPerTurn} />
          </div>
          <div className="flex items-end gap-3">
            <Pile pileRef={deckRef} count={state.drawPile.length} label="Chồng rút" tone="draw" />
            {state.exhausted.length > 0 && <span className="pb-0.5">Tiêu hao {state.exhausted.length}</span>}
          </div>
          <span className="hidden lg:inline">Kéo bài vào hệ thống, bot hoặc lính để đánh</span>
        </div>
        <div className="absolute bottom-4 right-6 z-30 flex items-end gap-4">
          <Pile pileRef={discardRef} count={state.discard.length + (discarding ? state.hand.length : 0)} label="Chồng bỏ" tone="discard" />
          {/* fixed width: the pile must not move when the button's label changes */}
          <div className="relative flex w-[168px] justify-end pb-2">
            {state.phase === 'player' && !resolving && <Forecast score={forecast} />}
            {resolving ? (
              // while the turn plays, the same spot skips to the result
              <Button size="lg" variant="secondary" className="h-12 rounded-full px-6 shadow-lg shadow-black/40" onClick={() => (skip.current = true)}>
                <LoaderCircle className="animate-spin" />
                Bỏ qua
              </Button>
            ) : (
              <Button size="lg" className="h-12 rounded-full px-6 shadow-lg shadow-black/40" disabled={state.phase !== 'player'} onClick={() => void endTurn()}>
                <ArrowRight />
                Kết thúc lượt
              </Button>
            )}
          </div>
        </div>

        <LogDrawer open={showLog} reports={state.reports} onClose={() => setShowLog(false)} />

        <Hand cards={hand} targetAt={targetAt} onPlay={play} onDragChange={onDragChange} deckRef={deckRef} discardRef={discardRef} discarding={discarding} />
        {hand.length === 0 && !over && !resolving && (
          <p className="absolute bottom-10 left-1/2 z-20 -translate-x-1/2 text-sm text-muted-foreground">Hết bài trên tay. Kết thúc lượt.</p>
        )}
      </div>

      {splash && <PlayedSplash key={splash.key} def={splash.def} x={splash.x} y={splash.y} onDone={() => setSplash(null)} />}

      {showLibrary && <CardLibrary cards={CONTENT.cards} deck={deck} onClose={() => setShowLibrary(false)} />}

      {over && (state.phase === 'lost' || endReady) && <EndScreen state={state} deck={deck} enemyName={enemy.name} seed={seed} continueLabel={continueLabel} onLog={() => setShowLog(true)} onContinue={() => onFinish(state)} />}
    </div>
  );
}
// ---------------------------------------------------------------- pieces

/** Which side a card acts on: attacks hit the bot, everything else changes your system. */
function sidesOf(def: CardDef) {
  if (def.unplayable) return { system: false, bot: false };
  return { bot: def.effects.some((e) => e.op === 'attack'), system: def.effects.some((e) => e.op !== 'attack') };
}

/** What an attack card being dragged can hit, and what is under the pointer. */
type Aiming = { over: DropTarget | null; card: string };

/** The ring around a round target (the enemy, a minion) while an attack is dragged: faint when it can be hit, bright under the pointer. */
function AimRing({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute z-10 rounded-full border-2 transition-[border-color,box-shadow,transform] duration-150',
        on ? 'scale-105 border-rose-400 shadow-[0_0_28px_rgba(251,113,133,0.55)]' : 'border-dashed border-rose-400/40',
        className,
      )}
    />
  );
}

/** Your system lit up as the target of a dragged card. */
function SystemTarget({ over, text = 'Thả để áp dụng lên hệ thống' }: { over: boolean; text?: string }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute -inset-3 z-20 rounded-[24px] border-2 transition-[background-color,border-color,box-shadow] duration-150',
        over ? 'border-sky-400/90 bg-sky-500/[0.07] shadow-[0_0_48px_rgba(56,189,248,0.35)]' : 'border-dashed border-sky-400/40',
      )}
    >
      {over && <DropTag tone="system" text={text} className="top-0 -translate-y-1/2" />}
    </div>
  );
}

/** Where your real users stand around the bot: an ellipse, mostly to its sides. */
const USER_SPOTS = [150, 180, 210, 330, 0, 30].map((deg, i) => {
  const t = (deg * Math.PI) / 180;
  return { x: Math.round(Math.cos(t) * 122), y: Math.round(Math.sin(t) * 78), delay: i * 0.45 };
});

/**
 * Your real users, mingling around the bot: their requests reach your
 * gateway the same way the bot's do, so they share its side of the arena.
 * Each one drifts gently; the request animation leaves from one of them.
 */
function UserRing({ usersRef }: { usersRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={usersRef} aria-hidden className="pointer-events-none absolute inset-0">
      <style>{`@keyframes user-drift { 0%, 100% { translate: 0 0; } 50% { translate: 0 -5px; } } @media (prefers-reduced-motion: reduce) { [data-user] { animation: none !important; } }`}</style>
      {USER_SPOTS.map((p, i) => (
        <span
          key={i}
          data-user
          className="absolute -ml-3.5 -mt-3.5 flex size-7 items-center justify-center rounded-full border border-sky-400/40 bg-sky-950/80 text-sky-200 shadow-[0_0_10px_rgba(56,189,248,0.25)]"
          style={{ left: `calc(50% + ${p.x}px)`, top: `calc(50% + ${p.y}px)`, animation: `user-drift 3s ease-in-out ${p.delay}s infinite` }}
        >
          <User className="size-4" />
        </span>
      ))}
    </div>
  );
}

/** A played card flares up where it was dropped and fades into the arena. */
function PlayedSplash({ def, x, y, onDone }: { def: CardDef; x: number; y: number; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const anim = el.animate(
      [
        { transform: 'scale(1.08)', opacity: 1, filter: 'brightness(1.4)' },
        { transform: 'scale(1.15)', opacity: 1, filter: 'brightness(1.1)', offset: 0.35 },
        { transform: 'scale(0.6) translateY(-40px)', opacity: 0, filter: 'brightness(1)' },
      ],
      { duration: 650, easing: 'ease-out', fill: 'forwards' },
    );
    anim.onfinish = () => done.current();
    return () => anim.cancel();
  }, []);
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed z-50"
      style={{ left: x - CARD_SIZE.w / 2, top: y - CARD_SIZE.h / 2, width: CARD_SIZE.w, height: CARD_SIZE.h }}
    >
      <CardFace def={def} playable glowing />
    </div>
  );
}

/**
 * A side's health, compact: the bar with its numbers in the middle and the
 * name centered under it. Both sides use it on one row under the arena.
 */
function HpBar({
  hpRef,
  className,
  icon,
  label,
  title,
  hp,
  max,
  headroom = 0,
  freeze,
  flash,
  pop,
  barClass,
}: {
  hpRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
  icon: ReactNode;
  label: string;
  title?: string;
  hp: number;
  max: number;
  headroom?: number;
  /** The player's bar: a deploy freeze is on. */
  freeze?: boolean;
  flash: Flash | null;
  pop: number;
  barClass: string;
}) {
  return (
    <div ref={hpRef} className={cn('relative w-full max-w-[220px]', className)}>
      <DamagePop flash={flash} value={pop} side={label} />
      {/* a thin bar, the numbers outlined and raised over its middle */}
      <div className="relative flex h-8 items-center">
        <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', headroom > 0 && 'shadow-[0_0_0_2px_rgba(56,189,248,0.5)]')}>
          <div className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-500', barClass)} style={{ width: `${Math.max(0, hp / max) * 100}%` }} />
        </div>
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-xl font-black leading-none tabular-nums text-white [-webkit-text-stroke:3px_rgba(0,0,0,0.9)] [paint-order:stroke_fill] [text-shadow:0_2px_6px_rgba(0,0,0,0.9)]">
          {hp}
          <span className="text-sm font-bold text-white/80">/{max}</span>
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-rose-400">
        {icon}
        <span className="truncate" title={title}>
          {label}
        </span>
        {freeze && (
          <span className="flex items-center gap-0.5 rounded-full bg-cyan-500/15 px-1.5 text-[10px] text-cyan-200" title={`Dưới ${Math.round(FREEZE_AT * 100)}% Error Budget: không được deploy liều, mỗi lượt hồi 1.`}>
            <Snowflake className="size-3" /> Đóng băng deploy
          </span>
        )}
        {headroom > 0 && (
          <span className="flex items-center gap-0.5 rounded-full bg-sky-500/15 px-1.5 text-[10px] text-sky-300" title="Headroom: hấp thụ sát thương trước khi trừ Error Budget">
            <Shield className="size-3" /> {headroom}
          </span>
        )}
      </div>
    </div>
  );
}

function DamagePop({ flash, value, side }: { flash: { key: number } | null; value: number; side: string }) {
  if (!flash || value <= 0) return null;
  return (
    <span
      key={`${flash.key}-${side}`}
      className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 animate-out fade-out slide-out-to-top-6 fill-mode-forwards text-3xl font-black text-rose-400 drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)] duration-[1400ms]"
    >
      −{value}
    </span>
  );
}

/**
 * Your whole system as one object facing the bot: a framed unit with its
 * Error Budget on top and the request path inside. Headroom wraps it in a
 * blue barrier, the WAF / rate-limit shield stands in front of its gateway.
 */
function SystemPanel({
  state,
  hp,
  loads,
  panelRef,
  refs,
  plug,
  shieldRef,
  hit,
  bottleneck,
  spend,
}: {
  state: BattleState;
  /** Error Budget shown (live while a turn plays). */
  hp: number;
  loads?: Record<string, NodeLoad>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  refs: InfraRefs;
  plug: Plug | null;
  shieldRef: React.RefObject<HTMLDivElement | null>;
  hit: boolean;
  /** Tracing: the node the forecast says will saturate. */
  bottleneck?: string;
  /** The forecast's bill: each node's $/h and egress (absent while it runs). */
  spend?: Spend;
}) {
  const [costsOpen, setCostsOpen] = useState(false);
  const costs = spend?.costs ?? nodeCosts(planDesign(state));
  const egress = spend?.egress ?? 0;
  const cost = spend ? costs.reduce((s, c) => s + c.costPerHour, 0) + egress : costOf(designOf(CONTENT, state), state.temp);
  const spot = spotOf(CONTENT, state);
  const budget = budgetOf(CONTENT, state);
  const ratio = hp / state.maxHp;
  const status = ratio > 0.5 ? 'ok' : ratio > 0.25 ? 'warn' : 'crit';
  const shields = [state.waf > 0 ? `WAF ${Math.round(state.waf * 100)}%` : null, state.temp.botCut > 0 ? `rate limit ${Math.round(state.temp.botCut * 100)}%` : null].filter(
    Boolean,
  ) as string[];
  return (
    <div className="relative">
      <div
        ref={panelRef}
        className={cn(
          'relative rounded-3xl border-2 bg-[linear-gradient(160deg,rgba(14,165,233,0.10),rgba(9,9,11,0.55)_55%)] p-4 shadow-2xl shadow-black/50 backdrop-blur transition-[border-color,box-shadow] duration-300 sm:p-5',
          status === 'ok' ? 'border-sky-500/35' : status === 'warn' ? 'border-amber-500/45' : 'animate-pulse border-rose-500/60',
          state.headroom > 0 && 'shadow-[0_0_0_4px_rgba(56,189,248,0.25),0_0_36px_6px_rgba(56,189,248,0.3)]',
          hit && 'border-sky-400/60',
        )}
      >
        {/* faint grid: a rack, not a card */}
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:18px_18px]" />

        <div className="relative">
          <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
            <span className="flex gap-1">
              {(['ok', 'warn', 'crit'] as const).map((s) => (
                <span
                  key={s}
                  className={cn(
                    'size-2 rounded-full',
                    s !== status
                      ? 'bg-muted-foreground/25'
                      : s === 'ok'
                        ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]'
                        : s === 'warn'
                          ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]'
                          : 'animate-pulse bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.9)]',
                  )}
                />
              ))}
            </span>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Hệ thống của bạn</span>
            {state.migrating && (
              <span
                className="rounded-full border border-sky-400/50 bg-sky-500/10 px-1.5 text-[10px] text-sky-200"
                title={`Đang di trú sang ${chassisDef(CONTENT, state.migrating).name}: có thêm ổ của hệ mới, nhưng API chậm ×${MIGRATION.apiLatency} và chi phí ×${MIGRATION.cost}.`}
              >
                → {chassisDef(CONTENT, state.migrating).name}
              </span>
            )}
            {spot.n > 0 && (
              <span
                className={cn('flex items-center gap-0.5 rounded-full border px-1.5 text-[10px]', state.spotEvicted ? 'border-rose-400/50 bg-rose-500/10 text-rose-200' : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200')}
                title={state.spotEvicted ? `Nhà cung cấp đã thu hồi ${spot.n} instance Spot: lượt này không có chúng.` : `${spot.n} instance Spot giá rẻ; mỗi lượt có ${Math.round(spot.evict * 100)}% bị thu hồi.`}
              >
                <Dices className="size-3" /> Spot {state.spotEvicted ? 'bị thu hồi' : `+${spot.n}`}
              </span>
            )}
            <button
              type="button"
              onClick={() => setCostsOpen((o) => !o)}
              aria-expanded={costsOpen}
              title="Chi phí theo từng node"
              className={cn('ml-auto flex items-center gap-1 rounded-md px-1 font-mono text-xs hover:bg-muted/40', cost > budget + 0.001 ? 'text-rose-400' : 'text-muted-foreground', costsOpen && 'bg-muted/40')}
            >
              {egress > 0 && <CloudDownload className="size-3.5 text-rose-300" />}
              <Wallet className="size-3.5" /> ${cost.toFixed(2)}/${budget.toFixed(2)}/h
            </button>
          </div>
          {costsOpen && (
            <div className="absolute right-0 top-7 z-30 w-72 rounded-lg border bg-background/95 p-3 shadow-xl backdrop-blur">
              <div className="mb-2 flex items-center justify-between text-xs font-medium">
                <span>Tiền đi đâu (lượt này)</span>
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setCostsOpen(false)} aria-label="Đóng">
                  ×
                </button>
              </div>
              <CostBreakdown costs={costs} egress={egress} budget={budget} />
              {!spend && <p className="mt-1 text-[10px] text-muted-foreground">Đang chạy thử: chưa có số đo công suất.</p>}
              {state.reports.length > 0 && <BillLine state={state} className="mt-2 border-t pt-2" />}
            </div>
          )}
          <InfraLine state={state} loads={loads} refs={refs} plug={plug} bottleneck={bottleneck} />
        </div>
      </div>

      {/* the shield stands outside the system, between it and the bot; it
          floats so the frame keeps the same width with or without it */}
      <div className="absolute inset-y-0 -right-6 flex w-6 items-center justify-center">
        {shields.length > 0 && (
          <>
            <div ref={shieldRef} className="h-3/4 w-1.5 rounded-full bg-emerald-400/80 shadow-[0_0_16px_4px_rgba(52,211,153,0.45)]" />
            <span className="absolute left-[calc(50%+7px)] top-1/2 -translate-y-1/2 rotate-180 whitespace-nowrap rounded [writing-mode:vertical-rl] bg-emerald-500/15 px-1 text-[10px] text-emerald-300">
              {shields.join(' · ')}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function OpsPips({ ops, max }: { ops: number; max: number }) {
  return (
    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
      Ops
      {Array.from({ length: Math.max(ops, max) }, (_, i) => (
        <span
          key={i}
          className={cn('size-4 rounded-full border', i < ops ? 'border-amber-300 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]' : 'border-muted-foreground/40')}
        />
      ))}
      <span className="font-mono text-xs text-muted-foreground">
        {ops}/{max}
      </span>
    </span>
  );
}

/** What an intent does beyond raw traffic, as icon chips. */
/** `lasting`: not an incident, so Hotfix does not cancel it. */
type IntentEffect = { icon: typeof Zap; text: string; tone: 'bad' | 'warn' | 'heal'; lasting?: boolean };

/** 1000 → "1k". */

function intentEffects(intent: Intent, state?: BattleState): IntentEffect[] {
  const out: IntentEffect[] = [];
  const node = (n: string) => (n === 'db' ? 'DB' : n === 'ext' ? 'Đối tác' : 'API');
  if (intent.chaos)
    out.push(
      intent.chaos.action === 'latency'
        ? { icon: Turtle, text: `${node(intent.chaos.node)} chậm ×${intent.chaos.value}`, tone: 'bad' }
        : { icon: TriangleAlert, text: `${node(intent.chaos.node)} lỗi ${Math.round(intent.chaos.value * 100)}%`, tone: 'bad' },
    );
  if (intent.clientRetries) out.push({ icon: Repeat, text: `retry ×${intent.clientRetries}`, tone: 'bad' });
  if (intent.cacheBust) out.push({ icon: ZapOff, text: `phá cache ${Math.round(intent.cacheBust * 100)}%`, tone: 'warn' });
  if (intent.cacheTtlMs) out.push({ icon: Hourglass, text: `cache TTL ${intent.cacheTtlMs / 1000}s`, tone: 'warn' });
  if (intent.squeeze) out.push({ icon: Unplug, text: `${node(intent.squeeze.node)} chỉ còn ${Math.round(intent.squeeze.concurrency * 100)}% slot`, tone: 'bad' });
  if (intent.leak) {
    const total = state ? leakNow(state, intent) : intent.leak;
    out.push({ icon: Turtle, text: `rò rỉ +${intent.leak}: API chậm ×${(1 + total).toFixed(1)}`, tone: 'bad', lasting: true });
  }
  if (intent.leakReset) out.push({ icon: RotateCcw, text: 'pod tự restart: hết rò rỉ', tone: 'heal' });
  if (intent.costSpike) out.push({ icon: Wallet, text: `chi phí API ×${intent.costSpike}`, tone: 'bad', lasting: true });
  if (intent.egress) out.push({ icon: CloudDownload, text: `egress $${intent.egress.toFixed(2)}/h mỗi 1k rps bot lọt`, tone: 'bad' });
  if (intent.bandwidth) out.push({ icon: Network, text: `phản hồi ${intent.bandwidth.responseKb}KB, đường truyền ${intent.bandwidth.mbps}Mbps`, tone: 'bad', lasting: true });
  if (intent.addCards) out.push({ icon: Bug, text: `+${intent.addCards.n} thẻ nợ`, tone: 'warn', lasting: true });
  if (intent.bypass) out.push({ icon: EyeOff, text: `lách ${Math.round(intent.bypass * 100)}% bộ lọc`, tone: 'bad', lasting: true });
  if (intent.wafStrip) out.push({ icon: ShieldOff, text: `WAF −${Math.round(intent.wafStrip * 100)}%`, tone: 'warn', lasting: true });
  if (intent.drainOps) out.push({ icon: Unplug, text: `lượt sau −${intent.drainOps} Ops`, tone: 'warn', lasting: true });
  if (intent.summon) out.push({ icon: UserPlus, text: `gọi ${intent.summon.n} ${minionDef(CONTENT, intent.summon.minion).name}`, tone: 'warn', lasting: true });
  if (intent.burst) out.push({ icon: Zap, text: `dồn ×${intent.burst.mul} trong ${intent.burst.ms / 1000}s`, tone: 'bad', lasting: true });
  if (intent.heal) out.push({ icon: HeartPulse, text: `hồi ${intent.heal} máu`, tone: 'heal' });
  for (const x of intent.inflict ?? []) out.push({ icon: statusIcon(x.status), text: `${statusDef(CONTENT, x.status).name} ${x.turns} lượt tới`, tone: 'bad', lasting: true });
  return out;
}

/** Timed effects in play: buffs green, debuffs red, turns left on each (stacks when more than one). */
function StatusRow({ state }: { state: BattleState }) {
  const list = state.statuses ?? [];
  const combos = activeCombos(CONTENT, state);
  if (!list.length && !combos.length) return null;
  return (
    <div className="flex flex-wrap justify-center gap-1.5 text-[11px]" aria-label="Hiệu ứng theo lượt">
      {combos.map((c) => (
        <span key={c.id} title={`Combo ${c.name}: ${c.text}`} className="flex items-center gap-1 rounded-full border border-amber-400/60 bg-amber-500/15 px-2 py-0.5 text-amber-200">
          <Sparkles className="size-3" /> {c.name}
        </span>
      ))}
      {list.map((x) => {
        const def = statusDef(CONTENT, x.id);
        const Icon = statusIcon(x.id);
        const buff = def.kind === 'buff';
        return (
          <span
            key={x.id}
            title={`${def.name}${x.stacks > 1 ? ` ×${x.stacks}` : ''}: ${def.text} Còn ${x.turns} lượt${buff ? '' : ' (Rollback gỡ được)'}.`}
            className={cn(
              'flex items-center gap-1 rounded-full border px-2 py-0.5',
              buff ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200' : 'border-rose-400/50 bg-rose-500/15 text-rose-200',
            )}
          >
            <Icon className="size-3" /> {def.name}
            {x.stacks > 1 && <span className="font-mono font-bold">×{x.stacks}</span>}
            <span className="rounded-full bg-black/30 px-1 font-mono">{x.turns}</span>
          </span>
        );
      })}
    </div>
  );
}

/** The botnet's intent cycle: done (dim), now (lit), coming (outlined). Weighted enemies: the pool, this turn's lit. */
/** What observability shows of the attacker's next turns (exact for a fixed cycle, odds for a random enemy). */
function Foresight({ state }: { state: BattleState }) {
  const turns = upcomingIntents(CONTENT, state, foresightOf(CONTENT, state));
  if (!turns.length) return null;
  return (
    <div className="w-full rounded-lg border border-sky-400/40 bg-sky-500/10 px-2 py-1.5 text-[11px]" title="Từ module Quan sát. Dự đoán theo build hiện tại: đổi build thì botnet có thể đổi chiêu.">
      {turns.map((opts, k) => (
        <div key={k} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="shrink-0 font-semibold text-sky-200">{k === 0 ? 'Lượt sau' : `${k + 1} lượt nữa`}:</span>
          {opts.slice(0, 3).map(({ intent, chance }) => {
            const I = INTENT_ICON[intent.icon];
            return (
              <span key={intent.id} className="flex items-center gap-1 text-sky-100">
                <I className="size-3.5 text-sky-300" />
                {intent.label}
                <span className="font-mono text-sky-300/80">~{n0(intent.botRps)} rps</span>
                {chance < 1 && <span className="font-mono text-amber-200">{Math.round(chance * 100)}%</span>}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function IntentTrack({ intents, step, pick }: { intents: Intent[]; step: number; pick?: number }) {
  const n = intents.length;
  const weighted = pick !== undefined;
  const at = weighted ? pick : step % n;
  return (
    <div className="flex items-center justify-center gap-1" aria-label="Chu kỳ ý định của botnet">
      {intents.map((it, i) => {
        const I = INTENT_ICON[it.icon];
        const now = i === at;
        const past = !weighted && i < at;
        return (
          <span
            key={it.id}
            title={`${now ? 'Lượt này' : weighted ? 'Có thể xảy ra' : i === (at + 1) % n ? 'Lượt sau' : past ? 'Đã qua' : 'Sắp tới'}: ${it.label}`}
            className={cn(
              'flex size-8 items-center justify-center rounded-full border transition-colors [&_svg]:size-4.5',
              now
                ? 'border-amber-400 bg-amber-400/20 text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.5)]'
                : past
                  ? 'border-transparent text-muted-foreground/35'
                  : 'border-muted-foreground/40 text-muted-foreground',
            )}
          >
            <I />
          </span>
        );
      })}
      {weighted && <span className="ml-1 text-[10px] text-muted-foreground">ngẫu nhiên</span>}
      {step >= n && <span className="ml-1 font-mono text-xs text-rose-300">vòng {Math.floor(step / n) + 1}</span>}
    </div>
  );
}

/** An enemy's passive (bosses, some elites), a boss's phase and its minions' guard, as small badges under its intents. */
function BossTraits({ state }: { state: BattleState }) {
  const def = CONTENT.enemies.find((e) => e.id === state.enemy.id);
  const guard = guardNow(CONTENT, state);
  if (!def || (!def.passive && !def.phase2 && !guard)) return null;
  const phase2 = state.enemy.phase === 2;
  return (
    <div className="flex flex-wrap justify-center gap-1.5 text-[11px]">
      {guard > 0 && (
        <span className="flex items-center gap-1 rounded-full border border-sky-400/50 bg-sky-500/15 px-2 py-0.5 text-sky-200" title="Lính đang che chắn: hạ chúng để đánh trúng đủ sát thương">
          <Shield className="size-3" /> Được che −{Math.round(guard * 100)}% sát thương
        </span>
      )}
      {def.passive && (
        <span className="rounded-full border border-violet-400/50 bg-violet-500/15 px-2 py-0.5 text-violet-200" title={def.passive.text}>
          Nội tại: {def.passive.label}
        </span>
      )}
      {def.phase2 && (
        <span
          className={cn('rounded-full border px-2 py-0.5', phase2 ? 'border-rose-400/60 bg-rose-500/20 text-rose-200' : 'border-border text-muted-foreground')}
          title={def.phase2.text}
        >
          {phase2 ? `Pha 2: ${def.phase2.label}` : `Pha 2 khi còn ${Math.round(def.phase2.at * 100)}% máu`}
        </span>
      )}
    </div>
  );
}

function BotSide({
  state,
  enemyHp,
  intents,
  intent,
  rank,
  mini,
  defeated,
  botRef,
  usersRef,
  attacking,
  aiming,
  botZoneRef,
  minions,
  onAim,
}: {
  state: BattleState;
  enemyHp: number;
  intents: Intent[];
  intent: Intent;
  rank?: BotRank;
  mini?: boolean;
  defeated?: boolean;
  botRef: React.RefObject<HTMLDivElement | null>;
  usersRef: React.RefObject<HTMLDivElement | null>;
  attacking: boolean;
  /** An attack card is being dragged: the enemy and its minions can be hit. */
  aiming: Aiming | null;
  botZoneRef: React.RefObject<HTMLDivElement | null>;
  /** The minions, drawn beside the enemy and lower. */
  minions: ReactNode;
  /** With minions on the field: aim the filtered traffic back at the enemy. */
  onAim?: () => void;
}) {
  const Icon = INTENT_ICON[intent.icon];
  const raw = botRpsNow(CONTENT, state);
  const fromMinions = minionRpsNow(CONTENT, state);
  const hasMinions = minionsOf(state).length > 0;
  const aimed = hasMinions && !targetOf(state);
  const cut = botCutNow(CONTENT, state, bypassNow(CONTENT, state));
  const effects = intentEffects(intent, state);
  const adapt = CONTENT.battle.adapt;
  if (adapt && raw > 0 && cut >= adapt.at)
    effects.push({ icon: statusIcon(adapt.status), text: `chặn ${Math.round(cut * 100)}% bot: bot sẽ thích nghi (+1 tầng ${statusDef(CONTENT, adapt.status).name})`, tone: 'warn', lasting: true });
  const leakLeft = state.enemy.leak && !intent.leak ? leakNow(state, intent) : 0;
  const hotfixed = (e: IntentEffect) => state.temp.hotfix && e.tone !== 'heal' && !e.lasting;
  const tone = (e: IntentEffect) =>
    hotfixed(e)
      ? 'bg-muted text-muted-foreground'
      : e.tone === 'bad'
        ? 'bg-rose-500/20 text-rose-300'
        : e.tone === 'warn'
          ? 'bg-orange-500/20 text-orange-300'
          : 'bg-emerald-500/20 text-emerald-300';
  return (
    <div className="flex w-full max-w-[300px] flex-col items-center gap-3">
      <IntentTrack intents={intents} step={state.enemy.step} pick={state.enemy.pick} />
      {foresightOf(CONTENT, state) > 0 && <Foresight state={state} />}
      <BossTraits state={state} />
      {/* what it is about to do: one compact badge, the details on hover / focus */}
      <div className="group relative">
        <button
          type="button"
          aria-describedby="bot-intent-card"
          className="flex items-center gap-2 rounded-full border border-amber-500/50 bg-amber-500/15 py-1 pl-1.5 pr-3 outline-none transition-colors hover:bg-amber-500/25 focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-amber-400/25 text-amber-300">
            <Icon className="size-5" />
          </span>
          <span className="font-mono text-lg font-bold text-amber-200">{n0(raw * (1 - cut))}</span>
          <span className="text-xs text-amber-200/70">rps</span>
          {effects.map((e) => (
            <span key={e.text} className={cn('flex size-7 items-center justify-center rounded-full [&_svg]:size-4', tone(e))}>
              <e.icon />
            </span>
          ))}
        </button>
        <div
          id="bot-intent-card"
          role="tooltip"
          className="pointer-events-none invisible absolute left-1/2 top-full z-30 mt-2 w-[280px] -translate-x-1/2 translate-y-1 rounded-xl border border-amber-500/40 bg-card/95 p-3 text-xs opacity-0 shadow-2xl shadow-black/60 backdrop-blur transition-[opacity,transform] duration-150 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
        >
          <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
            <Icon className="size-4 text-amber-300" /> {intent.label}
          </div>
          {intent.tag && <p className="mb-1 font-semibold text-rose-300">{intent.tag}</p>}
          <p className="mb-2 text-muted-foreground">{intent.text}</p>
          {leakLeft > 0 && <p className="mb-2 text-rose-300">Rò rỉ đã tích tụ: API chậm ×{(1 + leakLeft).toFixed(1)} tới khi Rolling restart.</p>}
          <div className="space-y-1.5 font-mono">
            <Row lg icon={<Bot className="text-rose-400" />} label="Bot dự kiến" value={`${n0(raw)} rps`} />
            {fromMinions > 0 && <Row icon={<Users className="text-orange-300" />} label="… trong đó từ lính" value={`${n0(fromMinions)} rps`} />}
            <Row lg icon={<Filter className="text-emerald-400" />} label="Bị lọc (WAF + rate limit)" value={`${Math.round(cut * 100)}%`} good={cut > 0} />
            <Row lg icon={<ShieldAlert className="text-amber-300" />} label="Lọt vào hệ thống" value={`${n0(raw * (1 - cut))} rps`} />
            <Row lg icon={<Users className="text-sky-300" />} label="Người dùng thật" value={`${n0(legitRpsNow(CONTENT, state))} rps`} />
          </div>
          {effects.length > 0 && (
            <div className="mt-2 flex flex-col gap-1 border-t pt-2">
              {effects.map((e) => (
                <span
                  key={e.text}
                  className={cn('flex items-center gap-2 rounded-lg px-2.5 py-1 text-sm font-semibold [&_svg]:size-4 [&_svg]:shrink-0', tone(e), hotfixed(e) && 'line-through')}
                >
                  <e.icon /> {e.text}
                </span>
              ))}
            </div>
          )}
          {state.temp.hotfix && hotfixable(intent) && (
            <div className="pt-2 text-emerald-300">Hotfix: hiệu ứng sự cố bị huỷ</div>
          )}
        </div>
      </div>

      <div
        ref={botZoneRef}
        className={cn('relative rounded-full', hasMinions && onAim && 'cursor-pointer')}
        onClick={hasMinions ? onAim : undefined}
        title={hasMinions ? (aimed ? 'Traffic đang nhắm vào chỉ huy' : 'Bấm để nhắm traffic vào chỉ huy') : undefined}
      >
        {aimed && !aiming && <AimBadge className="right-6 top-6" />}
        {aiming && <AimRing on={aiming.over?.kind === 'bot'} className="inset-4" />}
        {aiming?.over?.kind === 'bot' && <DropTag tone="bot" text={`Thả để đánh ${CONTENT.enemies.find((e) => e.id === state.enemy.id)?.name ?? 'bot'}`} className="-top-2" />}
        <BotAvatar
          ref={botRef}
          enemyId={state.enemy.id}
          stance={intent.icon}
          enraged={state.enemy.phase === 2}
          rank={rank}
          mini={mini}
          defeated={defeated}
          hpRatio={enemyHp / state.enemy.maxHp}
          className={cn('rounded-full', attacking && 'drop-shadow-[0_0_24px_rgba(244,63,94,0.55)]')} />
        <UserRing usersRef={usersRef} />
        {/* the minions stand in a row beside the enemy, lower down, between it and your system */}
        <div className="absolute bottom-0 right-full mr-14 translate-y-1/4" onClick={(e) => e.stopPropagation()}>
          {minions}
        </div>
      </div>
    </div>
  );
}

/** The crosshair on whatever attacks land on now. */
function AimBadge({ className }: { className?: string }) {
  return (
    <span className={cn('absolute z-10 flex size-6 items-center justify-center rounded-full border border-rose-300 bg-rose-500/80 text-white shadow-[0_0_10px_rgba(244,63,94,0.7)]', className)}>
      <Crosshair className="size-4" />
    </span>
  );
}

/**
 * The minions beside the enemy, in a row: each with its HP and what it does.
 * An attack card dropped on one hits it; clicking one aims the filtered traffic at it.
 */
function MinionRow({
  state,
  minionEls,
  aiming,
  onAim,
}: {
  state: BattleState;
  minionEls: React.RefObject<Record<number, HTMLDivElement | null>>;
  aiming: Aiming | null;
  onAim?: (uid: number) => void;
}) {
  const target = targetOf(state);
  const scale = state.enemy.rps ?? 1;
  const alive = minionsOf(state);
  const gone = useLeavers(alive, MINION_EXIT_MS);
  // fallen minions stay a moment for their exit: they die, or flee when their master falls
  const shown = [...alive.map((m) => ({ m, exit: undefined as string | undefined })), ...gone.map((m) => (state.phase === 'won' ? { m, exit: 'minion-flee' } : { m: { ...m, hp: 0 }, exit: minionDieClass(m.id) }))].sort((a, b) => a.m.uid - b.m.uid);
  if (!shown.length) return null;
  return (
    <div className="flex flex-row-reverse items-end gap-4">
      {shown.map(({ m, exit }, i) => {
        const def = minionDef(CONTENT, m.id);
        const on = !exit && target?.uid === m.uid;
        const hovered = !exit && aiming?.over?.kind === 'minion' && aiming.over.uid === m.uid;
        return (
          <button
            key={m.uid}
            type="button"
            disabled={!onAim || !!exit}
            onClick={() => onAim?.(m.uid)}
            title={`${def.name}: ${def.text}`}
            aria-pressed={on}
            className={cn('group/minion relative flex w-[76px] flex-col items-center outline-none focus-visible:ring-2 focus-visible:ring-rose-400', exit ?? 'minion-in')}
          >
            <div className="relative">
              {aiming && !exit && <AimRing on={hovered} className="-inset-1.5" />}
              {hovered && <DropTag tone="bot" text={`Thả để đánh ${def.name}`} className="bottom-full mb-3" />}
              {on && !aiming && <AimBadge className="-right-1.5 -top-1.5 size-5 [&_svg]:size-3.5" />}
              <MinionAvatar
                ref={(el) => void (minionEls.current[m.uid] = el)}
                minionId={m.id}
                hpRatio={m.hp / m.maxHp}
                index={i}
                className={cn('size-14 transition-[filter] duration-150', !exit && onAim && 'group-hover/minion:drop-shadow-[0_0_10px_rgba(251,113,133,0.6)]')}
              />
            </div>
            <span className="mt-0.5 w-full truncate text-center text-[10px] font-medium text-foreground/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">{def.name}</span>
            <div className="mt-0.5 h-1 w-12 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-rose-600 to-orange-500 transition-all duration-300" style={{ width: `${(m.hp / m.maxHp) * 100}%` }} />
            </div>
            <span className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              <span className="text-foreground/90">
                {m.hp}/{m.maxHp}
              </span>
              <span className="text-amber-300">+{n0(def.botRps * scale)}</span>
              {def.guard && <Shield className="size-3 text-sky-300" />}
              {def.heal && <HeartPulse className="size-3 text-emerald-300" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Items that just left `items` (by uid), kept for `ms` so they can play an exit.
 * A leaver shows up in the very render it leaves in, so its element (and any
 * effect aimed at it) carries on without a remount.
 */
function useLeavers<T extends { uid: number }>(items: T[], ms: number): T[] {
  const [gone, setGone] = useState<T[]>([]);
  const prev = useRef(items);
  const ids = new Set(items.map((i) => i.uid));
  const fresh = prev.current.filter((i) => !ids.has(i.uid) && !gone.some((g) => g.uid === i.uid));
  useEffect(() => {
    prev.current = items;
    if (!fresh.length) return;
    setGone((g) => [...g, ...fresh]);
    // no cleanup: a later change must not cancel this removal
    setTimeout(() => setGone((g) => g.filter((x) => !fresh.includes(x))), ms);
  });
  return [...gone, ...fresh];
}

/** One status on its own line: icon and label left, the number right. `lg` for the bot's card. */
function Row({ icon, label, value, good, bad, lg }: { icon?: ReactNode; label: string; value: string; good?: boolean; bad?: boolean; lg?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={cn('flex min-w-0 items-center text-muted-foreground [&_svg]:shrink-0', lg ? 'gap-2 [&_svg]:size-5' : 'gap-1.5 [&_svg]:size-3.5')}>
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className={cn('shrink-0 whitespace-nowrap', lg && 'text-base font-bold', bad ? 'text-rose-400' : good ? 'text-emerald-300' : undefined)}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------- your infrastructure

// ---------------------------------------------------------------- reports

/** A guide over the arena before the first turn; "Đã hiểu" closes it. */
function ReportCard({ report: r, onCollapse }: { report: TurnReport; onCollapse?: () => void }) {
  return (
    <div className="rounded-lg border bg-background/60 p-3 text-sm">
      <button type="button" onClick={onCollapse} className="mb-2 flex w-full items-center gap-2 text-left font-medium">
        <span className="font-mono text-xs text-muted-foreground">T{r.turn}</span>
        <span className="flex-1">{r.intent}</span>
        <span className="text-xs font-normal text-muted-foreground">10 giây mô phỏng</span>
      </button>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Lỗi" value={`${(r.errorRate * 100).toFixed(1)}%`} bad={r.errorRate > 0.01} />
        <Stat label="p99" value={`${Math.round(r.p99Ms)}ms`} bad={r.damage.latency > 0} />
        <Stat label="Bot bị chặn" value={`${n0(r.botBlockedRps)}/${n0(r.botRps)} rps`} />
        <Stat label="Chi phí" value={`$${r.costPerHour.toFixed(2)}/h`} bad={r.damage.budget > 0} />
      </div>
      <div className="mt-3 grid gap-3">
        <div>
          <div className="mb-1 text-xs font-medium text-rose-300">Bạn mất {r.damage.total} Error Budget</div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {r.damage.failed > 0 && <li>Người dùng gặp lỗi: −{r.damage.failed}</li>}
            {r.damage.latency > 0 && <li>Vượt SLO latency: −{r.damage.latency}</li>}
            {r.damage.budget > 0 && <li>Vượt ngân sách: −{r.damage.budget}</li>}
            {r.damage.absorbed > 0 && <li className="text-sky-300">Headroom đỡ: +{r.damage.absorbed}</li>}
            {r.damage.capped > 0 && <li>Giới hạn {CONTENT.battle.maxDamagePerTurn}/lượt: +{r.damage.capped}</li>}
            {r.damage.total === 0 && r.damage.absorbed === 0 && <li className="text-emerald-300">Hệ thống trụ vững</li>}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-emerald-300">Địch mất {r.enemyDamage} máu (từ bot bị lọc)</div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {r.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-md bg-muted/50 px-2 py-1.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn('font-mono', bad ? 'text-rose-400' : 'text-foreground')}>{value}</div>
    </div>
  );
}

/**
 * The battle log: a drawer on the right edge, closed by default so the
 * arena stays clear. Newest turn first and opened in full; older turns
 * collapse to one line and expand on click.
 */
function LogDrawer({ open, reports, onClose }: { open: boolean; reports: TurnReport[]; onClose: () => void }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const latest = reports.at(-1)?.turn;
  // a new turn comes in: show it in full
  useEffect(() => setExpanded(latest ?? null), [latest]);
  return (
    <aside
      aria-label="Nhật ký trận"
      aria-hidden={!open}
      inert={!open}
      className={cn(
        'absolute bottom-[150px] right-4 top-2 z-40 flex w-[min(440px,calc(100%-2rem))] flex-col rounded-2xl border bg-card/95 shadow-2xl shadow-black/60 backdrop-blur transition-[transform,opacity] duration-300 ease-out',
        open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-[calc(100%+2rem)] opacity-0',
      )}
    >
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <ScrollText className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Nhật ký</span>
        <span className="text-xs text-muted-foreground">{reports.length} lượt</span>
        <Button size="icon" variant="ghost" className="ml-auto size-7" aria-label="Đóng nhật ký" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {reports.length === 0 && (
          <p className="p-2 text-sm text-muted-foreground">Chưa có lượt nào. Kết quả mỗi lượt sẽ hiện ở đây sau khi bạn bấm Kết thúc lượt.</p>
        )}
        {reports
          .slice()
          .reverse()
          .map((r) =>
            expanded === r.turn ? (
              <ReportCard key={r.turn} report={r} onCollapse={() => setExpanded(null)} />
            ) : (
              <button
                key={r.turn}
                type="button"
                onClick={() => setExpanded(r.turn)}
                className="flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-left font-mono text-xs hover:bg-muted/60"
              >
                <span className="w-7 text-muted-foreground">T{r.turn}</span>
                <span className="flex-1 truncate font-sans">{r.intent}</span>
                <span className={r.damage.total ? 'text-rose-400' : 'text-muted-foreground'}>−{r.damage.total}</span>
                <span className={r.enemyDamage ? 'text-emerald-300' : 'text-muted-foreground'}>⚔{r.enemyDamage}</span>
              </button>
            ),
          )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- overlays

function EndScreen({
  state,
  deck,
  enemyName,
  seed,
  continueLabel,
  onLog,
  onContinue,
}: {
  state: BattleState;
  deck: string[];
  enemyName: string;
  seed: number;
  continueLabel: string;
  onLog: () => void;
  onContinue: () => void;
}) {
  const won = state.phase === 'won';
  const failed = state.reports.reduce((s, r) => s + r.legitFailed, 0);
  const blocked = state.reports.reduce((s, r) => s + r.botBlockedRps * (CONTENT.battle.turnMs / 1000), 0);
  const peakCost = Math.max(0, ...state.reports.map((r) => r.costPerHour));
  const byNode = useMemo(() => spendByNode(state.reports), [state.reports]);
  // a loss opens on the postmortem: that is when the player wants to know why
  const [tab, setTab] = useState<'sum' | 'pm'>(won ? 'sum' : 'pm');
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className={cn('max-h-[90vh] overflow-y-auto rounded-xl border bg-card p-6 shadow-2xl', tab === 'pm' ? 'w-[560px]' : 'w-[420px]')}>
        <div className="mb-2 flex items-center gap-2 text-2xl font-bold">
          {won ? <Trophy className="size-7 text-amber-300" /> : <Skull className="size-7 text-rose-400" />}
          {won ? `${enemyName} đã rút lui` : 'Hết Error Budget'}
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          {won
            ? `Bạn giữ hệ thống sống qua ${state.turn} lượt và còn ${state.hp}/${state.maxHp} Error Budget.`
            : `Hệ thống không đạt SLO quá nhiều lần ở lượt ${state.turn}. Postmortem bên dưới chỉ ra vì sao.`}
        </p>
        <div role="tablist" className="mb-3 flex gap-1 rounded-lg bg-muted/40 p-1 text-sm">
          {(
            [
              ['sum', 'Tổng kết'],
              ['pm', 'Postmortem'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('flex-1 rounded-md px-2 py-1', tab === k ? 'bg-background font-medium shadow' : 'text-muted-foreground')}>
              {label}
            </button>
          ))}
        </div>
        <div className="mb-5">
          {tab === 'sum' ? (
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Request người dùng lỗi" value={n0(failed)} bad={failed > 0} />
              <Stat label="Request bot bị chặn" value={n0(blocked)} />
              <Stat label="Chi phí cao nhất" value={`$${peakCost.toFixed(2)}/h`} />
              <Stat label="Seed" value={String(seed)} />
              <BillLine state={state} className="col-span-2 rounded-lg border bg-background/40 px-2 py-1.5" />
              {byNode.costs.length > 0 && (
                <div className="col-span-2 rounded-lg border bg-background/40 p-2">
                  <div className="mb-1 text-[11px] text-muted-foreground">Tiền đi đâu (trung bình mỗi lượt)</div>
                  <CostBreakdown costs={byNode.costs} egress={byNode.egress} budget={budgetOf(CONTENT, state)} />
                </div>
              )}
            </div>
          ) : (
            <PostmortemPanel reports={state.reports} chassis={state.chassis} deck={deck} />
          )}
        </div>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={onContinue}>
            {won ? <ArrowRight /> : <Skull />} {won ? continueLabel : 'Xem tổng kết ca'}
          </Button>
          <Button variant="outline" size="icon" aria-label="Mở nhật ký" onClick={onLog}>
            <ScrollText />
          </Button>
        </div>
      </div>
    </div>
  );
}

function RulesPanel({ onClose }: { onClose: () => void }) {
  const items = useMemo(
    () => [
      ['Mỗi lượt', `Rút ${CONTENT.battle.handSize} lá, có ${CONTENT.battle.opsPerTurn} Ops. Đánh bài rồi bấm Kết thúc lượt.`],
      ['Engine quyết định', `Hệ thống chạy ${CONTENT.battle.turnMs / 1000}s mô phỏng thật: ${CONTENT.battle.legitRps} người dùng/s ở tầng 1${CONTENT.run.actScale.legit ? ` (mỗi tầng sau đông hơn ${Math.round(CONTENT.run.actScale.legit * 100)}%)` : ''} cộng với bot lọt qua bộ lọc.`],
      ['Hiệu ứng theo lượt', 'Một số lá và đòn của địch để lại hiệu ứng kéo dài vài lượt (số trên chip là số lượt còn lại). Hotfix không gỡ được debuff, Rollback thì gỡ được.'],
      ['Bot thích nghi', CONTENT.battle.adapt ? `Lượt nào bạn chặn từ ${Math.round(CONTENT.battle.adapt.at * 100)}% bot trở lên, bot cộng 1 tầng thích nghi và lách bộ lọc nhiều hơn. Ngừng lọc mạnh ${CONTENT.battle.adapt.turns} lượt thì hết.` : 'Tắt.'],
      ['Error Budget', `Phần lỗi còn được phép trước khi vi phạm SLO. Mất 1 cho mỗi ${CONTENT.battle.failedPerDamage} request người dùng lỗi, ${CONTENT.battle.latencyDamage} nếu p99 > ${CONTENT.battle.sloP99Ms}ms, và khi chi phí vượt ngân sách. Hết là thua.`],
      ['Chi phí', `Mỗi lượt hệ thống tốn $/h theo số instance (bấm vào số $/h trên hệ thống để xem từng node). Vượt ngân sách của kiến trúc thì mất ${CONTENT.battle.overBudgetDamage} Error Budget cho mỗi $1/h vượt.${CONTENT.run.bill ? ` Trong ca leo tháp, sau mỗi trận thắng còn trả hóa đơn cloud: ${CONTENT.run.bill.perDollarTurn} vàng cho mỗi $1/h mỗi lượt, trừ vào vàng thưởng.` : ''}`],
      ['Deploy liều', `Lá ghi "Deploy liều" không tốn Ops mà trừ thẳng Error Budget. Dưới ${Math.round(FREEZE_AT * 100)}% Error Budget là đóng băng deploy: không đánh được lá liều, nhưng mỗi lượt hồi 1.`],
      ['Địch mất máu', `Từ lá Phản công, và 1 máu cho mỗi ${CONTENT.battle.blockedPerDamage} request bot bị WAF hoặc rate limit chặn. Địch yếu thì gửi ít traffic hơn.`],
      ['Leo tháp', `${CONTENT.run.title} có ${CONTENT.run.acts} tầng. Mỗi tầng là một bản đồ rẽ nhánh: tự chọn đường qua trận thường, tinh anh (khó hơn, thưởng nhiều hơn), sự cố và chỗ nghỉ, rồi đánh trùm ở đỉnh. Máu và bộ bài giữ nguyên suốt ca; tầng càng cao địch càng mạnh.`],
      ['Thẻ bài', 'Hạ tầng và Chính sách tồn tại cả trận (nhưng tốn tiền mỗi giờ). Hành động chỉ có tác dụng trong lượt.'],
      ['Ổ cắm hạ tầng', 'Hệ thống có các ổ cắm ngay trên sơ đồ: trên đường gọi (timeout, retry, breaker), trên service (autoscaler, load shed), trước DB (Redis), trên DB (Index, Replica) và trên lời gọi đối tác (Queue). Lá có ghi "ổ" phải kéo vào đúng ổ; ổ đầy thì thả lên một module để thay nó. Đánh lại lá đã lắp thì nâng cấp module. Scale API và WAF không cần ổ.'],
      ['Đối tác', 'Mỗi request còn gọi một dịch vụ đối tác (thanh toán, email) một cách đồng bộ. Đối tác chậm thì API bị giữ slot; Message Queue tách phần này ra chạy sau.'],
    ],
    [],
  );
  return (
    <div className="border-b bg-muted/30 px-4 py-3 text-sm">
      <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
        {items.map(([k, v]) => (
          <p key={k}>
            <b>{k}:</b> <span className="text-muted-foreground">{v}</span>
          </p>
        ))}
      </div>
      <button className="mt-1 text-xs text-muted-foreground underline" onClick={onClose}>
        Đóng
      </button>
    </div>
  );
}

/** Engine forecast for ending the turn now, above the end-turn button. */
function Forecast({ score }: { score: TurnScore | null }) {
  return (
    <div
      className={`absolute bottom-full right-0 mb-1 w-[168px] rounded-md border border-border/60 bg-background/80 px-2 py-1 text-right text-[11px] leading-tight backdrop-blur transition-opacity ${score ? '' : 'opacity-50'}`}
      title="Engine chạy thử lượt này với bài đã đánh. Kết quả thật giống hệt nếu bạn kết thúc lượt ngay."
    >
      <div className="text-muted-foreground">Dự kiến nếu kết thúc lượt</div>
      {score ? (
        <div className="font-mono">
          <span className={score.damage.total > 0 ? 'text-rose-300' : 'text-emerald-300'}>−{score.damage.total} Error Budget</span>
          {score.enemyDamage > 0 && <span className="text-amber-300"> · botnet −{score.enemyDamage}</span>}
        </div>
      ) : (
        <div className="font-mono text-muted-foreground">đang tính…</div>
      )}
    </div>
  );
}
