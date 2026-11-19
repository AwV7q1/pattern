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
import type { BattleSetup, BattleState, CardDef, CardInst, Content, Effect, EnemyDef, Intent, RelicDef, TurnPlan, TurnReport, TurnScore } from './types';

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

/** Intents the enemy draws from now (a boss's second phase has its own). */
export function intentsNow(content: Content, state: BattleState): Intent[] {
  const def = enemyDef(content, state);
  return state.enemy.phase === 2 && def.phase2 ? def.phase2.intents : def.intents;
}

/** The attacker's plan for the current turn, with escalation per loop. */
export function currentIntent(content: Content, state: BattleState): Intent {
  const def = enemyDef(content, state);
  const list = intentsNow(content, state);
  const loop = Math.floor(state.enemy.step / list.length);
  const base = def.pattern === 'weighted' ? list[state.enemy.pick ?? 0] : list[state.enemy.step % list.length];
  return { ...base, botRps: Math.round(base.botRps * (1 + def.escalation * loop) * (state.enemy.rps ?? 1)) };
}

/** Real users' traffic this fight (a boss passive can raise it). */
export function legitRpsNow(content: Content, state: BattleState): number {
  return Math.round(content.battle.legitRps * (enemyDef(content, state).passive?.legitRpsMul ?? 1));
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

/** A weaker botnet sends less traffic: 60% at 0 HP, 100% at full HP. */
export function botRpsNow(content: Content, state: BattleState): number {
  const ratio = state.enemy.hp / state.enemy.maxHp;
  return Math.round(currentIntent(content, state).botRps * (0.6 + 0.4 * ratio));
}

/** Share of the filtering the bots slip past this turn (intent and passive stack multiplicatively). */
export function bypassNow(content: Content, state: BattleState): number {
  const a = currentIntent(content, state).bypass ?? 0;
  const b = enemyDef(content, state).passive?.bypass ?? 0;
  return 1 - (1 - a) * (1 - b);
}

/** Share of bot traffic filtered this turn (WAF and rate limit stack multiplicatively; `bypass` slips past part of it). */
export function botCutNow(state: BattleState, bypass = 0): number {
  return (1 - (1 - state.waf) * (1 - state.temp.botCut)) * (1 - bypass);
}

export function canPlay(content: Content, state: BattleState, uid: number): boolean {
  if (state.phase !== 'player') return false;
  const inst = state.hand.find((c) => c.uid === uid);
  if (!inst) return false;
  const def = cardDef(content, inst.id);
  return !def.unplayable && def.cost <= state.ops;
}

// ---------------------------------------------------------------- design helpers

export const nodeOf = (design: Design, id: string) => design.nodes.find((n) => n.id === id);
export const apiOut = (design: Design) => design.edges.find((e) => e.source === 'api');

function addCache(design: Design, hitRate: number) {
  const node: DesignNode = {
    id: 'cache',
    kind: 'cache',
    label: 'Redis',
    position: { x: 0, y: 0 },
    config: { instances: 1, concurrency: 2000, queueSize: 1000, latencyP50Ms: 0.5, latencyP99Ms: 2, hitRate, costPerHour: 0.15 },
  };
  design.nodes.splice(design.nodes.findIndex((n) => n.id === 'db'), 0, node);
  const old = apiOut(design)!;
  // the API's call policy (timeout, retry, breaker) moves to the API → cache call
  const toCache: DesignEdge = { ...old, target: 'cache' };
  const toDb: DesignEdge = { source: 'cache', target: 'db', latencyMs: 1 };
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
    design: clone(b.design),
    waf: 0,
    temp: { api: 0, db: 0, botCut: 0, hotfix: false },
    enemy: { id: enemy.id, hp: enemyHp, maxHp: enemyHp, step: 0, ...(scale.rps !== 1 && { rps: scale.rps }) },
    played: [],
    reports: [],
    nextUid: 1,
    relics: (setup.relics ?? []).filter((id) => content.relics.some((r) => r.id === id)),
    relicCount: {},
    relicFired: [],
  };
  const deck: CardInst[] = (setup.deck ?? b.startingDeck).map((id) => ({ uid: state.nextUid++, id }));
  state.drawPile = shuffle(state, deck);
  draw(state, b.handSize);
  pickIntent(content, state);
  fireRelics(content, state, 'battleStart');
  fireRelics(content, state, 'turnStart');
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
        const cfg = nodeOf(state.design, effect.node)!.config!;
        cfg.instances = (cfg.instances ?? 1) + effect.n;
      }
      break;
    }
    case 'cache': {
      const cache = nodeOf(state.design, 'cache');
      if (cache) cache.config!.hitRate = Math.min(effect.max, (cache.config!.hitRate ?? 0) + effect.step);
      else addCache(state.design, effect.hitRate);
      break;
    }
    case 'edge':
      Object.assign(apiOut(state.design)!, clone(effect.patch));
      break;
    case 'rateLimit':
      state.temp.botCut = 1 - (1 - state.temp.botCut) * (1 - effect.cut);
      break;
    case 'waf':
      state.waf = Math.min(effect.max, state.waf + effect.cut);
      break;
    case 'attack':
      state.enemy.hp = Math.max(0, state.enemy.hp - effect.dmg);
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
    case 'tune': {
      const cfg = nodeOf(state.design, effect.node)!.config!;
      const m = effect.mul;
      const round2 = (v: number) => Math.round(v * 100) / 100;
      if (m.latency !== undefined) {
        cfg.latencyP50Ms = round2((cfg.latencyP50Ms ?? 1) * m.latency);
        cfg.latencyP99Ms = round2((cfg.latencyP99Ms ?? 1) * m.latency);
      }
      if (m.concurrency !== undefined) cfg.concurrency = Math.max(1, Math.round((cfg.concurrency ?? 1) * m.concurrency));
      if (m.queueSize !== undefined) cfg.queueSize = Math.max(0, Math.round((cfg.queueSize ?? 0) * m.queueSize));
      if (m.cost !== undefined) cfg.costPerHour = round2((cfg.costPerHour ?? 0) * m.cost);
      break;
    }
    case 'purge': {
      const curses = state.hand.filter((c) => cardDef(content, c.id).unplayable);
      if (!curses.length) break;
      state.hand = state.hand.filter((c) => !curses.includes(c));
      state.exhausted.push(...curses);
      if (effect.draw) draw(state, curses.length);
      break;
    }
  }
}

