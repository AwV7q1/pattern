// Card battle prototype ("On-Call"): data model.
//
// Everything here is plain JSON-serialisable data so the same content files
// (src/cards/data/*.json) and the same rules can later be ported to another
// client (Godot) without rewriting the game design.

import type { Design, EdgePolicy } from '@/types';

/** basic: starting deck only, never offered. */
export type Rarity = 'basic' | 'common' | 'uncommon' | 'rare';
export type RarityWeights = Record<Exclude<Rarity, 'basic'>, number>;

export type CardType = 'infra' | 'policy' | 'action' | 'attack' | 'curse';
/** Node a card targets. The battle topology is client → lb → api → [cache] → db. */
export type NodeRef = 'api' | 'db';

export type Effect =
  /** Add instances to a node. `temp`: only for the turn it is played. */
  | { op: 'scale'; node: NodeRef; n: number; temp?: boolean }
  /** Put a cache in front of the DB, or raise its hit rate if it exists. */
  | { op: 'cache'; hitRate: number; step: number; max: number }
  /** Patch the call that leaves the API (to the cache or the DB). Lasts the whole fight. */
  | { op: 'edge'; patch: Partial<EdgePolicy> }
  /** Filter this share of bot traffic for the current turn only. */
  | { op: 'rateLimit'; cut: number }
  /** Permanently filter more bot traffic (capped at `max`). */
  | { op: 'waf'; cut: number; max: number }
  /** Damage the attacker directly. */
  | { op: 'attack'; dmg: number }
  /** Absorbs damage this turn, like block. Cleared at the start of the next turn. */
  | { op: 'headroom'; n: number }
  | { op: 'draw'; n: number }
  | { op: 'ops'; n: number }
  /** Cancel the attacker's chaos (slow DB, client retries) for this turn. */
  | { op: 'hotfix' }
  /** Multiply a node's settings for the whole fight (`latency` scales p50 and p99). */
  | { op: 'tune'; node: NodeRef; mul: TuneMul }
  /** Exhaust every unplayable card (curse) in hand; `draw`: draw one per card removed. */
  | { op: 'purge'; draw?: boolean };

export interface TuneMul {
  latency?: number;
  concurrency?: number;
  queueSize?: number;
  cost?: number;
}

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  /** Curses have none. */
  rarity?: Rarity;
  text: string;
  /** One line on the real-world idea behind the card. */
  lesson: string;
  effects: Effect[];
  /** Removed from the fight after playing. */
  exhaust?: boolean;
  /** Curses: cannot be played, just clog the hand. */
  unplayable?: boolean;
  /** What the upgraded copy (id `<id>+`, from a rest stop) changes. */
  upgrade?: { cost?: number; text: string; effects?: Effect[] };
  /** Set on the upgraded copy that `cardDef` builds. */
  upgraded?: boolean;
}

export interface Intent {
  id: string;
  label: string;
  icon: 'probe' | 'spike' | 'retry' | 'slow' | 'debt' | 'heal';
  text: string;
  /** Bot requests per second at full attacker HP. */
  botRps: number;
  /** Chaos applied for the whole turn (engine `events`). */
  chaos?: { node: NodeRef; action: 'latency' | 'errors'; value: number };
  /** Clients (bots and users) retry failed requests this many times, no backoff. */
  clientRetries?: number;
  /** Multiplies the cache hit rate this turn (queries the cache cannot answer). */
  cacheHitScale?: number;
  /** Curse cards shuffled into the discard pile after the turn. */
  addCards?: { card: string; n: number };
  heal?: number;
  /** Share of the filtering (WAF + rate limit) the bots slip past this turn. Hotfix does not stop it. */
  bypass?: number;
  /** Ops taken away next turn (connections held open, people paged). */
  drainOps?: number;
  /** WAF lost right after this turn (rotating proxies, new IPs). */
  wafStrip?: number;
  /** weighted enemies: odds of this intent (default 1). */
  weight?: number;
}

export interface EnemyDef {
  id: string;
  name: string;
  description: string;
  hp: number;
  /** Played in order, then repeated with `escalation` more traffic per loop. */
  intents: Intent[];
  escalation: number;
  /** cycle (default): intents in order. weighted: drawn by `weight`, never the same one 3 turns running. */
  pattern?: 'cycle' | 'weighted';
  /** Below `at` × max HP, the next turn switches to these intents (bosses). */
  phase2?: { at: number; label: string; text: string; intents: Intent[] };
  /** Always on for the whole fight (bosses, some elites). */
  passive?: {
    label: string;
    text: string;
    /** WAF loses this much each turn. */
    wafDecay?: number;
    /** Real users' traffic multiplier. */
    legitRpsMul?: number;
    /** Cache hit rate multiplier, every turn (stacks with intents). */
    cacheHitScale?: number;
    /** Share of the filtering bots always slip past (stacks with intents). */
    bypass?: number;
    /** HP the enemy regains at the end of every turn. */
    regen?: number;
  };
}

