// Card battle rules: a pure, deterministic state machine.
//
// No React, no DOM, no engine import: content is passed in, and the only
// randomness is a seeded RNG stored in the state. The UI (or a balance
// script, or a server replaying a run) drives it like this:
//
//   let s = newBattle(content, seed);
//   s = playCard(content, s, uid);            // any number of times
//   const plan = planTurn(content, s);        // design + scenario for the engine
//   const summary = runEngine(plan.input);    // 10 s of simulated traffic
//   s = resolveTurn(content, s, plan, summary);
//
// Keeping it this shape makes it straightforward to port to GDScript/C#/Rust.

import type { Design, DesignEdge, DesignNode, Summary } from '@/types';
import type { BattleSetup, BattleState, CardDef, ChassisDef, CardInst, ComboDef, Content, Effect, EnemyDef, HotNode, Intent, IntentWhen, MinionDef, MinionState, ModuleInst, NodeRef, RelicDef, SocketDef, SocketKind, StatusDef, StatusMods, TuneMul, TurnPlan, TurnReport, TurnScore } from './types';

// ---------------------------------------------------------------- rng (mulberry32)

export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function shuffle<T>(state: { rng: number }, items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------- lookups

/** Upgraded copies are `<id>+`. */
export const baseId = (id: string) => (id.endsWith('+') ? id.slice(0, -1) : id);
export const canUpgrade = (content: Content, id: string) => !id.endsWith('+') && !!content.cards.find((c) => c.id === id)?.upgrade;

const upgradedDefs = new WeakMap<CardDef, CardDef>();

export function cardDef(content: Content, id: string): CardDef {
  const def = content.cards.find((c) => c.id === baseId(id));
  if (!def || (id !== def.id && !def.upgrade)) throw new Error(`unknown card ${id}`);
  if (id === def.id) return def;
  // same object every time, so React keys and memos stay stable
  let up = upgradedDefs.get(def);
  if (!up) {
    const u = def.upgrade!;
    up = { ...def, id, name: `${def.name}+`, cost: u.cost ?? def.cost, text: u.text, effects: u.effects ?? def.effects, upgraded: true };
    upgradedDefs.set(def, up);
  }
  return up;
}

export function enemyDef(content: Content, state: BattleState): EnemyDef {
  const def = content.enemies.find((e) => e.id === state.enemy.id);
  if (!def) throw new Error(`unknown enemy ${state.enemy.id}`);
  return def;
}

export function minionDef(content: Content, id: string): MinionDef {
  const def = content.minions.find((m) => m.id === id);
  if (!def) throw new Error(`unknown minion ${id}`);
  return def;
}

/** Most minions alive at once: a summon past this is lost. */
export const MAX_MINIONS = 3;

export const minionsOf = (state: BattleState): MinionState[] => state.minions ?? [];

/** Bot traffic the minions add this turn (they do not weaken as their master does). */
export function minionRpsNow(content: Content, state: BattleState): number {
  return Math.round(minionsOf(state).reduce((sum, m) => sum + minionDef(content, m.id).botRps, 0) * (state.enemy.rps ?? 1));
}

/** Share of damage the enemy is spared by its guarding minions. */
export function guardNow(content: Content, state: BattleState): number {
  return 1 - minionsOf(state).reduce((left, m) => left * (1 - (minionDef(content, m.id).guard ?? 0)), 1);
}

/** The minion attacks go to now, if any (a dead or unknown target falls back to the enemy). */
export function targetOf(state: BattleState): MinionState | undefined {
  return state.target === undefined ? undefined : minionsOf(state).find((m) => m.uid === state.target);
}

/** Aim attacks at a minion (its uid) or back at the enemy (null). */
export function setTarget(prev: BattleState, uid: number | null): BattleState {
  if (prev.phase !== 'player') return prev;
  if (uid !== null && !minionsOf(prev).some((m) => m.uid === uid)) return prev;
  if ((prev.target ?? null) === uid) return prev;
  const state = clone(prev);
  if (uid === null) delete state.target;
  else state.target = uid;
  return state;
}

/** Damage to the current target: a minion takes it all (the excess is lost), the enemy only what its guards let through. */
function hitEnemy(content: Content, state: BattleState, dmg: number): { minion?: string; dealt: number; killed?: boolean } {
  if (dmg <= 0) return { dealt: 0 };
  const m = targetOf(state);
  if (m) {
    const dealt = Math.min(m.hp, dmg);
    m.hp -= dealt;
    const killed = m.hp <= 0;
    if (killed) {
      state.minions = minionsOf(state).filter((x) => x !== m);
      delete state.target;
    }
    return { minion: minionDef(content, m.id).name, dealt, killed };
  }
  const dealt = Math.min(state.enemy.hp, Math.ceil(dmg * (1 - guardNow(content, state))));
  state.enemy.hp -= dealt;
  return { dealt };
}

function summon(content: Content, state: BattleState, id: string, n: number): number {
  const def = minionDef(content, id);
  const room = Math.max(0, Math.min(n, MAX_MINIONS - minionsOf(state).length));
  const hp = Math.round(def.hp * (state.enemy.minionHp ?? 1));
  for (let i = 0; i < room; i++) state.minions = [...minionsOf(state), { uid: state.nextUid++, id, hp, maxHp: hp }];
  return room;
}

/** Intents the enemy draws from now (a boss's second phase has its own). */
export function intentsNow(content: Content, state: BattleState): Intent[] {
  const def = enemyDef(content, state);
  return state.enemy.phase === 2 && def.phase2 ? def.phase2.intents : def.intents;
}

/** The intent of the current turn as written in the content, before its variant and escalation. */
function baseIntent(content: Content, state: BattleState): Intent {
  const list = intentsNow(content, state);
  return enemyDef(content, state).pattern === 'weighted' ? list[state.enemy.pick ?? 0] : list[state.enemy.step % list.length];
}

/** What the attacker can read of the player's build. */
export function designTraits(content: Content, state: BattleState) {
  const design = designOf(content, state);
  const inst = (ref: NodeRef) => nodeOf(design, alias(content, state, ref))?.config?.instances ?? 1;
  const out = mainCall(content, state, design);
  return {
    hasCache: design.nodes.some((n) => n.kind === 'cache'),
    instances: { api: inst('api'), db: inst('db') },
    waf: state.waf,
    retries: out?.retries ?? 0,
    retryBudget: !!out?.retryBudget,
    modules: [...modulesOf(state).map((m) => baseId(m.card)), ...(chassisOf(content, state).builtin ?? [])],
    chassis: chassisOf(content, state).id,
  };
}

export function matchesWhen(when: IntentWhen, t: ReturnType<typeof designTraits>): boolean {
  if (when.hasCache !== undefined && when.hasCache !== t.hasCache) return false;
  for (const [node, n] of Object.entries(when.instancesAtLeast ?? {})) if (t.instances[node as 'api' | 'db'] < n!) return false;
  if (when.wafAtLeast !== undefined && t.waf < when.wafAtLeast - 1e-9) return false;
  if (when.retriesAtLeast !== undefined && t.retries < when.retriesAtLeast) return false;
  if (when.noRetryBudget && t.retryBudget) return false;
  if (when.hasModule && !when.hasModule.every((id) => t.modules.includes(id))) return false;
  if (when.chassis && !when.chassis.includes(t.chassis)) return false;
  return true;
}

/** The attacker's plan for the current turn: its variant (chosen at the start of the turn), with escalation per loop. */
export function currentIntent(content: Content, state: BattleState): Intent {
  const def = enemyDef(content, state);
  const list = intentsNow(content, state);
  const loop = Math.floor(state.enemy.step / list.length);
  const base = baseIntent(content, state);
  const v = state.enemy.variant === undefined ? undefined : base.variants?.[state.enemy.variant];
  const { variants: _variants, ...plain } = base;
  const { when: _when, ...over } = v ?? { when: {} };
  const merged: Intent = { ...plain, ...over };
  return { ...merged, botRps: Math.round(merged.botRps * (1 + def.escalation * loop) * (state.enemy.rps ?? 1)) };
}

/** Real users' traffic this fight (higher floors and a boss passive raise it). */
export function legitRpsNow(content: Content, state: BattleState): number {
  return Math.round(content.battle.legitRps * (state.legitMul ?? 1) * (enemyDef(content, state).passive?.legitRpsMul ?? 1));
}

// ---------------------------------------------------------------- statuses

export function statusDef(content: Content, id: string): StatusDef {
  const def = content.statuses.find((x) => x.id === id);
  if (!def) throw new Error(`unknown status ${id}`);
  return def;
}

/** Gain a status, or more of it: `refresh` only extends it, `add` also piles up stacks (up to `maxStacks`). */
export function addStatus(content: Content, state: BattleState, id: string, turns: number, stacks = 1) {
  const def = statusDef(content, id);
  const list = (state.statuses ??= []);
  const cur = list.find((x) => x.id === id);
  const cap = def.maxStacks ?? Infinity;
  if (!cur) list.push({ id, turns, stacks: def.stack === 'add' ? Math.min(cap, stacks) : 1 });
  else {
    cur.turns = Math.max(cur.turns, turns);
    if (def.stack === 'add') cur.stacks = Math.min(cap, cur.stacks + stacks);
  }
}

export type Mods = Required<StatusMods>;
const NO_MODS: Mods = { apiLatency: 1, dbLatency: 1, cost: 1, botRps: 1, blockedDamage: 1, apiInstances: 0, dbInstances: 0, botCut: 0, bypass: 0, opsPerTurn: 0 };

/** The nodes a socket touches: its node, the node it sits in front of, or both ends of its call. */
function socketNodes(socket: SocketDef | undefined): string[] {
  if (!socket) return [];
  const at = socket.at;
  return 'node' in at ? [at.node] : 'before' in at ? [at.before] : at.edge;
}

/** Combos whose modules are all installed, where the combo wants them (same socket, or sockets that touch). */
export function activeCombos(content: Content, state: BattleState): ComboDef[] {
  return (content.combos ?? []).filter((c) => {
    const mods = c.needs.map((id) => moduleOf(state, id));
    if (!mods.every(Boolean)) return false;
    if (c.sameSocket && new Set(mods.map((m) => m!.socket)).size > 1) return false;
    if (c.adjacent) {
      const nodes = mods.map((m) => socketNodes(socketOf(content, state, m!.socket)));
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (!nodes[i].some((n) => nodes[j].includes(n))) return false;
    }
    return true;
  });
}

/** Everything the statuses in play (and the active combos) change, combined. The only place the rules read them from. */
export function statusMods(content: Content, state: BattleState): Mods {
  const m = { ...NO_MODS };
  const all = [
    ...(state.statuses ?? []).map((inst) => ({ mods: statusDef(content, inst.id).mods, stacks: inst.stacks })),
    ...activeCombos(content, state).map((c) => ({ mods: c.mods ?? {}, stacks: 1 })),
  ];
  for (const inst of all) {
    const d = inst.mods;
    const k = inst.stacks;
    for (const key of ['apiLatency', 'dbLatency', 'cost', 'botRps', 'blockedDamage'] as const) if (d[key] !== undefined) m[key] *= d[key] ** k;
    for (const key of ['apiInstances', 'dbInstances', 'opsPerTurn'] as const) if (d[key] !== undefined) m[key] += d[key] * k;
    for (const key of ['botCut', 'bypass'] as const) if (d[key] !== undefined) m[key] = 1 - (1 - m[key]) * (1 - d[key]) ** k;
  }
  return m;
}

/** End of a turn: every status loses a turn, and those run out go. */
function tickStatuses(state: BattleState) {
  if (!state.statuses) return;
  for (const x of state.statuses) x.turns--;
  state.statuses = state.statuses.filter((x) => x.turns > 0);
  if (!state.statuses.length) delete state.statuses;
}

/** Whether this turn's filtering is heavy enough for the bots to adapt (see `battle.adapt`). */
export function adaptsNow(content: Content, plan: Pick<TurnPlan, 'botRps' | 'botBlockedRps'>): boolean {
  const a = content.battle.adapt;
  return !!a && plan.botRps > 0 && plan.botBlockedRps / plan.botRps >= a.at;
}

/** Start of a turn, once the hand and relics are in: pick the variant of the intent that answers the player's build. */
function chooseVariant(content: Content, state: BattleState) {
  const t = designTraits(content, state);
  const i = baseIntent(content, state).variants?.findIndex((v) => matchesWhen(v.when, t)) ?? -1;
  if (i >= 0) state.enemy.variant = i;
  else delete state.enemy.variant;
}

/** weighted enemies: draw this turn's intent, never the same one three turns running. */
function pickIntent(content: Content, state: BattleState) {
  if (enemyDef(content, state).pattern !== 'weighted') return;
  const list = intentsNow(content, state);
  const recent = state.enemy.recent ?? [];
  const banned = recent.length >= 2 && recent.at(-1) === recent.at(-2) ? recent.at(-1) : undefined;
  const options = list.map((it, i) => ({ i, w: i === banned ? 0 : (it.weight ?? 1) }));
  const total = options.reduce((sum, o) => sum + o.w, 0);
  let roll = nextRandom(state) * total;
  const pick = options.find((o) => o.w > 0 && (roll -= o.w) < 0)?.i ?? [...options].reverse().find((o) => o.w > 0)!.i;
  state.enemy.pick = pick;
  state.enemy.recent = [...recent, pick].slice(-2);
}

/** A weaker botnet sends less traffic: 60% at 0 HP, 100% at full HP. Minions add theirs on top. */
export function botRpsNow(content: Content, state: BattleState): number {
  const ratio = state.enemy.hp / state.enemy.maxHp;
  const rps = Math.round(currentIntent(content, state).botRps * (0.6 + 0.4 * ratio)) + minionRpsNow(content, state);
  return Math.round(rps * statusMods(content, state).botRps);
}

/** Share of the filtering the bots slip past this turn (intent, passive and statuses stack multiplicatively). */
export function bypassNow(content: Content, state: BattleState): number {
  const a = currentIntent(content, state).bypass ?? 0;
  const b = enemyDef(content, state).passive?.bypass ?? 0;
  const c = statusMods(content, state).bypass;
  return 1 - (1 - a) * (1 - b) * (1 - c);
}

/** Share of bot traffic filtered this turn (WAF, rate limit and statuses stack multiplicatively; `bypass` slips past part of it). */
export function botCutNow(content: Content, state: BattleState, bypass = 0): number {
  return (1 - (1 - state.waf) * (1 - state.temp.botCut) * (1 - statusMods(content, state).botCut) * (1 - moduleCut(content, state))) * (1 - bypass);
}

export function canPlay(content: Content, state: BattleState, uid: number): boolean {
  if (state.phase !== 'player') return false;
  const inst = state.hand.find((c) => c.uid === uid);
  if (!inst) return false;
  const def = cardDef(content, inst.id);
  return !def.unplayable && def.cost <= state.ops && (!def.fits || placements(content, state, uid).length > 0);
}

// ---------------------------------------------------------------- design helpers

export const nodeOf = (design: Design, id: string) => design.nodes.find((n) => n.id === id);

/** Whether a call into `from` ends up at `to`: directly, or through nodes a module put in between (a cache, a queue). */
function leadsTo(design: Design, from: string, to: string, hops = 4): boolean {
  if (from === to) return true;
  const kind = nodeOf(design, from)?.kind;
  if (!hops || (kind !== 'cache' && kind !== 'queue')) return false;
  return design.edges.some((e) => e.source === from && leadsTo(design, e.target, to, hops - 1));
}

/** The call from `source` towards `target` (through any cache or queue a module put in between). */
export const edgeAt = (design: Design, [source, target]: [string, string]) => design.edges.find((e) => e.source === source && leadsTo(design, e.target, target));

// ---------------------------------------------------------------- chassis (the system built on)

export function chassisDef(content: Content, id?: string): ChassisDef {
  return content.chassis.find((c) => c.id === id) ?? content.chassis[0];
}
export const chassisOf = (content: Content, state: Pick<BattleState, 'chassis'>) => chassisDef(content, state.chassis);
/** The node id behind a role the content names (`api`, `db`, `ext`) in this fight's system. */
export const alias = (content: Content, state: Pick<BattleState, 'chassis'>, ref: NodeRef | 'ext') => chassisOf(content, state).aliases[ref];
export const budgetOf = (content: Content, state: Pick<BattleState, 'chassis'>) => chassisOf(content, state).budgetPerHour ?? content.battle.budgetPerHour;
/** The main service's call to its data (cache or DB): where call policies from outside a socket (relics) go. */
export const mainCall = (content: Content, state: Pick<BattleState, 'chassis'>, design: Design) => edgeAt(design, [alias(content, state, 'api'), alias(content, state, 'db')]);

// ---------------------------------------------------------------- modules (infrastructure plugged into sockets)

/** Effects that change the topology: from a socketed card they live in its module, so removing it undoes them. */
const DESIGN_OPS = new Set<Effect['op']>(['cache', 'edge', 'tune', 'scale', 'autoscale', 'queue', 'cdn', 'shard']);
/** Effects that only work while their module is in (read by the rules, not built into the design). */
const MODULE_OPS = new Set<Effect['op']>(['edgeFilter', 'foresee', 'trace', 'alert']);
/** Effects that add nodes: built after the others, so a call policy follows the call into the new node and a shard copies a tuned DB. */
const TOPOLOGY = new Set<Effect['op']>(['cache', 'queue', 'cdn', 'shard']);

export const modulesOf = (state: BattleState): ModuleInst[] => state.modules ?? [];
/** The system's sockets, with the room relics add. */
export function socketsOf(content: Content, state: BattleState): SocketDef[] {
  const bonus: Partial<Record<SocketKind, number>> = {};
  for (const id of state.relics ?? []) for (const [k, n] of Object.entries(content.relics.find((r) => r.id === id)?.sockets ?? {})) bonus[k as SocketKind] = (bonus[k as SocketKind] ?? 0) + n!;
  const list = chassisOf(content, state).sockets;
  return Object.keys(bonus).length ? list.map((s) => (bonus[s.kind] ? { ...s, cap: s.cap + bonus[s.kind]! } : s)) : list;
}
export const socketOf = (content: Content, state: BattleState, id: string) => socketsOf(content, state).find((x) => x.id === id);
export const modulesAt = (state: BattleState, socket: string) => modulesOf(state).filter((m) => m.socket === socket);
/** The installed module of a card (either copy, upgraded or not). */
export const moduleOf = (state: BattleState, card: string) => modulesOf(state).find((m) => baseId(m.card) === baseId(card));

/** A way to play a socketed card: into `socket`, taking out module `replace` when the socket is full. */
export type Placement = { socket: string; replace?: number };

/**
 * Where a card in hand can go. A card already installed levels its module up (its own socket);
 * otherwise every fitting socket with room, and every module of a full fitting socket as a replacement.
 * Empty for a card with no `fits`, or when the system has no socket it fits.
 */
export function placements(content: Content, state: BattleState, uid: number): Placement[] {
  const inst = state.hand.find((c) => c.uid === uid);
  return inst ? placementsOf(content, state, inst.id) : [];
}

/** `placements` for a card id (any copy of it). */
export function placementsOf(content: Content, state: BattleState, card: string): Placement[] {
  const def = cardDef(content, card);
  if (!def.fits) return [];
  const cur = moduleOf(state, def.id);
  if (cur) return [{ socket: cur.socket }];
  const out: Placement[] = [];
  for (const sk of socketsOf(content, state)) {
    if (!def.fits.includes(sk.kind) || sk.cap <= 0) continue;
    const here = modulesAt(state, sk.id);
    if (here.length < sk.cap) out.push({ socket: sk.id });
    else for (const m of here) out.push({ socket: sk.id, replace: m.uid });
  }
  return out;
}

/** The node a module adds to the system (a cache, a queue), if it adds one. */
export function insertedNode(content: Content, m: ModuleInst): string | undefined {
  const ops = cardDef(content, m.card).effects.map((e) => e.op);
  return ops.includes('cache') ? 'cache' : ops.includes('queue') ? 'queue' : ops.includes('cdn') ? `cdn@${m.socket}` : undefined;
}

/** The installed modules' effects of one kind, with each module's level. */
function moduleEffects<K extends Effect['op']>(content: Content, state: BattleState, op: K): { e: Extract<Effect, { op: K }>; level: number }[] {
  const out: { e: Extract<Effect, { op: K }>; level: number }[] = [];
  for (const m of modulesOf(state)) for (const e of cardDef(content, m.card).effects) if (e.op === op) out.push({ e: e as Extract<Effect, { op: K }>, level: m.level });
  return out;
}

/** Turns ahead the player sees (observability modules). */
export const foresightOf = (content: Content, state: BattleState) => Math.max(0, ...moduleEffects(content, state, 'foresee').map(({ e, level }) => Math.min(e.max, e.n * level)));
/** The forecast marks the bottleneck (tracing). */
export const tracing = (content: Content, state: BattleState) => moduleEffects(content, state, 'trace').length > 0;
/** Extra cards drawn after a turn where a node failed (alerting). */
export const alertDrawOf = (content: Content, state: BattleState) => moduleEffects(content, state, 'alert').reduce((sum, { e, level }) => sum + e.draw * level, 0);

/** An intent of the list as it would play at `step`: the variant that answers the build as it is now, with its escalation. */
function intentAt(content: Content, state: BattleState, index: number, step: number): Intent {
  const def = enemyDef(content, state);
  const list = intentsNow(content, state);
  const base = list[index];
  const t = designTraits(content, state);
  const v = base.variants?.find((x) => matchesWhen(x.when, t));
  const { variants: _variants, ...plain } = base;
  const { when: _when, ...over } = v ?? { when: {} };
  const merged: Intent = { ...plain, ...over };
  const loop = Math.floor(step / list.length);
  return { ...merged, botRps: Math.round(merged.botRps * (1 + def.escalation * loop) * (state.enemy.rps ?? 1)) };
}

/**
 * The attacker's next turns, as far as `n` turns (observability). A fixed cycle is exact (with the
 * variant the build as it is now would draw); a random enemy gives the odds of its next turn only.
 * A boss switching phase is not foreseen.
 */
export function upcomingIntents(content: Content, state: BattleState, n: number): { intent: Intent; chance: number }[][] {
  const list = intentsNow(content, state);
  if (enemyDef(content, state).pattern === 'weighted') {
    const recent = [...(state.enemy.recent ?? [])];
    const banned = recent.length >= 2 && recent.at(-1) === recent.at(-2) ? recent.at(-1) : undefined;
    const w = list.map((it, i) => (i === banned ? 0 : (it.weight ?? 1)));
    const total = w.reduce((a, b) => a + b, 0);
    const odds = list.map((_, i) => ({ intent: intentAt(content, state, i, state.enemy.step + 1), chance: w[i] / total })).filter((o) => o.chance > 0);
    return n > 0 ? [odds.sort((a, b) => b.chance - a.chance)] : [];
  }
  const out: { intent: Intent; chance: number }[][] = [];
  for (let k = 1; k <= n; k++) {
    const step = state.enemy.step + k;
    out.push([{ intent: intentAt(content, state, step % list.length, step), chance: 1 }]);
  }
  return out;
}

/** Bot traffic the modules filter while they are in (an edge filter). */
export function moduleCut(content: Content, state: BattleState): number {
  let pass = 1;
  for (const m of modulesOf(state))
    for (const e of cardDef(content, m.card).effects) if (e.op === 'edgeFilter') pass *= 1 - Math.min(e.max, e.cut * m.level);
  return 1 - pass;
}

/** The placement a play resolves to: a level up wherever it was dropped, the one asked for, else the first free socket (null: no valid move). */
function resolvePlacement(content: Content, state: BattleState, uid: number, opts: Partial<Placement>): Placement | null {
  const moves = placements(content, state, uid);
  if (moduleOf(state, cardOf(state, uid))) return moves[0] ?? null;
  if (opts.socket === undefined && opts.replace === undefined) return moves.find((m) => m.replace === undefined) ?? null;
  return moves.find((m) => (opts.socket === undefined || m.socket === opts.socket) && m.replace === opts.replace) ?? null;
}
const cardOf = (state: BattleState, uid: number) => state.hand.find((c) => c.uid === uid)!.id;

/** Where an effect lands: the socket's node or call, else the system's main roles. */
type Place = { node?: string; edge: [string, string]; before: string; aliases: ChassisDef['aliases']; socket?: string };
function placeOf(chassis: ChassisDef, socket?: SocketDef): Place {
  const a = chassis.aliases;
  const p: Place = { edge: [a.api, a.db], before: a.db, aliases: a };
  if (!socket) return p;
  p.socket = socket.id;
  if ('node' in socket.at) p.node = socket.at.node;
  if ('before' in socket.at) p.before = socket.at.before;
  if ('edge' in socket.at) p.edge = socket.at.edge;
  return p;
}
const nodeAt = (p: Place, ref?: NodeRef) => p.node ?? p.aliases[ref ?? 'api'];

/** The fight's topology: the chassis (with permanent scaling and relics) plus every module, node-adding ones last. */
export function designOf(content: Content, state: BattleState): Design {
  const design = clone(state.design);
  const chassis = chassisOf(content, state);
  // policies and tuning first, then nodes put in front, then shards (which split whatever sits in front of the DB)
  const rank = (m: ModuleInst) => {
    const ops = cardDef(content, m.card).effects.map((e) => e.op);
    return ops.includes('shard') ? 2 : ops.some((op) => TOPOLOGY.has(op)) ? 1 : 0;
  };
  const ordered = [...modulesOf(state)].sort((x, y) => rank(x) - rank(y));
  for (const m of ordered) {
    const place = placeOf(chassis, socketOf(content, state, m.socket));
    for (const e of cardDef(content, m.card).effects) if (DESIGN_OPS.has(e.op)) applyDesign(design, e, m.level, place);
  }
  // KEDA: the queue's workers scale with its backlog
  const queue = nodeOf(design, 'queue');
  if (queue && activeCombos(content, state).some((c) => c.flag === 'keda'))
    queue.config!.autoscale = { min: 1, max: 5, targetUtilization: 0.7, evalEveryMs: 1000, stabilizationMs: 5000, podStartMs: 3000, metric: 'queueLength', targetQueuePerInstance: 200 } as never;
  return design;
}

/** One module effect on a design, `level` times (a cache grows by `step` per extra level instead). */
function applyDesign(design: Design, e: Effect, level: number, place: Place) {
  switch (e.op) {
    case 'scale': {
      const cfg = nodeOf(design, nodeAt(place, e.node))!.config!;
      cfg.instances = (cfg.instances ?? 1) + e.n * level;
      break;
    }
    case 'cache': {
      const model = nodeOf(design, 'cache')?.config?.cache;
      if (model) model.capacity = Math.min(e.max, model.capacity + e.step * level);
      else addCache(design, place.before, Math.min(e.max, e.capacity + e.step * (level - 1)));
      break;
    }
    case 'edge': {
      const call = edgeAt(design, place.edge);
      if (call) Object.assign(call, clone(e.patch));
      break;
    }
    case 'tune':
      for (let i = 0; i < level; i++) tuneNode(design, nodeAt(place, e.node), e.mul);
      break;
    case 'autoscale': {
      const cfg = nodeOf(design, nodeAt(place, 'api'))!.config!;
      const n = cfg.instances ?? 1;
      cfg.autoscale = { min: n, max: n + e.extra, targetUtilization: e.target, evalEveryMs: 1000, stabilizationMs: 5000, podStartMs: e.podStartMs, metric: 'utilization' } as never;
      break;
    }
    case 'cdn': {
      const id = `cdn@${place.socket ?? 'edge'}`;
      const model = nodeOf(design, id)?.config?.cache;
      if (model) break;
      insertBefore(design, place.before, {
        id,
        kind: 'cache',
        label: 'CDN',
        position: { x: 0, y: 0 },
        config: {
          instances: 1,
          concurrency: 20000,
          queueSize: 0,
          latencyP50Ms: 0.5,
          latencyP99Ms: 2,
          costPerHour: 0.1,
          cache: { keys: CACHE_KEYS, zipf: CACHE_ZIPF, capacity: Math.min(e.max, e.capacity + e.step * (level - 1)), ttlMs: CACHE_TTL_MS, coalesce: false, staleWhileRevalidate: false, warm: true },
        },
      } as DesignNode);
      break;
    }
    case 'shard': {
      const db = nodeAt(place, 'db');
      const base = nodeOf(design, db);
      if (!base || nodeOf(design, `${db}-2`)) break;
      const router: DesignNode = { id: `${db}-router`, kind: 'loadBalancer', label: 'Router shard', position: { x: 0, y: 0 }, config: { instances: 1, concurrency: 20000, queueSize: 0, latencyP50Ms: 0.1, latencyP99Ms: 0.5, costPerHour: 0.02 } } as DesignNode;
      insertBefore(design, db, router);
      design.nodes.push({ ...clone(base), id: `${db}-2`, label: 'Shard 2', config: { ...clone(base.config!), costPerHour: e.costPerHour } } as DesignNode);
      design.edges.push({ source: router.id, target: `${db}-2`, latencyMs: 1 } as DesignEdge);
      break;
    }
    case 'queue': {
      const [source, target] = place.node ? [place.aliases.api, place.aliases.ext] : place.edge;
      const call = design.edges.find((x) => x.source === source && x.target === target);
      if (!call) break;
      call.target = 'queue';
      design.nodes.push({
        id: 'queue',
        kind: 'queue',
        label: 'Queue',
        position: { x: 0, y: 0 },
        config: { instances: 1, concurrency: e.consumers, queueSize: e.queueSize, latencyP50Ms: 0.2, latencyP99Ms: 1, costPerHour: 0.05 },
      } as DesignNode);
      design.edges.push({ source: 'queue', target, latencyMs: 1 } as DesignEdge);
      break;
    }
  }
}

function tuneNode(design: Design, node: string, m: TuneMul) {
  const cfg = nodeOf(design, node)!.config!;
  const round2 = (v: number) => Math.round(v * 100) / 100;
  if (m.latency !== undefined) {
    cfg.latencyP50Ms = round2((cfg.latencyP50Ms ?? 1) * m.latency);
    cfg.latencyP99Ms = round2((cfg.latencyP99Ms ?? 1) * m.latency);
  }
  if (m.concurrency !== undefined) cfg.concurrency = Math.max(1, Math.round((cfg.concurrency ?? 1) * m.concurrency));
  if (m.queueSize !== undefined) cfg.queueSize = Math.max(0, Math.round((cfg.queueSize ?? 0) * m.queueSize));
  if (m.cost !== undefined) cfg.costPerHour = round2((cfg.costPerHour ?? 0) * m.cost);
}

/** Install a socketed card's module, or level it up when that card's module is already in. */
function installModule(content: Content, state: BattleState, def: CardDef, socket: string) {
  const cur = moduleOf(state, def.id);
  if (cur) {
    cur.level++;
    if (def.upgraded) cur.card = def.id;
    return;
  }
  const hadCache = !!nodeOf(designOf(content, state), 'cache');
  (state.modules ??= []).push({ uid: state.nextUid++, card: def.id, level: 1, socket });
  if (!hadCache && nodeOf(designOf(content, state), 'cache')) state.cache = { ...state.cache, placed: state.turn };
}

function removeModule(content: Content, state: BattleState, uid: number) {
  state.modules = modulesOf(state).filter((m) => m.uid !== uid);
  if (!state.modules.length) delete state.modules;
  // a cache built again later starts cold
  if (!nodeOf(designOf(content, state), 'cache') && state.cache) delete state.cache.placed;
}

/** Key space of the battle's traffic: 10k keys with web-like popularity (zipf 1). */
export const CACHE_KEYS = 10_000;
export const CACHE_ZIPF = 1;
export const CACHE_TTL_MS = 30_000;

/** Put `node` in front of `before`: every call into `before` now goes into it (with its policy), and it calls `before`. */
function insertBefore(design: Design, before: string, node: DesignNode) {
  design.nodes.splice(Math.max(0, design.nodes.findIndex((n) => n.id === before)), 0, node);
  for (const e of design.edges) if (e.target === before) e.target = node.id;
  design.edges.push({ source: node.id, target: before, latencyMs: 1 } as DesignEdge);
}

function addCache(design: Design, before: string, capacity: number) {
  const node: DesignNode = {
    id: 'cache',
    kind: 'cache',
    label: 'Redis',
    position: { x: 0, y: 0 },
    config: {
      instances: 1,
      concurrency: 2000,
      queueSize: 1000,
      latencyP50Ms: 0.5,
      latencyP99Ms: 2,
      costPerHour: 0.15,
      cache: { keys: CACHE_KEYS, zipf: CACHE_ZIPF, capacity, ttlMs: CACHE_TTL_MS, coalesce: false, staleWhileRevalidate: false, warm: true },
    },
  };
  design.nodes.splice(design.nodes.findIndex((n) => n.id === before), 0, node);
  const old = design.edges.find((e) => e.target === before)!;
  // the caller's call policy (timeout, retry, breaker) moves to the call into the cache
  const toCache: DesignEdge = { ...old, target: 'cache' };
  const toDb: DesignEdge = { source: 'cache', target: before, latencyMs: 1 };
  design.edges = design.edges.filter((e) => e !== old).concat(toCache, toDb);
}

// ---------------------------------------------------------------- setup

function draw(state: BattleState, n: number) {
  for (let i = 0; i < n; i++) {
    if (state.drawPile.length === 0) {
      if (state.discard.length === 0) return;
      state.drawPile = shuffle(state, state.discard);
      state.discard = [];
    }
    state.hand.push(state.drawPile.pop()!);
  }
}

export function newBattle(content: Content, seed: number, setup: BattleSetup = {}): BattleState {
  const b = content.battle;
  const enemyId = setup.enemy ?? b.enemy;
  const chassis = chassisDef(content, setup.chassis);
  const enemy = content.enemies.find((e) => e.id === enemyId);
  if (!enemy) throw new Error(`unknown enemy ${enemyId}`);
  const maxHp = setup.maxHp ?? b.hp;
  const scale = setup.enemyScale ?? { hp: 1, rps: 1 };
  const enemyHp = Math.round(enemy.hp * scale.hp);
  const state: BattleState = {
    seed,
    rng: seed >>> 0,
    turn: 1,
    phase: 'player',
    hp: Math.min(maxHp, setup.hp ?? maxHp),
    maxHp,
    headroom: 0,
    ops: b.opsPerTurn,
    drawPile: [],
    hand: [],
    discard: [],
    exhausted: [],
    chassis: chassis.id,
    design: clone(chassis.design),
    waf: 0,
    temp: { api: 0, db: 0, botCut: 0, hotfix: false },
    enemy: { id: enemy.id, hp: enemyHp, maxHp: enemyHp, step: 0, ...(scale.rps !== 1 && { rps: scale.rps }), ...(scale.hp > 1 && { minionHp: scale.hp }) },
    played: [],
    reports: [],
    nextUid: 1,
    relics: (setup.relics ?? []).filter((id) => content.relics.some((r) => r.id === id)),
    relicCount: {},
    relicFired: [],
    ...(setup.legitScale && setup.legitScale !== 1 && { legitMul: setup.legitScale }),
  };
  for (const id of enemy.minions ?? []) summon(content, state, id, 1);
  const deck: CardInst[] = (setup.deck ?? b.startingDeck).map((id) => ({ uid: state.nextUid++, id }));
  state.drawPile = shuffle(state, deck);
  draw(state, b.handSize);
  pickIntent(content, state);
  fireRelics(content, state, 'battleStart');
  fireRelics(content, state, 'turnStart');
  chooseVariant(content, state);
  if (state.enemy.hp <= 0) state.phase = 'won';
  return state;
}

/** Run the effects of the relics listening to `trigger` (cardPlayed: for a card of type `type`). */
function fireRelics(content: Content, state: BattleState, trigger: RelicDef['trigger'], type?: CardDef['type']) {
  for (const id of state.relics) {
    const relic = content.relics.find((r) => r.id === id);
    if (!relic || relic.trigger !== trigger) continue;
    if (trigger === 'cardPlayed') {
      if (relic.cardType && relic.cardType !== type) continue;
      if (relic.every) {
        state.relicCount[id] = (state.relicCount[id] ?? 0) + 1;
        if (state.relicCount[id] % relic.every !== 0) continue;
      }
    }
    for (const effect of relic.effects) apply(content, state, effect);
    state.relicFired.push(id);
  }
}

// ---------------------------------------------------------------- playing cards

function apply(content: Content, state: BattleState, effect: Effect) {
  switch (effect.op) {
    case 'scale': {
      if (effect.temp) {
        state.temp[effect.node] += effect.n;
      } else {
        const cfg = nodeOf(state.design, alias(content, state, effect.node))!.config!;
        cfg.instances = (cfg.instances ?? 1) + effect.n;
      }
      break;
    }
    case 'cache': {
      const model = nodeOf(state.design, 'cache')?.config?.cache;
      if (model) model.capacity = Math.min(effect.max, model.capacity + effect.step);
      else {
        addCache(state.design, alias(content, state, 'db'), effect.capacity);
        state.cache = { ...state.cache, placed: effect.warm ? 0 : state.turn };
      }
      break;
    }
    case 'cacheOpt':
      state.cache = { ...state.cache, ...(effect.swr && { swr: true }), ...(effect.normalize && { normalize: Math.max(state.cache?.normalize ?? 1, effect.normalize) }) };
      break;
    case 'restart':
      delete state.enemy.leak;
      state.temp.api -= 1;
      break;
    case 'edge':
      Object.assign(mainCall(content, state, state.design)!, clone(effect.patch));
      break;
    case 'rateLimit':
      state.temp.botCut = 1 - (1 - state.temp.botCut) * (1 - effect.cut);
      break;
    case 'waf':
      state.waf = Math.min(effect.max, state.waf + effect.cut);
      break;
    case 'attack':
      hitEnemy(content, state, effect.dmg);
      break;
    case 'headroom':
      state.headroom += effect.n;
      break;
    case 'draw':
      draw(state, effect.n);
      break;
    case 'ops':
      state.ops += effect.n;
      break;
    case 'hotfix':
      state.temp.hotfix = true;
      break;
    case 'tune':
      tuneNode(state.design, alias(content, state, effect.node), effect.mul);
      break;
    case 'edgeFilter':
      // outside a socket (a relic): a permanent filter, like a WAF rule
      state.waf = Math.min(effect.max, state.waf + effect.cut);
      break;
    case 'autoscale':
    case 'queue':
    case 'cdn':
    case 'shard':
      // relics and other unslotted sources: straight into the base design
      applyDesign(state.design, effect, 1, placeOf(chassisOf(content, state)));
      break;
    case 'purge': {
      const curses = state.hand.filter((c) => cardDef(content, c.id).unplayable);
      if (!curses.length) break;
      state.hand = state.hand.filter((c) => !curses.includes(c));
      state.exhausted.push(...curses);
      if (effect.draw) draw(state, curses.length);
      break;
    }
    case 'status':
      addStatus(content, state, effect.status, effect.turns, effect.stacks);
      break;
    case 'cleanse': {
      const debuffs = (state.statuses ?? []).filter((x) => statusDef(content, x.id).kind === 'debuff');
      const gone = new Set(debuffs.slice(effect.n === undefined ? 0 : Math.max(0, debuffs.length - effect.n)));
      state.statuses = (state.statuses ?? []).filter((x) => !gone.has(x));
      if (!state.statuses.length) delete state.statuses;
      break;
    }
  }
}

/**
 * Play a card from hand. A socketed card goes where `opts` says (see `placements`): into `socket`,
 * taking out module `replace` when it is full. Without `opts`, the first fitting socket with room.
 */
export function playCard(content: Content, prev: BattleState, uid: number, opts: Partial<Placement> = {}): BattleState {
  if (!canPlay(content, prev, uid)) return prev;
  const fits = !!cardDef(content, cardOf(prev, uid)).fits;
  const place = fits ? resolvePlacement(content, prev, uid, opts) : null;
  if (fits && !place) return prev;
  const state = clone(prev);
  state.relicFired = [];
  const idx = state.hand.findIndex((c) => c.uid === uid);
  const [inst] = state.hand.splice(idx, 1);
  const def = cardDef(content, inst.id);
  state.ops -= def.cost;
  state.played.push(def.id);
  // the card leaves the hand before its effects, so "draw" cannot redraw it
  (def.exhaust ? state.exhausted : state.discard).push(inst);
  if (place) {
    if (place.replace !== undefined) removeModule(content, state, place.replace);
    installModule(content, state, def, place.socket);
  }
  for (const effect of def.effects) if (!(def.fits && (DESIGN_OPS.has(effect.op) || MODULE_OPS.has(effect.op)))) apply(content, state, effect);
  fireRelics(content, state, 'cardPlayed', def.type);
  if (state.enemy.hp <= 0) {
    state.phase = 'won';
    state.minions = [];
    delete state.target;
  }
  return state;
}

// ---------------------------------------------------------------- end of turn

/** Design and scenario the engine must run for this turn (does not change the state). */
export function planTurn(content: Content, state: BattleState): TurnPlan {
  const b = content.battle;
  const intent = currentIntent(content, state);
  const raw = botRpsNow(content, state);
  const cut = botCutNow(content, state, bypassNow(content, state));
  const botPassed = Math.round(raw * (1 - cut));
  const mods = statusMods(content, state);

  const design = designOf(content, state);
  const id = (ref: NodeRef | 'ext') => alias(content, state, ref);
  for (const node of ['api', 'db'] as const) {
    const cfg = nodeOf(design, id(node))!.config!;
    const before = cfg.instances ?? 1;
    cfg.instances = Math.max(1, before + state.temp[node] + mods[`${node}Instances`]);
    // the autoscaler starts from this turn's count and keeps its headroom
    const auto = cfg.autoscale as { min: number; max: number } | undefined;
    if (auto) Object.assign(auto, { min: cfg.instances, max: cfg.instances + auto.max - auto.min });
    // statuses are not incidents: Hotfix does not cancel them
    if (mods.cost !== 1) cfg.costPerHour = Math.round((cfg.costPerHour ?? 0) * mods.cost * 1000) / 1000;
  }
  const hotfix = state.temp.hotfix;
  const passive = enemyDef(content, state).passive;
  const events: object[] = [];
  const client = design.edges.find((e) => e.source === 'client')!;
  // the leak is state, not an incident: Hotfix does not cancel it, a restart does
  let apiSlow = (1 + leakNow(state, intent)) * mods.apiLatency;
  let dbSlow = mods.dbLatency;
  if (!hotfix) {
    if (intent.chaos?.action === 'latency' && intent.chaos.node === 'api') apiSlow *= intent.chaos.value;
    else if (intent.chaos?.action === 'latency' && intent.chaos.node === 'db') dbSlow *= intent.chaos.value;
    else if (intent.chaos) events.push({ atMs: 0, node: id(intent.chaos.node), action: intent.chaos.action, value: intent.chaos.value });
    const shield = activeCombos(content, state).some((c) => c.flag === 'retryShield');
    if (intent.clientRetries && !shield) Object.assign(client, { retries: intent.clientRetries, backoffMs: 0, jitter: false });
    if (intent.squeeze) {
      const cfg = nodeOf(design, id(intent.squeeze.node))!.config!;
      cfg.concurrency = Math.max(1, Math.round((cfg.concurrency ?? 1) * intent.squeeze.concurrency));
    }
  }
  if (apiSlow > 1.001) events.push({ atMs: 0, node: id('api'), action: 'latency', value: Math.round(apiSlow * 100) / 100 });
  if (dbSlow > 1.001) events.push({ atMs: 0, node: id('db'), action: 'latency', value: Math.round(dbSlow * 100) / 100 });
  // not incidents either: the attacker's traffic is simply expensive or heavy
  if (intent.costSpike) {
    const cfg = nodeOf(design, id('api'))!.config!;
    cfg.costPerHour = Math.round((cfg.costPerHour ?? 0) * intent.costSpike * 1000) / 1000;
  }
  if (intent.bandwidth) Object.assign(client, { responseKb: intent.bandwidth.responseKb, bandwidthMbps: intent.bandwidth.mbps });
  // every cache answers to the cache settings and the attacker's busting; only the Redis a card built starts cold
  for (const node of design.nodes) {
    const model = node.kind === 'cache' ? node.config?.cache : undefined;
    if (!model) continue;
    const opts = state.cache ?? {};
    model.warm = node.id !== 'cache' || (opts.placed ?? 0) < state.turn;
    if (opts.swr) model.staleWhileRevalidate = true;
    // a boss passive is not an incident: Hotfix does not cancel it
    const bust = 1 - (1 - (hotfix ? 0 : (intent.cacheBust ?? 0))) * (1 - (passive?.cacheBust ?? 0));
    model.zipf = Math.round(CACHE_ZIPF * (1 - bust / (opts.normalize ?? 1)) * 1000) / 1000;
    if (!hotfix && intent.cacheTtlMs) model.ttlMs = intent.cacheTtlMs;
  }
  const legitRps = legitRpsNow(content, state);
  return {
    intent,
    legitRps,
    botRps: raw,
    botBlockedRps: raw - botPassed,
    input: {
      design,
      scenario: {
        seed: state.seed * 1000 + state.turn,
        durationMs: b.turnMs,
        timeoutMs: 1000,
        traffic: intent.burst
          ? [
              { atMs: 0, rps: legitRps + botPassed },
              { atMs: intent.burst.atMs, rps: legitRps + Math.round(botPassed * intent.burst.mul) },
              { atMs: intent.burst.atMs + intent.burst.ms, rps: legitRps + botPassed },
            ]
          : [{ atMs: 0, rps: legitRps + botPassed }],
        slo: { p99Ms: b.sloP99Ms, errorRate: 0.01 },
        events,
      },
    },
  };
}

/** API memory leak this turn: what built up, plus this turn's intent. */
export function leakNow(state: BattleState, intent: Intent): number {
  return Math.round(((state.enemy.leak ?? 0) + (intent.leak ?? 0)) * 100) / 100;
}

/** Whether the turn's intent has incidents Hotfix cancels. */
export function hotfixable(intent: Intent): boolean {
  return !!(intent.chaos || intent.clientRetries || intent.cacheBust || intent.cacheTtlMs || intent.squeeze);
}

/** Damage both sides take for a turn, from the engine's summary. Shared by the preview and `resolveTurn`. */
export function scoreTurn(content: Content, state: BattleState, plan: TurnPlan, summary: Summary): TurnScore {
  const b = content.battle;
  const sec = b.turnMs / 1000;
  // async work a queue accepted but lost (failed, or still waiting when the turn ends), for the real users' share
  const sent = plan.legitRps + plan.botRps - plan.botBlockedRps;
  const lostAsync = (summary.asyncErr ?? 0) + (summary.backlog ?? 0);
  const legitFailed = Math.round(summary.errorRate * plan.legitRps * sec + (sent > 0 ? (lostAsync * plan.legitRps) / sent : 0));
  const failed = Math.round(legitFailed / b.failedPerDamage);
  const latency = summary.p99Ms > b.sloP99Ms ? b.latencyDamage : 0;
  const over = summary.costPerHour - budgetOf(content, state);
  const budget = over > 0.001 ? Math.ceil(over * b.overBudgetDamage) : 0;
  const raw = failed + latency + budget;
  const absorbed = Math.min(state.headroom, raw);
  const total = Math.min(b.maxDamagePerTurn, raw - absorbed);
  const capped = raw - absorbed - total;
  const enemyDamage = Math.floor(((plan.botBlockedRps * sec) / b.blockedPerDamage) * statusMods(content, state).blockedDamage);
  return { legitFailed, damage: { failed, latency, budget, absorbed, capped, total }, enemyDamage };
}

/** Apply the engine's verdict for the turn, run the attacker's side effects and start the next turn. */
/** The turn's most loaded nodes, from the engine's per-second windows (node order = the design's). */
export function hotNodes(design: Design, windows: { nodes: { utilization: number; down: boolean; rejected: number }[] }[], n = 3): HotNode[] {
  const out = design.nodes.map((node, k) => {
    let util = 0;
    let down = false;
    let rejected = 0;
    for (const w of windows) {
      const x = w.nodes[k];
      if (!x) continue;
      util = Math.max(util, x.utilization);
      down ||= x.down;
      rejected += x.rejected;
    }
    return { node: node.id, kind: node.kind, label: node.label ?? node.id, util: Math.round(util * 100) / 100, down, rejected };
  });
  return out
    .filter((h) => h.kind !== 'client' && (h.util > 0 || h.down || h.rejected > 0))
    .sort((a, b) => Number(b.down) - Number(a.down) || b.rejected - a.rejected || b.util - a.util)
    .slice(0, n);
}

export function resolveTurn(content: Content, prev: BattleState, plan: TurnPlan, summary: Summary, hot?: HotNode[]): BattleState {
  const b = content.battle;
  const state = clone(prev);
  state.relicFired = [];
  const sec = b.turnMs / 1000;
  const notes: string[] = [];

  const score = scoreTurn(content, state, plan, summary);
  const { legitFailed, enemyDamage } = score;
  const { latency, budget, absorbed, capped, total } = score.damage;

  if (legitFailed > 0) notes.push(`${legitFailed.toLocaleString('vi-VN')} request của người dùng thật bị lỗi`);
  if (latency) notes.push(`p99 ${Math.round(summary.p99Ms)}ms vượt SLO ${b.sloP99Ms}ms`);
  if (budget) notes.push(`Vượt ngân sách: $${summary.costPerHour.toFixed(2)}/h > $${budgetOf(content, state).toFixed(2)}/h`);
  if (absorbed) notes.push(`Headroom hấp thụ ${absorbed} sát thương`);
  if (capped) notes.push(`Sát thương tối đa ${b.maxDamagePerTurn}/lượt (bỏ qua ${capped})`);
  const lostAsync = (summary.asyncErr ?? 0) + (summary.backlog ?? 0);
  if (lostAsync > 0) notes.push(`Hàng đợi: ${lostAsync.toLocaleString('vi-VN')} việc lỗi hoặc còn tồn cuối lượt`);
  if (enemyDamage) notes.push(`Chặn ${Math.round(plan.botBlockedRps * sec).toLocaleString('vi-VN')} request bot`);
  if (state.temp.hotfix && hotfixable(plan.intent)) notes.push('Hotfix đã chặn hiệu ứng sự cố');
  if (plan.intent.costSpike) notes.push(`${plan.intent.label}: chi phí API ×${plan.intent.costSpike}`);

  state.hp = Math.max(0, state.hp - total);
  const guarded = guardNow(content, state);
  const hit = hitEnemy(content, state, enemyDamage);
  if (hit.minion) notes.push(`${hit.minion} mất ${hit.dealt} máu${hit.killed ? ' và bị hạ' : ''}`);
  else if (hit.dealt < enemyDamage && guarded > 0) notes.push(`Lính che chắn: địch chỉ mất ${hit.dealt}/${enemyDamage} máu`);

  if (plan.intent.heal && state.enemy.hp > 0) {
    state.enemy.hp = Math.min(state.enemy.maxHp, state.enemy.hp + plan.intent.heal);
    notes.push(`${enemyDef(content, state).name} hồi ${plan.intent.heal} máu`);
  }
  if (plan.intent.addCards) {
    const { card, n } = plan.intent.addCards;
    for (let i = 0; i < n; i++) state.discard.push({ uid: state.nextUid++, id: card });
    notes.push(`${n} lá ${cardDef(content, card).name} bị nhét vào bộ bài`);
  }
  const regen = enemyDef(content, state).passive?.regen;
  if (regen && state.enemy.hp > 0 && state.enemy.hp < state.enemy.maxHp) {
    state.enemy.hp = Math.min(state.enemy.maxHp, state.enemy.hp + regen);
    notes.push(`${enemyDef(content, state).passive!.label}: hồi ${regen} máu`);
  }
  const healers = minionsOf(state).filter((m) => minionDef(content, m.id).heal);
  if (healers.length && state.enemy.hp > 0 && state.enemy.hp < state.enemy.maxHp) {
    const amount = healers.reduce((sum, m) => sum + minionDef(content, m.id).heal!, 0);
    state.enemy.hp = Math.min(state.enemy.maxHp, state.enemy.hp + amount);
    notes.push(`Lính hồi cho ${enemyDef(content, state).name} ${amount} máu`);
  }
  if (plan.intent.summon && state.enemy.hp > 0) {
    const called = summon(content, state, plan.intent.summon.minion, plan.intent.summon.n);
    const name = minionDef(content, plan.intent.summon.minion).name;
    notes.push(called ? `${enemyDef(content, state).name} gọi thêm ${called} ${name}` : `Đã đủ ${MAX_MINIONS} lính, không gọi thêm được`);
  }
  if (plan.intent.wafStrip && state.waf > 0) {
    state.waf = Math.max(0, Math.round((state.waf - plan.intent.wafStrip) * 100) / 100);
    notes.push(`${plan.intent.label}: WAF còn ${Math.round(state.waf * 100)}%`);
  }
  if (plan.intent.bypass) notes.push(`${Math.round(plan.intent.bypass * 100)}% bộ lọc bị lách`);
  const leak = leakNow(state, plan.intent);
  if (plan.intent.leakReset) {
    if (leak) notes.push('Pod tự khởi động lại: hết rò rỉ bộ nhớ');
    delete state.enemy.leak;
  } else if (plan.intent.leak) {
    state.enemy.leak = leak;
    notes.push(`Rò rỉ bộ nhớ tích tụ: API chậm ×${(1 + leak).toFixed(1)} tới khi restart`);
  }
  // statuses: the turn's ones lose a turn, then the attacker's new ones start (they count from next turn)
  tickStatuses(state);
  for (const x of plan.intent.inflict ?? []) {
    addStatus(content, state, x.status, x.turns, x.stacks);
    notes.push(`${statusDef(content, x.status).name}: ${x.turns} lượt tới`);
  }
  const adapt = b.adapt;
  if (adapt && adaptsNow(content, plan)) {
    addStatus(content, state, adapt.status, adapt.turns);
    const n = state.statuses!.find((x) => x.id === adapt.status)!.stacks;
    notes.push(`Bị chặn ${Math.round((plan.botBlockedRps / plan.botRps) * 100)}%, bot thích nghi: ${statusDef(content, adapt.status).name} ${n} tầng`);
  }

  const report: TurnReport = {
    turn: state.turn,
    intent: plan.intent.label,
    legitRps: plan.legitRps,
    botRps: plan.botRps,
    botBlockedRps: plan.botBlockedRps,
    okRps: summary.throughputRps,
    errorRate: summary.errorRate,
    p50Ms: summary.p50Ms,
    p99Ms: summary.p99Ms,
    costPerHour: summary.costPerHour,
    legitFailed,
    damage: score.damage,
    enemyDamage,
    notes,
    ...(hot?.length && { hot }),
  };
  state.reports.push(report);

  if (state.enemy.hp <= 0) {
    state.phase = 'won';
    if (minionsOf(state).length) report.notes.push('Mất chỉ huy, lính tan rã');
    state.minions = [];
    delete state.target;
    return state;
  }
  if (state.hp <= 0) {
    state.phase = 'lost';
    return state;
  }

  // next turn
  state.discard.push(...state.hand);
  state.hand = [];
  state.temp = { api: 0, db: 0, botCut: 0, hotfix: false };
  state.headroom = 0;
  state.played = [];
  state.enemy.step++;
  state.turn++;
  const def = enemyDef(content, state);
  if (def.phase2 && state.enemy.phase !== 2 && state.enemy.hp <= def.phase2.at * state.enemy.maxHp) {
    state.enemy.phase = 2;
    state.enemy.step = 0;
    state.enemy.recent = [];
    report.notes.push(`${def.name} chuyển pha: ${def.phase2.label}`);
  }
  if (def.passive?.wafDecay && state.waf > 0) {
    state.waf = Math.max(0, Math.round((state.waf - def.passive.wafDecay) * 100) / 100);
    report.notes.push(`${def.passive.label}: WAF còn ${Math.round(state.waf * 100)}%`);
  }
  pickIntent(content, state);
  state.ops = Math.max(1, b.opsPerTurn - (plan.intent.drainOps ?? 0) + statusMods(content, state).opsPerTurn);
  if (state.ops < b.opsPerTurn) report.notes.push(`Lượt sau chỉ còn ${state.ops} Ops`);
  draw(state, b.handSize);
  const alert = alertDrawOf(content, state);
  const failed = hot?.find((h) => h.down || h.rejected > 0);
  if (alert && failed) {
    draw(state, alert);
    report.notes.push(`Cảnh báo: ${failed.label} ${failed.down ? 'sập' : 'từ chối request'}, rút thêm ${alert} lá`);
  }
  state.phase = 'player';
  fireRelics(content, state, 'turnStart');
  chooseVariant(content, state);
  if (state.enemy.hp <= 0) state.phase = 'won';
  return state;
}
