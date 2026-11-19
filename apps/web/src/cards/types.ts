// Card battle prototype ("On-Call"): data model.
//
// Everything here is plain JSON-serialisable data so the same content files
// (src/cards/data/*.json) and the same rules can later be ported to another
// client (Godot) without rewriting the game design.

import type { Design, EdgePolicy } from '@/types';

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
  text: string;
  /** One line on the real-world idea behind the card. */
  lesson: string;
  effects: Effect[];
  /** Removed from the fight after playing. */
  exhaust?: boolean;
  /** Curses: cannot be played, just clog the hand. */
  unplayable?: boolean;
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
}

export interface EnemyDef {
  id: string;
  name: string;
  description: string;
  hp: number;
  /** Played in order, then repeated with `escalation` more traffic per loop. */
  intents: Intent[];
  escalation: number;
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

export interface Content {
  cards: CardDef[];
  enemies: EnemyDef[];
  battle: BattleConfig;
  run: RunConfig;
}

/** What a fight starts from when it is part of a run (defaults: `battle.json`). */
export interface BattleSetup {
  enemy?: string;
  hp?: number;
  maxHp?: number;
  deck?: string[];
}

// ---------------------------------------------------------------- run ("ca trực")

export type Floor =
  | { kind: 'battle'; enemy: string; title: string; boss?: boolean }
  | { kind: 'rest'; title: string };

export interface RunConfig {
  title: string;
  /** Player max HP for the whole run (a single fight uses `battle.hp`). */
  hp: number;
  floors: Floor[];
  /** Cards offered after each won fight (pick one or skip). */
  rewardChoices: number;
  /** Share of max HP restored at a rest stop. */
  restHeal: number;
}

export type RunPhase = 'battle' | 'reward' | 'rest' | 'won' | 'lost';

export interface FloorResult {
  floor: number;
  enemy: string;
  won: boolean;
  turns: number;
  hpLost: number;
  /** Card taken after the fight (null: skipped), or removed / healed at a rest. */
  picked?: string | null;
  removed?: string;
  healed?: number;
}

export interface RunState {
  version: 1;
  seed: number;
  /** RNG for rewards, advanced only by the run rules. */
  rng: number;
  floor: number;
  phase: RunPhase;
  hp: number;
  maxHp: number;
  /** Card ids; curses added during a fight do not stay in the deck. */
  deck: string[];
  /** Card ids offered in the `reward` phase. */
  reward: string[];
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
  enemy: { id: string; hp: number; maxHp: number; step: number };
  /** Cards played this turn (for the log). */
  played: string[];
  reports: TurnReport[];
  nextUid: number;
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