export interface BattleConfig {
  title: string;
  enemy: string;
  hp: number;
  opsPerTurn: number;
  handSize: number;
  /** Real users per second; they never stop coming. */
  legitRps: number;
  /** Simulated time per turn. */
  turnMs: number;
  sloP99Ms: number;
  budgetPerHour: number;
  /** Failed real-user requests per point of damage to the player. */
  failedPerDamage: number;
  latencyDamage: number;
  /** Cap on damage to the player in one turn, so one bad turn is not an instant loss. */
  maxDamagePerTurn: number;
  /** Damage per $1/h over budget (rounded up). */
  overBudgetDamage: number;
  /** Bot requests filtered per point of damage to the attacker. */
  blockedPerDamage: number;
  startingDeck: string[];
  design: Design;
}

export type RelicRarity = 'common' | 'uncommon' | 'rare' | 'boss';

/** A passive item kept for the whole run. Its effects are card effects, fired by the battle rules. */
export interface RelicDef {
  id: string;
  name: string;
  rarity: RelicRarity;
  /** Key in `RELIC_ICON` (cardArt.ts). */
  icon: string;
  text: string;
  lesson: string;
  /** battleStart: once, after the first hand. turnStart: every turn, after the draw. cardPlayed: after a card's effects. */
  trigger: 'battleStart' | 'turnStart' | 'cardPlayed';
  /** cardPlayed: only cards of this type count. */
  cardType?: CardType;
  /** cardPlayed: fire on every n-th matching card of the fight. */
  every?: number;
  effects: Effect[];
  /** Applied once, when the relic is taken. */
  pickup?: { maxHp?: number };
}

export interface Content {
  relics: RelicDef[];
  cards: CardDef[];
  enemies: EnemyDef[];
  battle: BattleConfig;
  run: RunConfig;
  events: RunEvent[];
}

/** What a fight starts from when it is part of a run (defaults: `battle.json`). */
export interface BattleSetup {
  enemy?: string;
  hp?: number;
  maxHp?: number;
  deck?: string[];
  /** Enemy HP and traffic multipliers (elites, bosses, higher floors). */
  enemyScale?: Scale;
  relics?: string[];
}

// ---------------------------------------------------------------- run: the tower ("Tháp On-Call")

export type NodeKind = 'battle' | 'elite' | 'rest' | 'event' | 'shop' | 'boss';

export interface MapNode {
  id: number;
  /** 0 = entry row; the boss sits on row `map.rows`. */
  row: number;
  col: number;
  kind: NodeKind;
  /** Ids of the nodes this one leads to. */
  next: number[];
}

export interface TowerMap {
  act: number;
  nodes: MapNode[];
  bossId: number;
}

export interface Scale {
  hp: number;
  rps: number;
}

export interface RunConfig {
  title: string;
  /** Floors of the tower; beating the last boss wins the run. */
  acts: number;
  /** Player max HP at the start of a run (a single fight uses `battle.hp`). */
  hp: number;
  /** Cards offered after each won fight (pick one or skip); elites offer one more. */
  rewardChoices: number;
  /** Gold at the start of a run, and won per fight (± `goldJitter`). */
  startGold: number;
  gold: { battle: number; elite: number; boss: number };
  goldJitter: number;
  shop: {
    /** Cards for sale, and their price by rarity. */
    cards: number;
    cardPrice: Record<'common' | 'uncommon' | 'rare', number>;
    relics: number;
    relicPrice: Record<'common' | 'uncommon' | 'rare', number>;
    /** Removing a card: first price, then this much more each time in the run. */
    removePrice: number;
    removeStep: number;
  };
  /** Odds of each rarity of the relic an elite drops. */
  relicWeights: Record<'common' | 'uncommon' | 'rare', number>;
  /** Boss relics offered after each boss but the last. */
  bossRelicChoices: number;
  /** Odds of each rarity in a card offer, after normal fights (and events) and after elites. */
  rarityWeights: { battle: RarityWeights; elite: RarityWeights };
  /** Share of max HP restored at a rest stop. */
  restHeal: number;
  /** Share of max HP restored when climbing to the next floor. */
  actHeal: number;
  map: { rows: number; width: number; paths: number; weights: Record<'battle' | 'event' | 'elite' | 'rest' | 'shop', number> };
  /** Enemies met in normal fights, one list per floor (wraps around). */
  normal: string[][];
  /** Enemies met in elite fights, one list per floor (wraps around). */
  elites: string[][];
  /** Boss of each floor, in order (wraps around). */
  bosses: string[];
  /** Enemy multipliers by node kind (before the floor multiplier). */
  fight: Scale;
  elite: Scale & { maxHp: number };
  boss: Scale;
  /** Extra enemy HP / traffic per floor climbed (×(1 + k·(act−1))). */
  actScale: Scale;
}