export function playCard(content: Content, prev: BattleState, uid: number): BattleState {
  if (!canPlay(content, prev, uid)) return prev;
  const state = clone(prev);
  state.relicFired = [];
  const idx = state.hand.findIndex((c) => c.uid === uid);
  const [inst] = state.hand.splice(idx, 1);
  const def = cardDef(content, inst.id);
  state.ops -= def.cost;
  state.played.push(def.id);
  // the card leaves the hand before its effects, so "draw" cannot redraw it
  (def.exhaust ? state.exhausted : state.discard).push(inst);
  for (const effect of def.effects) apply(content, state, effect);
  fireRelics(content, state, 'cardPlayed', def.type);
  if (state.enemy.hp <= 0) state.phase = 'won';
  return state;
}

// ---------------------------------------------------------------- end of turn

/** Design and scenario the engine must run for this turn (does not change the state). */
export function planTurn(content: Content, state: BattleState): TurnPlan {
  const b = content.battle;
  const intent = currentIntent(content, state);
  const raw = botRpsNow(content, state);
  const cut = botCutNow(state, bypassNow(content, state));
  const botPassed = Math.round(raw * (1 - cut));

  const design = clone(state.design);
  for (const node of ['api', 'db'] as const) {
    const cfg = nodeOf(design, node)!.config!;
    cfg.instances = (cfg.instances ?? 1) + state.temp[node];
  }
  const events: object[] = [];
  if (!state.temp.hotfix) {
    if (intent.chaos) events.push({ atMs: 0, node: intent.chaos.node, action: intent.chaos.action, value: intent.chaos.value });
    if (intent.clientRetries) {
      const edge = design.edges.find((e) => e.source === 'client')!;
      Object.assign(edge, { retries: intent.clientRetries, backoffMs: 0, jitter: false });
    }
    const cache = nodeOf(design, 'cache');
    if (cache && intent.cacheHitScale !== undefined) cache.config!.hitRate = (cache.config!.hitRate ?? 0) * intent.cacheHitScale;
  }
  // a boss passive is not an incident: Hotfix does not cancel it
  const passive = enemyDef(content, state).passive;
  const cache = nodeOf(design, 'cache');
  if (cache && passive?.cacheHitScale !== undefined) cache.config!.hitRate = (cache.config!.hitRate ?? 0) * passive.cacheHitScale;
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
        traffic: [{ atMs: 0, rps: legitRps + botPassed }],
        slo: { p99Ms: b.sloP99Ms, errorRate: 0.01 },
        events,
      },
    },
  };
}

/** Damage both sides take for a turn, from the engine's summary. Shared by the preview and `resolveTurn`. */
export function scoreTurn(content: Content, state: BattleState, plan: TurnPlan, summary: Summary): TurnScore {
  const b = content.battle;
  const sec = b.turnMs / 1000;
  const legitFailed = Math.round(summary.errorRate * plan.legitRps * sec);
  const failed = Math.round(legitFailed / b.failedPerDamage);
  const latency = summary.p99Ms > b.sloP99Ms ? b.latencyDamage : 0;
  const over = summary.costPerHour - b.budgetPerHour;
  const budget = over > 0.001 ? Math.ceil(over * b.overBudgetDamage) : 0;
  const raw = failed + latency + budget;
  const absorbed = Math.min(state.headroom, raw);
  const total = Math.min(b.maxDamagePerTurn, raw - absorbed);
  const capped = raw - absorbed - total;
  const enemyDamage = Math.floor((plan.botBlockedRps * sec) / b.blockedPerDamage);
  return { legitFailed, damage: { failed, latency, budget, absorbed, capped, total }, enemyDamage };
}

/** Apply the engine's verdict for the turn, run the attacker's side effects and start the next turn. */
export function resolveTurn(content: Content, prev: BattleState, plan: TurnPlan, summary: Summary): BattleState {
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
  if (budget) notes.push(`Vượt ngân sách: $${summary.costPerHour.toFixed(2)}/h > $${b.budgetPerHour.toFixed(2)}/h`);
  if (absorbed) notes.push(`Headroom hấp thụ ${absorbed} sát thương`);
  if (capped) notes.push(`Sát thương tối đa ${b.maxDamagePerTurn}/lượt (bỏ qua ${capped})`);
  if (enemyDamage) notes.push(`Chặn ${Math.round(plan.botBlockedRps * sec).toLocaleString('vi-VN')} request bot`);
  if (state.temp.hotfix && (plan.intent.chaos || plan.intent.clientRetries || plan.intent.cacheHitScale !== undefined)) notes.push('Hotfix đã chặn hiệu ứng sự cố');

  state.hp = Math.max(0, state.hp - total);
  state.enemy.hp = Math.max(0, state.enemy.hp - enemyDamage);

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
  if (plan.intent.wafStrip && state.waf > 0) {
    state.waf = Math.max(0, Math.round((state.waf - plan.intent.wafStrip) * 100) / 100);
    notes.push(`${plan.intent.label}: WAF còn ${Math.round(state.waf * 100)}%`);
  }
  if (plan.intent.bypass) notes.push(`${Math.round(plan.intent.bypass * 100)}% bộ lọc bị lách`);

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
  };
  state.reports.push(report);

  if (state.enemy.hp <= 0) {
    state.phase = 'won';
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
  state.ops = Math.max(1, b.opsPerTurn - (plan.intent.drainOps ?? 0));
  if (plan.intent.drainOps) report.notes.push(`Lượt sau chỉ còn ${state.ops} Ops`);
  draw(state, b.handSize);
  state.phase = 'player';
  fireRelics(content, state, 'turnStart');
  if (state.enemy.hp <= 0) state.phase = 'won';
  return state;
}