export type EventEffect =
  | { op: 'heal'; n: number }
  | { op: 'damage'; n: number }
  | { op: 'maxHp'; n: number }
  | { op: 'addCard'; card: string }
  | { op: 'randomCard' }
  | { op: 'gold'; n: number }
  | { op: 'pickCard' }
  | { op: 'removeCard' };

export interface RunEvent {
  id: string;
  title: string;
  text: string;
  options: { label: string; effects: EventEffect[] }[];
}

export type RunPhase = 'map' | 'battle' | 'reward' | 'rest' | 'event' | 'shop' | 'cleared' | 'won' | 'lost';

export interface ShopStock {
  cards: { id: string; price: number; sold?: boolean }[];
  relics: { id: string; price: number; sold?: boolean }[];
  /** Whether the card removal service was used here (once per shop). */
  removed: boolean;
}

export type RestChoice = { heal: true } | { remove: number } | { upgrade: number };

export interface FloorResult {
  act: number;
  kind: NodeKind;
  /** Enemy id for fights, event id for events, '' for rests. */
  enemy: string;
  won: boolean;
  turns: number;
  hpLost: number;
  /** Card taken after the fight (null: skipped), or removed / healed at a rest. */
  picked?: string | null;
  removed?: string;
  /** Map node (shops: so purchases in one shop share an entry). */
  node?: number;
  /** Gold won (fights, events) or spent (shops). */
  gold?: number;
  /** Shop purchases. */
  bought?: string[];
  /** Relic taken (elite drop, boss pick). */
  relic?: string;
  /** Card upgraded at a rest (its base id). */
  upgraded?: string;
  healed?: number;
  added?: string[];
  /** Event option taken. */
  option?: string;
}

export interface RunState {
  version: 3;
  seed: number;
  /** RNG for rewards and events, advanced only by the run rules. */
  rng: number;
  act: number;
  /** Map node the player stands on (null: at the foot of the floor). */
  node: number | null;
  /** Nodes visited on this floor, in order. */
  path: number[];
  /** Nodes visited in the whole run. */
  climbed: number;
  phase: RunPhase;
  hp: number;
  maxHp: number;
  /** Card ids; curses added during a fight do not stay in the deck. */
  deck: string[];
  /** Card ids offered in the `reward` phase. */
  reward: string[];
  /** Event shown in the `event` phase. */
  event: string | null;
  gold: number;
  /** Cards removed at shops so far (each removal costs more). */
  removals: number;
  /** Stock of the shop the player stands in (`shop` phase). */
  shop: ShopStock | null;
  /** Relics held (ids), in the order they were taken. */
  relics: string[];
  /** Boss relics offered in the `cleared` phase (pick one when climbing). */
  relicOffer: string[];
  history: FloorResult[];
}

export interface CardInst {
  uid: number;
  id: string;
}

export interface TurnReport {
  turn: number;
  intent: string;
  legitRps: number;
  botRps: number;
  botBlockedRps: number;
  okRps: number;
  errorRate: number;
  p50Ms: number;
  p99Ms: number;
  costPerHour: number;
  legitFailed: number;
  damage: { failed: number; latency: number; budget: number; absorbed: number; capped: number; total: number };
  enemyDamage: number;
  notes: string[];
}

/** Damage of one turn, as `scoreTurn` computes it. */
export type TurnScore = Pick<TurnReport, 'legitFailed' | 'damage' | 'enemyDamage'>;

export type Phase = 'player' | 'resolving' | 'won' | 'lost';

export interface BattleState {
  seed: number;
  /** RNG state, advanced only by the rules (deterministic replays). */
  rng: number;
  turn: number;
  phase: Phase;
  hp: number;
  maxHp: number;
  headroom: number;
  ops: number;
  drawPile: CardInst[];
  hand: CardInst[];
  discard: CardInst[];
  exhausted: CardInst[];
  /** Topology that persists for the whole fight. */
  design: Design;
  waf: number;
  temp: { api: number; db: number; botCut: number; hotfix: boolean };
  enemy: {
    id: string;
    hp: number;
    maxHp: number;
    step: number;
    /** Traffic multiplier (default 1). */
    rps?: number;
    /** Set once a boss has switched to its second phase. */
    phase?: 2;
    /** weighted enemies: index of this turn's intent, and the ones before (newest last). */
    pick?: number;
    recent?: number[];
  };
  /** Cards played this turn (for the log). */
  played: string[];
  reports: TurnReport[];
  nextUid: number;
  /** Relics carried into the fight (ids). */
  relics: string[];
  /** cardPlayed relics with `every`: matching cards played so far this fight. */
  relicCount: Record<string, number>;
  /** Relics that fired since the last card or turn (for the UI flash). */
  relicFired: string[];
}

/** What the UI must run through the engine before `resolveTurn`. */
export interface TurnPlan {
  input: { design: Design; scenario: object };
  intent: Intent;
  legitRps: number;
  botRps: number;
  botBlockedRps: number;
}

export type Action = { type: 'play'; uid: number } | { type: 'endTurn' };
