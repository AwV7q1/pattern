// Rules and run tests, no engine: turns are resolved with hand-made summaries.
// Run: pnpm --filter web test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rules from './rules.ts';
import * as runs from './run.ts';
import { generateMap, ELITE_ROW } from './map.ts';
import type { BattleState, Content, RunState } from './types';
import type { Design, Summary } from '@/types';

/** The API's call to its data in the default system (monolith). */
const apiCall = (d: Design) => rules.edgeAt(d, ['api', 'db']);

const here = dirname(fileURLToPath(import.meta.url));
const data = (f: string) => JSON.parse(readFileSync(join(here, 'data', f), 'utf8'));
const content: Content = { cards: data('cards.json'), enemies: data('enemies.json'), battle: data('battle.json'), run: data('run.json'), events: data('events.json'), relics: data('relics.json'), minions: data('minions.json'), statuses: data('statuses.json'), combos: data('combos.json'), chassis: data('chassis.json') };

const summary = (s: Partial<Summary> = {}) => ({ errorRate: 0, p50Ms: 20, p99Ms: 50, costPerHour: 1, throughputRps: 300, ...s }) as Summary;

/** Put a card in hand (replacing the first one) and give enough Ops to play it. */
function withCard(s: BattleState, id: string): [BattleState, number] {
  const next = structuredClone(s);
  const uid = next.nextUid++;
  next.hand[0] = { uid, id };
  next.ops = 10;
  return [next, uid];
}

const playIn = (st: BattleState, id: string, replace?: number) => {
  const [h, uid] = withCard(st, id);
  return rules.playCard(content, h, uid, replace === undefined ? {} : { replace });
};

/** A new run past the starting infrastructure pick (Redis), standing on the map. */
const fresh = (seed: number) => runs.pickReward(content, runs.newRun(content, seed, 'monolith'), 'cache');

const endTurn = (s: BattleState, sum = summary()) => rules.resolveTurn(content, s, rules.planTurn(content, s), sum);

test('content: every id referenced exists', () => {
  const cards = new Set(content.cards.map((c) => c.id));
  const enemies = new Set(content.enemies.map((e) => e.id));
  for (const id of content.battle.startingDeck) assert.ok(cards.has(id), id);
  assert.ok(enemies.has(content.battle.enemy));
  for (const id of [...content.run.warmup, ...content.run.normal.flat(), ...content.run.elites.flat(), ...content.run.bosses]) assert.ok(enemies.has(id), id);
  const minions = new Set(content.minions.map((m) => m.id));
  for (const e of content.enemies) {
    for (const id of e.minions ?? []) assert.ok(minions.has(id), id);
    for (const i of [...e.intents, ...(e.phase2?.intents ?? [])]) if (i.summon) assert.ok(minions.has(i.summon.minion), i.summon.minion);
  }
  for (const ev of content.events) for (const o of ev.options) for (const e of o.effects) if (e.op === 'addCard') assert.ok(cards.has(e.card), e.card);
  for (const e of content.enemies) for (const i of e.intents) if (i.addCards) assert.ok(cards.has(i.addCards.card));
});

test('newBattle is deterministic per seed and deals a full hand', () => {
  const a = rules.newBattle(content, 42);
  const b = rules.newBattle(content, 42);
  assert.deepEqual(a, b);
  assert.equal(a.hand.length, content.battle.handSize);
  assert.equal(a.hand.length + a.drawPile.length, content.battle.startingDeck.length);
  assert.notDeepEqual(rules.newBattle(content, 43).hand, a.hand);
});

test('newBattle takes a run setup', () => {
  const s = rules.newBattle(content, 1, { enemy: 'herd', hp: 20, maxHp: 60, deck: ['cache', 'cache', 'cache', 'cache', 'cache', 'waf'] });
  assert.equal(s.enemy.id, 'herd');
  assert.equal(s.hp, 20);
  assert.equal(s.maxHp, 60);
  assert.equal(s.hand.length + s.drawPile.length, 6);
});

test('playCard spends Ops, moves the card and ignores unplayable cards', () => {
  const [s, uid] = withCard(rules.newBattle(content, 7), 'block_ip');
  const hp = s.enemy.hp;
  const next = rules.playCard(content, s, uid);
  assert.equal(next.ops, 10 - rules.cardDef(content, 'block_ip').cost);
  assert.ok(next.enemy.hp < hp);
  assert.ok(next.discard.some((c) => c.uid === uid));
  assert.ok(!next.hand.some((c) => c.uid === uid));
  assert.equal(s.enemy.hp, hp, 'previous state is not mutated');

  const [t, debt] = withCard(s, 'tech_debt');
  assert.equal(rules.playCard(content, t, debt), t);
});

test('effects: cache, edge, tune, waf, purge', () => {
  let s = rules.newBattle(content, 3);
  let uid: number;
  [s, uid] = withCard(s, 'cache');
  s = rules.playCard(content, s, uid);
  const d = (st: BattleState) => rules.designOf(content, st);
  assert.ok(rules.nodeOf(d(s), 'cache'), 'cache node added');
  assert.equal(apiCall(d(s))?.target, 'cache');

  const p50 = rules.nodeOf(d(s), 'db')!.config!.latencyP50Ms!;
  [s, uid] = withCard(s, 'index');
  s = rules.playCard(content, s, uid);
  assert.ok(rules.nodeOf(d(s), 'db')!.config!.latencyP50Ms! < p50);

  [s, uid] = withCard(s, 'waf');
  s = rules.playCard(content, s, uid);
  assert.ok(s.waf > 0);

  s = structuredClone(s);
  s.hand.push({ uid: s.nextUid++, id: 'tech_debt' }, { uid: s.nextUid++, id: 'tech_debt' });
  [s, uid] = withCard(s, 'refactor');
  const handBefore = s.hand.length;
  s = rules.playCard(content, s, uid);
  assert.equal(s.hand.filter((c) => c.id === 'tech_debt').length, 0);
  assert.equal(s.exhausted.filter((c) => c.id === 'tech_debt').length, 2);
  assert.ok(s.hand.length <= handBefore - 1);
});

test('resolveTurn: damage from errors, latency and budget, capped per turn', () => {
  const s = rules.newBattle(content, 5);
  const b = content.battle;
  const clean = endTurn(s);
  assert.equal(clean.hp, s.hp);
  assert.equal(clean.turn, 2);
  assert.equal(clean.hand.length, b.handSize);
  assert.equal(clean.ops, b.opsPerTurn);

  const slow = endTurn(s, summary({ p99Ms: b.sloP99Ms + 1 }));
  assert.equal(slow.reports[0].damage.latency, b.latencyDamage);

  const broke = endTurn(s, summary({ costPerHour: b.budgetPerHour + 0.25 }));
  assert.equal(broke.reports[0].damage.budget, Math.ceil(0.25 * b.overBudgetDamage));

  const melt = endTurn(s, summary({ errorRate: 1, p99Ms: 5000, costPerHour: 9 }));
  assert.equal(melt.reports[0].damage.total, b.maxDamagePerTurn);
  assert.equal(melt.hp, s.hp - b.maxDamagePerTurn);
});

test('headroom absorbs damage and resets next turn', () => {
  let s = rules.newBattle(content, 5);
  s = structuredClone(s);
  s.headroom = 2;
  const next = endTurn(s, summary({ p99Ms: 9999 }));
  assert.equal(next.reports[0].damage.absorbed, 2);
  assert.equal(next.headroom, 0);
});

test('intents escalate each loop and curses land in the discard pile', () => {
  const s = structuredClone(rules.newBattle(content, 9));
  const enemy = content.enemies.find((e) => e.id === s.enemy.id)!;
  const first = rules.currentIntent(content, s).botRps;
  s.enemy.step = enemy.intents.length;
  assert.equal(rules.currentIntent(content, s).botRps, Math.round(first * (1 + enemy.escalation)));

  const debt = enemy.intents.findIndex((i) => i.addCards);
  s.enemy.step = debt;
  const next = endTurn(s);
  const n = enemy.intents[debt].addCards!.n;
  const all = [...next.hand, ...next.drawPile, ...next.discard];
  assert.equal(all.filter((c) => c.id === 'tech_debt').length, n);
});

test('a battle ends when either side reaches 0 HP', () => {
  const s = structuredClone(rules.newBattle(content, 2));
  s.enemy.hp = 1;
  const [t, uid] = withCard(s, 'block_ip');
  assert.equal(rules.playCard(content, t, uid).phase, 'won');

  const low = structuredClone(rules.newBattle(content, 2));
  low.hp = 1;
  assert.equal(endTurn(low, summary({ p99Ms: 9999 })).phase, 'lost');
});

// ---------------------------------------------------------------- map

const { rows } = content.run.map;

test('map: seeded, connected, no crossing edges', () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (let act = 1; act <= content.run.acts; act++) {
      const m = generateMap(content, seed, act);
      assert.deepEqual(generateMap(content, seed, act), m);
      const byId = new Map(m.nodes.map((n) => [n.id, n]));
      const boss = byId.get(m.bossId)!;
      assert.equal(boss.kind, 'boss');
      assert.equal(boss.row, rows);

      // every node is reached from row 0, and leads to the boss
      const seen = new Set<number>();
      const stack = m.nodes.filter((n) => n.row === 0).map((n) => n.id);
      while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        stack.push(...byId.get(id)!.next);
      }
      assert.equal(seen.size, m.nodes.length, `seed ${seed}: unreachable node`);
      const leads = (id: number): boolean => id === m.bossId || byId.get(id)!.next.some(leads);
      for (const n of m.nodes) assert.ok(leads(n.id), `seed ${seed}: dead end at ${n.id}`);

      // edges go one row up, at most one column over, and never cross
      for (const n of m.nodes)
        for (const to of n.next) {
          const t = byId.get(to)!;
          assert.equal(t.row, n.row + 1);
          if (t.kind !== 'boss') assert.ok(Math.abs(t.col - n.col) <= 1);
        }
      for (let r = 0; r < rows - 1; r++) {
        const edges = m.nodes.filter((n) => n.row === r).flatMap((n) => n.next.map((to) => [n.col, byId.get(to)!.col]));
        for (const [a, b] of edges) for (const [c, d] of edges) assert.ok(!((a < c && b > d) || (a > c && b < d)), `seed ${seed}: crossing on row ${r}`);
      }

      // node kinds
      const parents = (id: number) => m.nodes.filter((n) => n.next.includes(id));
      for (const n of m.nodes) {
        if (n.row === 0) assert.equal(n.kind, 'battle');
        if (n.row === rows - 1) assert.equal(n.kind, 'rest');
        if ((n.kind === 'elite' || n.kind === 'rest') && n.row < rows - 1) {
          assert.ok(n.row >= ELITE_ROW, `seed ${seed}: early ${n.kind}`);
          assert.ok(!parents(n.id).some((p) => p.kind === n.kind), `seed ${seed}: ${n.kind} twice in a row`);
        }
      }
      assert.ok(m.nodes.some((n) => n.kind === 'elite'), `seed ${seed}: no elite`);
      assert.ok(m.nodes.filter((n) => n.row === 0).length >= 2, 'at least two ways in');
    }
  }
  assert.notDeepEqual(generateMap(content, 5, 1).nodes, generateMap(content, 5, 2).nodes);
  assert.notDeepEqual(generateMap(content, 5, 1).nodes, generateMap(content, 6, 1).nodes);
});

// ---------------------------------------------------------------- run

const win = (run: RunState, hpLeft: number): BattleState => {
  const s = rules.newBattle(content, runs.battleSeed(run), runs.battleSetup(content, run));
  return { ...s, phase: 'won', hp: hpLeft, turn: 6 };
};
const lose = (run: RunState): BattleState => ({ ...win(run, 0), phase: 'lost' });

/** Walk to a node of the given kind (first one found on the way up), handling what is in between. */
function climbTo(run: RunState, kind: string): RunState {
  for (let guard = 0; guard < 40; guard++) {
    if (run.phase === 'map') {
      const map = runs.towerMap(content, run);
      const next = runs.reachable(content, run).map((id) => map.nodes.find((n) => n.id === id)!);
      const target = next.find((n) => n.kind === kind) ?? next[0];
      run = runs.chooseNode(content, run, target.id);
      if (target.kind === kind) return run;
    } else if (run.phase === 'battle') run = runs.finishBattle(content, run, win(run, run.hp));
    else if (run.phase === 'reward') run = runs.pickReward(content, run, null);
    else if (run.phase === 'rest') run = runs.rest(content, run, { heal: true });
    else if (run.phase === 'event') run = runs.chooseEvent(content, run, runs.currentEvent(content, run)!.options.findIndex((o) => !o.effects.some((e) => e.op === 'removeCard')));
    else if (run.phase === 'shop') run = runs.leaveShop(content, run);
    else if (run.phase === 'cleared') run = runs.nextAct(content, run);
    else break;
  }
  throw new Error(`no ${kind} reached`);
}

test('run: after the starting pick, the map; only reachable nodes can be chosen', () => {
  const run = fresh(11);
  assert.equal(run.phase, 'map');
  assert.equal(run.act, 1);
  assert.deepEqual(run.deck, [...content.battle.startingDeck, 'cache']);
  const open = runs.reachable(content, run);
  assert.ok(open.length >= 2);
  const map = runs.towerMap(content, run);
  const far = map.nodes.find((n) => n.row > 0)!;
  assert.equal(runs.chooseNode(content, run, far.id), run, 'cannot skip rows');
  assert.equal(runs.pickReward(content, run, 'cache'), run, 'no reward on the map');

  const next = runs.chooseNode(content, run, open[0]);
  assert.equal(next.phase, 'battle', 'row 0 is a fight');
  assert.deepEqual(next.path, [open[0]]);
  assert.equal(next.climbed, 1);
  assert.equal(runs.chooseNode(content, next, open[1]), next, 'one node at a time');
});

test('run: fight, reward, back to the map with the hp carried over', () => {
  let run = runs.chooseNode(content, fresh(11), runs.reachable(content, fresh(11))[0]);
  const setup = runs.battleSetup(content, run);
  assert.ok(content.run.warmup.includes(setup.enemy!), 'the first fight is a warmup');
  assert.notEqual(setup.enemy, runs.bossOf(content, 1), 'the boss is not met before the top');
  run = runs.finishBattle(content, run, win(run, 50));
  assert.equal(run.phase, 'reward');
  assert.equal(run.hp, 50);
  assert.equal(run.reward.length, content.run.rewardChoices);
  assert.equal(new Set(run.reward).size, run.reward.length, 'offers are distinct');
  const pick = run.reward[0];
  run = runs.pickReward(content, run, pick);
  assert.equal(run.phase, 'map');
  assert.equal(run.deck.at(-1), pick);
  assert.equal(run.history[0].picked, pick);
  const open = runs.reachable(content, run);
  const node = runs.currentNode(content, run)!;
  assert.deepEqual(open, node.next);
});

test('run: elites and higher floors scale the enemy', () => {
  let run = climbTo(fresh(21), 'elite');
  assert.equal(run.phase, 'battle');
  const setup = runs.battleSetup(content, run);
  assert.ok(runs.poolOf(content, run.act, 'elite').includes(setup.enemy!), 'elites have their own pool');
  const def = content.enemies.find((e) => e.id === setup.enemy)!;
  const up = 1 + content.run.actScale.hp * (run.act - 1);
  const upRps = 1 + content.run.actScale.rps * (run.act - 1);
  assert.deepEqual(setup.enemyScale, { hp: content.run.elite.hp * up, rps: content.run.elite.rps * upRps });
  const s = rules.newBattle(content, 1, setup);
  assert.equal(s.enemy.maxHp, Math.round(def.hp * setup.enemyScale!.hp));
  const plain = rules.newBattle(content, 1, { enemy: setup.enemy });
  assert.equal(rules.currentIntent(content, s).botRps, Math.round(rules.currentIntent(content, plain).botRps * setup.enemyScale!.rps));
  assert.match(runs.battleTitle(content, run), /^Tinh anh/);

  const maxHp = run.maxHp;
  run = runs.finishBattle(content, run, win(run, 40));
  assert.equal(run.maxHp, maxHp + content.run.elite.maxHp);
  assert.equal(run.hp, 40 + content.run.elite.maxHp);
  assert.equal(run.reward.length, content.run.rewardChoices + 1);

  const third = { ...fresh(21), act: 3 };
  const node = runs.towerMap(content, third).nodes.find((n) => n.row === 0)!;
  const high = runs.battleSetup(content, { ...third, node: node.id, phase: 'battle' });
  const f = content.run.fight;
  assert.deepEqual(high.enemyScale, { hp: f.hp * (1 + 2 * content.run.actScale.hp), rps: f.rps * (1 + 2 * content.run.actScale.rps) });
  // real users grow floor by floor too
  const legit = 1 + 2 * (content.run.actScale.legit ?? 0);
  assert.equal(high.legitScale, legit === 1 ? undefined : legit);
  const b = rules.newBattle(content, 1, high);
  assert.equal(rules.legitRpsNow(content, b), Math.round(content.battle.legitRps * legit));
  assert.equal(rules.planTurn(content, b).legitRps, rules.legitRpsNow(content, b));
});

test('run: boss clears the floor, the last boss wins the tower', () => {
  let run = climbTo(fresh(31), 'boss');
  assert.equal(runs.battleSetup(content, run).enemy, runs.bossOf(content, 1));
  run = runs.finishBattle(content, run, win(run, 20));
  assert.equal(run.phase, 'cleared');
  const map1 = runs.towerMap(content, run).nodes;
  const heal = runs.actHealOf(content, run);
  run = runs.nextAct(content, run);
  assert.equal(run.act, 2);
  assert.equal(run.phase, 'map');
  assert.equal(run.node, null);
  assert.deepEqual(run.path, []);
  assert.equal(run.hp, 20 + heal);
  assert.notDeepEqual(runs.towerMap(content, run).nodes, map1, 'a new map each floor');

  run = climbTo(run, 'boss');
  run = runs.finishBattle(content, run, win(run, run.hp));
  run = runs.nextAct(content, run);
  run = climbTo(run, 'boss');
  assert.equal(run.act, content.run.acts);
  run = runs.finishBattle(content, run, win(run, 5));
  assert.equal(run.phase, 'won');
  assert.equal(runs.nextAct(content, run), run, 'no floor above the last');
  assert.equal(run.history.filter((h) => h.kind === 'boss').length, content.run.acts);
});

test('run: losing a fight ends the run', () => {
  let run = fresh(4);
  run = runs.chooseNode(content, run, runs.reachable(content, run)[0]);
  run = runs.finishBattle(content, run, lose(run));
  assert.equal(run.phase, 'lost');
  assert.equal(run.hp, 0);
  assert.equal(runs.chooseNode(content, run, runs.currentNode(content, run)!.next[0]), run);
});

test('run: rest stops and events', () => {
  const base = { ...fresh(8), hp: 30 };
  const map = runs.towerMap(content, base);
  const restNode = map.nodes.find((n) => n.kind === 'rest')!;
  const atRest = { ...base, node: restNode.id, phase: 'rest' as const };
  const healed = runs.rest(content, atRest, { heal: true });
  assert.equal(healed.hp, Math.min(base.maxHp, 30 + Math.ceil(base.maxHp * content.run.restHeal)));
  assert.equal(healed.phase, 'map');
  const trimmed = runs.rest(content, atRest, { remove: 0 });
  assert.equal(trimmed.deck.length, base.deck.length - 1);
  assert.equal(runs.rest(content, { ...atRest, deck: base.deck.slice(0, content.battle.handSize) }, { remove: 0 }).phase, 'rest', 'deck too small');

  const at = (id: string) => ({ ...base, phase: 'event' as const, event: id, node: map.nodes.find((n) => n.row > 0)!.id });
  const ev = (id: string) => content.events.find((e) => e.id === id)!;
  const opt = (id: string, op: string) => ev(id).options.findIndex((o) => o.effects.some((e) => e.op === op));

  const friday = runs.chooseEvent(content, at('friday_deploy'), opt('friday_deploy', 'randomCard'));
  assert.equal(friday.deck.length, base.deck.length + 2);
  assert.ok(friday.deck.includes('tech_debt'));
  assert.equal(friday.phase, 'map');

  const blameless = at('blameless');
  const o = opt('blameless', 'removeCard');
  assert.equal(runs.chooseEvent(content, blameless, o), blameless, 'removing needs a card');
  assert.equal(runs.chooseEvent(content, blameless, o, 0).deck.length, base.deck.length - 1);
  const tougher = runs.chooseEvent(content, blameless, opt('blameless', 'maxHp'));
  assert.equal(tougher.maxHp, base.maxHp + 4);

  const tool = runs.chooseEvent(content, at('boss_asks'), opt('boss_asks', 'pickCard'));
  assert.equal(tool.phase, 'reward');
  assert.equal(tool.hp, 30 - 6);
  assert.equal(runs.pickReward(content, tool, tool.reward[0]).phase, 'map');

  const nearlyDead = runs.chooseEvent(content, { ...at('pager_3am'), hp: 2 }, opt('pager_3am', 'damage'));
  assert.equal(nearlyDead.hp, 1, 'events never kill');
});

test('run: same seed, same run; saved runs are validated', () => {
  const a = runs.finishBattle(content, climbTo(fresh(99), 'battle'), win(climbTo(fresh(99), 'battle'), 40));
  const b = runs.finishBattle(content, climbTo(fresh(99), 'battle'), win(climbTo(fresh(99), 'battle'), 40));
  assert.deepEqual(a, b);
  assert.notEqual(runs.battleSeed(a), runs.battleSeed({ ...a, climbed: a.climbed + 1 }));

  assert.ok(runs.isValidRun(content, JSON.parse(JSON.stringify(a))));
  assert.ok(!runs.isValidRun(content, null));
  assert.ok(!runs.isValidRun(content, { ...a, deck: ['no_such_card'] }));
  assert.ok(!runs.isValidRun(content, { ...a, version: 1, floor: 0 }), 'old saves start over');
  assert.ok(!runs.isValidRun(content, { ...a, node: 9999 }));
  assert.ok(!runs.isValidRun(content, { ...a, act: content.run.acts + 1 }));
  assert.ok(!runs.isValidRun(content, { ...a, phase: 'rest' }), 'not standing on a rest stop');
});

test('scoreTurn: the forecast is exactly what resolveTurn applies', () => {
  const s = rules.newBattle(content, 7);
  const sum = summary({ errorRate: 0.2, p99Ms: 900, costPerHour: 2 });
  const plan = rules.planTurn(content, s);
  const score = rules.scoreTurn(content, s, plan, sum);
  const next = rules.resolveTurn(content, s, plan, sum);
  const r = next.reports.at(-1)!;
  assert.deepEqual(score.damage, r.damage);
  assert.equal(score.enemyDamage, r.enemyDamage);
  assert.equal(next.hp, s.hp - score.damage.total);
});

test('rarity: every playable card has one, basics are never offered', () => {
  for (const c of content.cards) if (!c.unplayable) assert.ok(c.rarity, c.id);
  const pool = runs.rewardPool(content);
  assert.ok(pool.length > 10);
  for (const id of pool) assert.notEqual(content.cards.find((c) => c.id === id)!.rarity, 'basic', id);
  for (const id of content.battle.startingDeck) assert.ok(content.cards.some((c) => c.id === id));
});

test('upgrades: "+" copies use the upgrade, rest stops upgrade a card once', () => {
  const up = rules.cardDef(content, 'cache+');
  assert.equal(up.cost, 1);
  assert.equal(up.name, `${rules.cardDef(content, 'cache').name}+`);
  assert.ok(up.upgraded);
  assert.equal(rules.cardDef(content, 'cache+'), up, 'same object every time');
  assert.throws(() => rules.cardDef(content, 'tech_debt+'));
  assert.ok(!rules.canUpgrade(content, 'cache+'));

  const [s, uid] = withCard(rules.newBattle(content, 3), 'patch+');
  assert.equal(rules.playCard(content, s, uid).enemy.hp, s.enemy.hp - 8);

  const base = fresh(8);
  const restNode = runs.towerMap(content, base).nodes.find((n) => n.kind === 'rest')!;
  const atRest = { ...base, node: restNode.id, phase: 'rest' as const };
  const i = base.deck.indexOf('cache');
  const done = runs.rest(content, atRest, { upgrade: i });
  assert.equal(done.deck[i], 'cache+');
  assert.equal(done.history.at(-1)!.upgraded, 'cache');
  assert.ok(runs.isValidRun(content, done));
  assert.equal(runs.rest(content, { ...atRest, deck: done.deck }, { upgrade: i }).phase, 'rest', 'no double upgrade');
});

test('relics: fire at battle start, turn start and on every n-th card', () => {
  const plain = rules.newBattle(content, 5);
  const s = rules.newBattle(content, 5, { relics: ['oncall', 'grafana', 'wiki', 'pager'] });
  assert.equal(s.ops, plain.ops + 1);
  assert.equal(s.headroom, 3);
  assert.equal(s.hand.length, plain.hand.length + 2);
  assert.deepEqual(s.relicFired, ['oncall', 'wiki', 'grafana'], 'battle start, then turn start');

  // PagerDuty: the 3rd attack card deals 6 more
  let b: BattleState = s;
  const hits: number[] = [];
  for (let k = 0; k < 3; k++) {
    const [next, uid] = withCard(b, 'patch');
    b = rules.playCard(content, next, uid);
    hits.push(next.enemy.hp - b.enemy.hp);
  }
  assert.deepEqual(hits, [5, 5, 11]);

  // turnStart fires again on the next turn
  const t2 = endTurn(s);
  assert.equal(t2.headroom, 3);
  assert.ok(t2.relicFired.includes('grafana'));
});

test('relics: elites drop one, bosses offer a pick, pickups apply once', () => {
  let run = climbTo(fresh(21), 'elite');
  run = runs.finishBattle(content, run, win(run, run.hp));
  assert.equal(run.relics.length, 1);
  assert.equal(run.history.at(-1)!.relic, run.relics[0]);

  let boss = climbTo(fresh(31), 'boss');
  boss = runs.finishBattle(content, boss, win(boss, 20));
  assert.equal(boss.relicOffer.length, content.run.bossRelicChoices);
  assert.equal(new Set(boss.relicOffer).size, boss.relicOffer.length);
  assert.equal(runs.nextAct(content, boss, 'not_offered'), boss);
  const pick = boss.relicOffer.includes('multi_region') ? 'multi_region' : boss.relicOffer[0];
  const up = runs.nextAct(content, boss, pick);
  assert.ok(up.relics.includes(pick));
  assert.deepEqual(up.relicOffer, []);
  if (pick === 'multi_region') assert.equal(up.maxHp, boss.maxHp + 10);
  assert.deepEqual(runs.battleSetup(content, climbTo(up, 'battle')).relics, up.relics);
});

test('gold and shops: fights pay, shops sell cards, relics and one removal', () => {
  let run = climbTo(fresh(11), 'battle');
  assert.equal(run.gold, content.run.startGold);
  run = runs.finishBattle(content, run, win(run, run.hp));
  const won = run.gold - content.run.startGold;
  assert.ok(Math.abs(won - content.run.gold.battle) <= content.run.goldJitter + 1, `won ${won}`);
  assert.equal(run.history.at(-1)!.gold, won);

  // every floor has a shop
  for (let act = 1; act <= content.run.acts; act++) assert.ok(generateMap(content, 11, act).nodes.some((n) => n.kind === 'shop'), `act ${act}`);
  let shop = climbTo({ ...fresh(11), gold: 500 }, 'shop');
  assert.equal(shop.phase, 'shop');
  assert.equal(shop.shop!.cards.length, content.run.shop.cards);
  assert.ok(runs.isValidRun(content, shop));

  const card = shop.shop!.cards[0];
  const gold = shop.gold;
  shop = runs.buy(content, shop, { card: 0 });
  assert.equal(shop.gold, gold - card.price);
  assert.ok(shop.deck.includes(card.id));
  assert.equal(runs.buy(content, shop, { card: 0 }), shop, 'sold out');
  const relic = shop.shop!.relics[0];
  shop = runs.buy(content, shop, { relic: 0 });
  assert.ok(shop.relics.includes(relic.id));

  const price = runs.removePriceOf(content, shop);
  const size = shop.deck.length;
  shop = runs.shopRemove(content, shop, 0);
  assert.equal(shop.deck.length, size - 1);
  assert.equal(runs.shopRemove(content, shop, 0), shop, 'once per shop');
  assert.equal(runs.removePriceOf(content, shop), price + content.run.shop.removeStep);
  assert.equal(runs.buy(content, { ...shop, gold: 0 }, { card: 1 }).gold, 0, 'too poor');

  const left = runs.leaveShop(content, shop);
  assert.equal(left.phase, 'map');
  assert.equal(left.shop, null);
  const entry = left.history.at(-1)!;
  assert.equal(entry.kind, 'shop');
  assert.deepEqual(entry.bought, [card.id, relic.id]);
  assert.equal(entry.gold, -(card.price + relic.price + price));
});

test('bosses: weighted intents, second phase, passives', () => {
  const boss = (id: string) => rules.newBattle(content, 9, { enemy: id });
  // weighted: never the same intent three turns running
  let s = boss('ddos_lord');
  const picks: number[] = [];
  for (let t = 0; t < 40 && s.phase === 'player'; t++) {
    picks.push(s.enemy.pick!);
    s = endTurn({ ...s, hp: 999, enemy: { ...s.enemy, hp: s.enemy.maxHp } });
  }
  for (let i = 2; i < picks.length; i++) assert.ok(!(picks[i] === picks[i - 1] && picks[i] === picks[i - 2]), `turn ${i}`);
  assert.ok(new Set(picks).size > 1);

  // phase 2 below half HP, from the next turn
  const ddos = content.enemies.find((e) => e.id === 'ddos_lord')!;
  const hurt = boss('ddos_lord');
  const half = { ...hurt, enemy: { ...hurt.enemy, hp: Math.floor(hurt.enemy.maxHp * ddos.phase2!.at) } };
  const p2 = endTurn(half);
  assert.equal(p2.enemy.phase, 2);
  assert.ok(ddos.phase2!.intents.some((i) => i.id === rules.currentIntent(content, p2).id));

  // passives: WAF decays, real users are many more, cache is poisoned (even with Hotfix)
  const waf = endTurn({ ...boss('ddos_lord'), waf: 0.5 });
  assert.equal(waf.waf, 0.4);
  assert.equal(rules.planTurn(content, boss('black_friday')).legitRps, Math.round(content.battle.legitRps * 1.3));
  const poisoned = boss('cache_poisoner');
  const [withCache, uid] = withCard({ ...poisoned, temp: { ...poisoned.temp, hotfix: true } }, 'cache');
  const plan = rules.planTurn(content, rules.playCard(content, withCache, uid));
  const cache = plan.input.design.nodes.find((n) => n.id === 'cache')!;
  const bust = content.enemies.find((e) => e.id === 'cache_poisoner')!.passive!.cacheBust!;
  assert.equal(cache.config!.cache!.zipf, Math.round((1 - bust) * 1000) / 1000);
});

test('run: every floor has its own normal and elite enemies', () => {
  const seen = new Set<string>();
  for (let act = 1; act <= content.run.acts; act++) {
    for (const kind of ['battle', 'elite'] as const) {
      const pool = runs.poolOf(content, act, kind);
      assert.ok(pool.length >= 2, `floor ${act} ${kind}`);
      for (const id of pool) {
        assert.ok(!seen.has(id), `${id} appears on two floors or kinds`);
        seen.add(id);
      }
    }
  }
  // a floor's fights land on that floor's pool (past floor 1's warmup fights)
  const warm = Array.from({ length: content.run.warmupFights }, () => ({ act: 1, kind: 'battle' as const, enemy: 'script_kiddie', won: true, turns: 3, hpLost: 0 }));
  for (const act of [1, 2, 3]) {
    const run = { ...fresh(5), act, history: warm };
    const node = runs.towerMap(content, run).nodes.find((n) => n.row === 0)!;
    const setup = runs.battleSetup(content, { ...run, node: node.id, phase: 'battle' });
    assert.ok(runs.poolOf(content, act, 'battle').includes(setup.enemy!), `floor ${act}: ${setup.enemy}`);
  }
});

test('enemies: bypass, wafStrip, drainOps and regen', () => {
  const vs = (id: string) => rules.newBattle(content, 3, { enemy: id });
  const at = (s: BattleState, intentId: string) => {
    const i = rules.intentsNow(content, s).findIndex((it) => it.id === intentId);
    return { ...s, enemy: { ...s.enemy, step: i, pick: i } };
  };

  // bypass: the bots slip past part of the WAF; Hotfix does not help
  const stuff = at({ ...vs('cred_stuffer'), waf: 0.5 }, 'stuff');
  const plan = rules.planTurn(content, { ...stuff, temp: { ...stuff.temp, hotfix: true } });
  assert.equal(plan.botBlockedRps, plan.botRps - Math.round(plan.botRps * (1 - 0.5 * (1 - 0.4))));
  // passive bypass stacks with the intent's
  const farm = vs('click_farm');
  assert.equal(rules.bypassNow(content, farm), 1 - (1 - (rules.currentIntent(content, farm).bypass ?? 0)) * 0.8);

  // wafStrip: WAF lost after the turn
  assert.equal(endTurn(at({ ...vs('scraper'), waf: 0.5 }, 'proxy_rotate')).waf, 0.35);

  // drainOps: fewer Ops next turn only
  const drained = endTurn(at(vs('slowloris'), 'trickle'));
  assert.equal(drained.ops, content.battle.opsPerTurn - 1);
  assert.equal(endTurn({ ...drained, hp: 999 }).ops, content.battle.opsPerTurn);

  // regen: heals every turn, never above max
  const worm = vs('worm');
  const hurt = endTurn({ ...worm, enemy: { ...worm.enemy, hp: 20 } });
  assert.equal(hurt.enemy.hp, 23);
  assert.equal(endTurn(worm).enemy.hp, worm.enemy.maxHp);
});

test('run: the first normal fights of floor 1 are warmups, then the floor pool takes over', () => {
  let run = fresh(21);
  const met: string[] = [];
  while (met.length < content.run.warmupFights + 2) {
    const map = runs.towerMap(content, run);
    const open = runs.reachable(content, run);
    // walk battle nodes where possible
    const id = open.find((n) => map.nodes.find((x) => x.id === n)!.kind === 'battle') ?? open[0];
    run = runs.chooseNode(content, run, id);
    if (run.phase === 'battle') {
      const setup = runs.battleSetup(content, run);
      if (runs.currentNode(content, run)!.kind === 'battle') met.push(setup.enemy!);
      run = runs.finishBattle(content, run, win(run, run.hp));
    }
    if (run.phase === 'reward') run = runs.pickReward(content, run, null);
    if (run.phase === 'event') run = runs.chooseEvent(content, run, 0);
    if (run.phase === 'rest') run = runs.rest(content, run, { heal: true });
    if (run.phase === 'shop') run = runs.leaveShop(content, run);
    if (run.phase !== 'map') break;
  }
  const n = content.run.warmupFights;
  for (const id of met.slice(0, n)) assert.ok(content.run.warmup.includes(id), `${id} is a warmup`);
  for (const id of met.slice(n)) assert.ok(runs.poolOf(content, 1, 'battle').includes(id), `${id} is a floor-1 enemy`);
  const easy = (id: string) => Math.max(...content.enemies.find((e) => e.id === id)!.intents.map((i) => i.botRps));
  for (const id of content.run.warmup) for (const hard of runs.poolOf(content, 1, 'battle')) assert.ok(easy(id) < easy(hard), `${id} is gentler than ${hard}`);
});

test('minions: add traffic, take aimed hits, guard and heal their master, flee when it falls', () => {
  const spam = rules.newBattle(content, 4, { enemy: 'spam_bot' });
  assert.equal(spam.minions!.length, 1);
  const m = spam.minions![0];
  assert.equal(rules.botRpsNow(content, spam) - rules.botRpsNow(content, { ...spam, minions: [] }), content.minions.find((x) => x.id === 'spam_msg')!.botRps);

  // an aimed attack hits the minion only; a kill drops the aim back on the enemy
  const aimed = rules.setTarget(spam, m.uid);
  assert.equal(aimed.target, m.uid);
  assert.equal(spam.target, undefined, 'previous state is not mutated');
  assert.equal(rules.setTarget(spam, 999), spam, 'unknown minions cannot be aimed at');
  const [withPatch, p1] = withCard(aimed, 'patch');
  const scratched = rules.playCard(content, withPatch, p1);
  assert.equal(scratched.enemy.hp, spam.enemy.hp, 'the enemy is untouched');
  assert.equal(scratched.minions![0].hp, m.hp - 5);
  const [withBlock, p2] = withCard(scratched, 'block_ip');
  const killed = rules.playCard(content, withBlock, p2);
  assert.equal(killed.minions!.length, 0);
  assert.equal(killed.target, undefined);
  assert.equal(killed.enemy.hp, spam.enemy.hp, 'the excess is lost');

  // a guard halves damage to its master
  const apt = rules.newBattle(content, 4, { enemy: 'apt_group' });
  const [aptPatch, p3] = withCard(apt, 'honeypot');
  assert.equal(rules.playCard(content, aptPatch, p3).enemy.hp, apt.enemy.hp - 6);

  // a healer mends its master at the end of the turn; summons stop at MAX_MINIONS
  const poisoner = rules.newBattle(content, 4, { enemy: 'cache_poisoner' });
  const healer = { uid: 900, id: 'poison_node', hp: 10, maxHp: 10 };
  const hurt = { ...poisoner, enemy: { ...poisoner.enemy, hp: 30 }, minions: [healer] };
  assert.equal(endTurn(hurt).enemy.hp, 30 + 4);
  const debt = content.enemies.find((e) => e.id === 'cache_poisoner')!.intents.findIndex((i) => i.summon);
  const full = { ...hurt, enemy: { ...hurt.enemy, pick: debt }, minions: [1, 2, 3].map((uid) => ({ ...healer, uid })) };
  assert.equal(endTurn(full).minions!.length, rules.MAX_MINIONS);
  const room = endTurn({ ...full, minions: [healer] });
  assert.equal(room.minions!.length, 2, 'the summon adds one');

  // the master falls: the fight is won and the minions flee
  const [lastHit, p4] = withCard({ ...spam, enemy: { ...spam.enemy, hp: 3 } }, 'patch');
  const won = rules.playCard(content, lastHit, p4);
  assert.equal(won.phase, 'won');
  assert.deepEqual(won.minions, []);
});

/** A fresh battle against `enemy` whose current intent is the one with id `intent`. */
function facing(enemy: string, intent: string, seed = 5): BattleState {
  const s = rules.newBattle(content, seed, { enemy });
  const list = rules.intentsNow(content, s);
  const step = list.findIndex((i) => i.id === intent);
  assert.ok(step >= 0, `${enemy}:${intent}`);
  return { ...s, enemy: { ...s.enemy, step, pick: step } };
}

/** End the turn with a quiet summary and play until the intent `id` comes up again (on the same design). */
const nextTurn = (s: BattleState) => endTurn({ ...s, hand: [] });

test('variants: the intent answers the build read at the start of the turn, and stays put while cards are played', () => {
  const plain = facing('swarm', 'probe');
  assert.equal(rules.currentIntent(content, plain).label, 'Thăm dò');
  assert.equal(rules.currentIntent(content, plain).tag, undefined);

  // playing Redis mid-turn does not change the intent shown
  const [withCard_, uid] = withCard(plain, 'cache');
  const played = rules.playCard(content, withCard_, uid);
  assert.equal(rules.currentIntent(content, played).label, 'Thăm dò');

  // the next time the turn starts with a cache, the botnet answers it (and the forecast still matches)
  let s = played;
  const loop = rules.intentsNow(content, s).length;
  for (let i = 0; i < loop; i++) s = nextTurn(s);
  const it = rules.currentIntent(content, s);
  assert.equal(it.label, 'Cache Buster');
  assert.ok(it.tag && it.cacheBust! > 0);
  assert.equal(it.variants, undefined);
  const plan = rules.planTurn(content, s);
  assert.ok(plan.input.design.nodes.find((n) => n.id === 'cache')!.config!.cache!.zipf < 1);
  const sum = summary({ errorRate: 0.1 });
  assert.deepEqual(rules.scoreTurn(content, s, plan, sum).damage, rules.resolveTurn(content, s, plan, sum).reports.at(-1)!.damage);

  // other conditions: instance count, WAF, retries without a budget
  const traits = (st: BattleState) => rules.designTraits(content, st);
  const base = rules.newBattle(content, 1);
  assert.ok(rules.matchesWhen({ instancesAtLeast: { api: 2 } }, traits(base)));
  assert.ok(!rules.matchesWhen({ instancesAtLeast: { api: 4 } }, traits(base)));
  assert.ok(rules.matchesWhen({ wafAtLeast: 0.25 }, traits({ ...base, waf: 0.25 })));
  const retrying = structuredClone(base);
  Object.assign(apiCall(retrying.design)!, { retries: 2 });
  assert.ok(rules.matchesWhen({ retriesAtLeast: 2, noRetryBudget: true }, traits(retrying)));
  Object.assign(apiCall(retrying.design)!, { retryBudget: { ratio: 0.1, minPerSec: 10 } });
  assert.ok(!rules.matchesWhen({ retriesAtLeast: 2, noRetryBudget: true }, traits(retrying)));
});

test('cache: key-level model, cold the turn it is placed, grows with replays; SWR, key normalisation and Hotfix', () => {
  let s = facing('crawler', 'deep_crawl');
  let uid: number;
  [s, uid] = withCard(s, 'cache');
  s = rules.playCard(content, s, uid);
  const model = (st: BattleState) => rules.planTurn(content, st).input.design.nodes.find((n) => n.id === 'cache')!.config!.cache!;
  assert.equal(model(s).capacity, 1000);
  assert.equal(model(s).warm, false, 'cold the turn it is placed');
  const bust = rules.currentIntent(content, s).cacheBust!;
  assert.equal(model(s).zipf, Math.round((1 - bust) * 1000) / 1000);

  [s, uid] = withCard(s, 'cache');
  s = rules.playCard(content, s, uid);
  assert.equal(model(s).capacity, 2000);

  [s, uid] = withCard(s, 'cache_key');
  s = rules.playCard(content, s, uid);
  assert.equal(model(s).zipf, Math.round((1 - bust / 3) * 1000) / 1000);
  [s, uid] = withCard(s, 'swr');
  s = rules.playCard(content, s, uid);
  assert.equal(model(s).staleWhileRevalidate, true);

  [s, uid] = withCard(s, 'hotfix');
  s = rules.playCard(content, s, uid);
  assert.equal(model(s).zipf, 1, 'Hotfix cancels the cache busting');

  s = nextTurn(s);
  assert.equal(model(s).warm, true, 'warm from the next turn');

  // options played before the cache exist carry over; a warm relic places a warm cache
  let o = rules.newBattle(content, 2);
  [o, uid] = withCard(o, 'swr');
  o = rules.playCard(content, o, uid);
  [o, uid] = withCard(o, 'cache');
  o = rules.playCard(content, o, uid);
  assert.equal(model(o).staleWhileRevalidate, true);
  const warm = rules.newBattle(content, 2, { relics: ['warm_cache'] });
  assert.equal(model(warm).warm, true);

  // short TTL
  const herd = facing('herd', 'expire');
  const [h, hu] = withCard(herd, 'cache');
  assert.equal(model(rules.playCard(content, h, hu)).ttlMs, 500);
});

test('slowloris holds slots, the amplifier fills the link, denial of wallet bills the API', () => {
  const slow = facing('slowloris', 'hold');
  const api = (st: BattleState) => rules.planTurn(content, st).input.design.nodes.find((n) => n.id === 'api')!.config!;
  const slots = rules.nodeOf(slow.design, 'api')!.config!.concurrency!;
  assert.equal(api(slow).concurrency, Math.round(slots * 0.45));
  const [hf, hu] = withCard(slow, 'hotfix');
  assert.equal(api(rules.playCard(content, hf, hu)).concurrency, slots, 'Hotfix frees the slots');

  const amp = rules.planTurn(content, facing('amplifier', 'saturate')).input.design.edges.find((e) => e.source === 'client')!;
  assert.equal(amp.responseKb, 60);
  assert.equal(amp.bandwidthMbps, 600);

  const iot = structuredClone(facing('iot_botnet', 'wake'));
  rules.nodeOf(iot.design, 'api')!.config!.instances = 4;
  // the variant is chosen at the start of a turn: replay the cycle on the scaled design
  let s = iot;
  for (let i = 0; i < rules.intentsNow(content, s).length; i++) s = nextTurn(s);
  assert.equal(rules.currentIntent(content, s).label, 'Denial of Wallet');
  const cost = rules.nodeOf(s.design, 'api')!.config!.costPerHour!;
  assert.equal(api(s).costPerHour, Math.round(cost * 3 * 1000) / 1000);
});

test('memory leak builds up across turns, Hotfix does not help, a restart (card or intent) clears it', () => {
  let s = facing('memory_leak', 'leak');
  const apiSlow = (st: BattleState) => (rules.planTurn(content, st).input.scenario as { events: { node: string; action: string; value: number }[] }).events.find((e) => e.node === 'api' && e.action === 'latency')?.value;
  assert.equal(apiSlow(s), 1.4);
  s = nextTurn(s);
  assert.equal(s.enemy.leak, 0.4);
  assert.equal(apiSlow(s), 2, 'gc_pause adds 0.6 on top');
  const [hf, hu] = withCard(s, 'hotfix');
  assert.equal(apiSlow(rules.playCard(content, hf, hu)), 2, 'Hotfix does not stop a leak');

  const [rs, ru] = withCard(s, 'restart');
  const restarted = rules.playCard(content, rs, ru);
  assert.equal(restarted.enemy.leak, undefined);
  assert.equal(apiSlow(restarted), 1.6);
  const api = rules.planTurn(content, restarted).input.design.nodes.find((n) => n.id === 'api')!.config!;
  assert.equal(api.instances, rules.nodeOf(s.design, 'api')!.config!.instances! - 1, 'one instance short this turn');

  let r = facing('memory_leak', 'restart');
  r = { ...r, enemy: { ...r.enemy, leak: 1 } };
  assert.equal(nextTurn(r).enemy.leak, undefined);
});

test('run: starts with the chassis, then the infrastructure pick, then the map', () => {
  const start = runs.newRun(content, 3);
  assert.equal(start.phase, 'chassis');
  assert.equal(runs.chooseChassis(content, start, 'nope'), start, 'unknown chassis: nothing happens');
  const run = runs.chooseChassis(content, start, 'event_driven');
  assert.equal(run.chassis, 'event_driven');
  assert.equal(run.phase, 'reward');
  assert.equal(runs.newRun(content, 3, 'microservice').phase, 'reward', 'a chassis given up front skips the choice');
  assert.deepEqual(run.reward, content.run.startPick);
  for (const id of ['cache', 'index']) assert.ok(!run.deck.includes(id), `${id} is not given for free`);
  const picked = runs.pickReward(content, run, 'index');
  assert.equal(picked.phase, 'map');
  assert.equal(picked.deck.filter((id) => id === 'index').length, 1);
  assert.equal(runs.pickReward(content, run, null).deck.length, content.battle.startingDeck.length);
});

test('statuses: refresh extends, add piles up to maxStacks; cleanse removes debuffs only', () => {
  const s = rules.newBattle(content, 5, { enemy: 'swarm' });
  rules.addStatus(content, s, 'cpu_credit', 2);
  rules.addStatus(content, s, 'cpu_credit', 3);
  assert.deepEqual(s.statuses, [{ id: 'cpu_credit', turns: 3, stacks: 1 }]);
  for (let i = 0; i < 5; i++) rules.addStatus(content, s, 'adapted', 2);
  assert.equal(s.statuses!.find((x) => x.id === 'adapted')!.stacks, rules.statusDef(content, 'adapted').maxStacks, 'capped');
  rules.addStatus(content, s, 'tarpit', 2);
  const [r, ru] = withCard(s, 'rollback');
  const after = rules.playCard(content, r, ru);
  assert.deepEqual(after.statuses, [{ id: 'tarpit', turns: 2, stacks: 1 }], 'buffs stay');
  const [h, hu] = withCard(s, 'hotfix+');
  assert.equal(rules.playCard(content, h, hu).statuses!.length, 2, 'Hotfix+ removes one debuff, the newest');
});

test('statuses: a card status works this turn; an intent status starts next turn and lasts N turns', () => {
  const [s, uid] = withCard(rules.newBattle(content, 5, { enemy: 'swarm' }), 'tarpit');
  const played = rules.playCard(content, s, uid);
  const blocked = { ...rules.planTurn(content, played), botBlockedRps: 1600 };
  const base = { ...rules.planTurn(content, s), botBlockedRps: 1600 };
  assert.equal(rules.scoreTurn(content, played, blocked, summary()).enemyDamage, Math.floor(rules.scoreTurn(content, s, base, summary()).enemyDamage * 1.5));
  const t2 = endTurn(played);
  assert.equal(t2.statuses![0].turns, 1, 'tarpit: 2 turns, this one counted');
  assert.equal(endTurn(t2).statuses?.some((x) => x.id === 'tarpit') ?? false, false);

  // Credential Stuffer's bcrypt (2nd intent) leaves the API without CPU credit for the next 2 turns
  let c = rules.newBattle(content, 5, { enemy: 'cred_stuffer' });
  c = endTurn(c);
  assert.equal(rules.currentIntent(content, c).id, 'bcrypt');
  c = endTurn(c);
  assert.deepEqual(c.statuses, [{ id: 'cpu_credit', turns: 2, stacks: 1 }]);
  const slow = (rules.planTurn(content, c).input.scenario as { events: unknown[] }).events as { node: string; action: string; value: number }[];
  assert.ok(slow.some((e) => e.node === 'api' && e.action === 'latency' && Math.abs(e.value - 1.4) < 1e-9));
  const [hf, hu] = withCard(c, 'hotfix');
  assert.ok(((rules.planTurn(content, rules.playCard(content, hf, hu)).input.scenario as { events: unknown[] }).events as { node: string }[]).some((e) => e.node === 'api'), 'Hotfix does not cancel it');
  c = endTurn(endTurn(c));
  assert.equal(c.statuses, undefined, 'gone after 2 turns');
});

test('statuses: instances, cost, bot traffic and Ops follow the mods', () => {
  const s = rules.newBattle(content, 5, { enemy: 'swarm' });
  const api = (st: BattleState) => rules.nodeOf(rules.planTurn(content, st).input.design, 'api')!.config!;
  const before = api(s);
  const t = structuredClone(s);
  rules.addStatus(content, t, 'noisy_neighbor', 2);
  rules.addStatus(content, t, 'bill_shock', 2);
  rules.addStatus(content, t, 'geo_blocked', 2);
  rules.addStatus(content, t, 'pager_fatigue', 2);
  assert.equal(api(t).instances, Math.max(1, before.instances! - 1));
  assert.equal(api(t).costPerHour, Math.round(before.costPerHour! * 1.5 * 1000) / 1000);
  assert.equal(rules.botRpsNow(content, t), Math.round(rules.botRpsNow(content, s) * 0.7));
  assert.equal(endTurn(t).ops, content.battle.opsPerTurn - 1);
});

test('adaptation: heavy filtering adds a stack, two calm turns clear it, and the forecast matches', () => {
  const s = rules.newBattle(content, 5, { enemy: 'swarm' });
  const plan = { ...rules.planTurn(content, s), botRps: 1000, botBlockedRps: 600 };
  assert.ok(rules.adaptsNow(content, plan));
  const t2 = rules.resolveTurn(content, s, plan, summary());
  assert.deepEqual(t2.statuses, [{ id: 'adapted', turns: 2, stacks: 1 }]);
  assert.ok(rules.bypassNow(content, t2) >= 0.12 - 1e-9);
  const sum = summary({ errorRate: 0.05 });
  const p2 = rules.planTurn(content, t2);
  assert.deepEqual(rules.scoreTurn(content, t2, p2, sum).damage, rules.resolveTurn(content, t2, p2, sum).reports.at(-1)!.damage);
  const calm = (st: BattleState) => rules.resolveTurn(content, st, { ...rules.planTurn(content, st), botBlockedRps: 0 }, summary());
  assert.equal(calm(calm(t2)).statuses, undefined);
});

test('modules: a full socket needs a replacement, which undoes the old module; replaying levels up', () => {
  let s = rules.newBattle(content, 5, { enemy: 'swarm' });
  const play = (st: BattleState, id: string, replace?: number) => {
    const [h, uid] = withCard(st, id);
    return rules.playCard(content, h, uid, replace === undefined ? {} : { replace });
  };
  for (const id of ['timeout', 'backoff', 'breaker']) s = play(s, id);
  const link = rules.socketOf(content, s, 'api-db')!;
  assert.equal(rules.modulesAt(s, link.id).length, link.cap);
  assert.equal(apiCall(rules.designOf(content, s))!.timeoutMs, 250);

  const [h, uid] = withCard(s, 'pool');
  assert.deepEqual(
    rules.placements(content, h, uid).map((m) => m.replace),
    rules.modulesAt(s, link.id).map((m) => m.uid),
    'a full socket: one move per module to take out',
  );
  assert.equal(rules.playCard(content, h, uid), h, 'no free socket, no replacement: not played');
  const timeout = rules.moduleOf(s, 'timeout')!.uid;
  const swapped = rules.playCard(content, h, uid, { socket: link.id, replace: timeout });
  assert.ok(!rules.moduleOf(swapped, 'timeout') && rules.moduleOf(swapped, 'pool'));
  const out = apiCall(rules.designOf(content, swapped))!;
  assert.equal(out.timeoutMs, undefined, 'the timeout is gone with its module');
  assert.equal(out.poolSize, 8);

  // the same card again: a level, not a socket (a cache grows by its step)
  s = play(s, 'cache');
  s = play(s, 'cache');
  assert.equal(rules.moduleOf(s, 'cache')!.level, 2);
  assert.equal(rules.nodeOf(rules.designOf(content, s), 'cache')!.config!.cache!.capacity, 2000);
  assert.equal(rules.modulesAt(s, 'db-front').length, 1);
  // scale and WAF never take a socket
  s = play(play(s, 'scale_api'), 'waf');
  assert.equal(rules.modulesOf(s).length, 4);
});

test('sockets: each module plugs where it acts; other sockets are not touched', () => {
  let s = rules.newBattle(content, 5, { enemy: 'swarm' });
  s = playIn(playIn(playIn(s, 'cache'), 'replica'), 'bigger_queue');
  assert.deepEqual(
    rules.modulesOf(s).map((m) => [rules.baseId(m.card), m.socket]),
    [
      ['cache', 'db-front'],
      ['replica', 'db'],
      ['bigger_queue', 'api'],
    ],
  );
  const d = rules.designOf(content, s);
  assert.equal(rules.nodeOf(d, 'db')!.config!.instances, 2, 'replica scales the storage socket node');
  assert.ok(rules.nodeOf(d, 'cache'));
  // Index still fits the storage socket; then it is full, and Vertical has to replace one of them while the cache stays
  const both = playIn(s, 'index');
  assert.equal(rules.modulesAt(both, 'db').length, 2);
  const [h, uid] = withCard(both, 'vertical');
  assert.deepEqual(rules.placements(content, h, uid).map((m) => m.replace), [rules.moduleOf(both, 'replica')!.uid, rules.moduleOf(both, 'index')!.uid]);
  const swapped = rules.playCard(content, h, uid, { replace: rules.moduleOf(both, 'replica')!.uid });
  assert.ok(rules.moduleOf(swapped, 'cache') && rules.moduleOf(swapped, 'vertical') && !rules.moduleOf(swapped, 'replica'));
  // a call policy put in after the cache still sits on the API's call, now into the cache
  const t = playIn(s, 'timeout');
  assert.equal(apiCall(rules.designOf(content, t))!.target, 'cache');
  assert.equal(apiCall(rules.designOf(content, t))!.timeoutMs, 250);
});

test('queue: the API answers at once, the partner is called through a queue; lost async work hurts', () => {
  const s = rules.newBattle(content, 5, { enemy: 'swarm' });
  const base = rules.designOf(content, s);
  assert.ok(base.edges.some((e) => e.source === 'api' && e.target === 'ext'), 'the partner is called in line');
  const [h, uid] = withCard(s, 'queue');
  const q = rules.playCard(content, h, uid);
  const d = rules.planTurn(content, q).input.design;
  assert.ok(d.edges.some((e) => e.source === 'api' && e.target === 'queue'));
  assert.ok(d.edges.some((e) => e.source === 'queue' && e.target === 'ext'));
  assert.ok(!d.edges.some((e) => e.source === 'api' && e.target === 'ext'));
  assert.equal(apiCall(d)!.target, 'db', 'call policies stay on the data call');

  const plan = rules.planTurn(content, q);
  const sent = plan.legitRps + plan.botRps - plan.botBlockedRps;
  const lost = rules.scoreTurn(content, q, plan, summary({ asyncErr: 600, backlog: 400 })).legitFailed;
  assert.equal(lost, Math.round((1000 * plan.legitRps) / sent));
});

test('autoscaler: HPA on the API from this turn’s count, with its headroom', () => {
  const s = rules.newBattle(content, 5, { enemy: 'swarm' });
  const [h, uid] = withCard(s, 'autoscaler');
  let a = rules.playCard(content, h, uid);
  const api = (st: BattleState) => rules.nodeOf(rules.planTurn(content, st).input.design, 'api')!.config!;
  const auto = api(a).autoscale as unknown as { min: number; max: number; podStartMs: number };
  assert.equal(auto.min, api(a).instances);
  assert.equal(auto.max - auto.min, 4);
  assert.equal(auto.podStartMs, 3000);
  const [b, bu] = withCard(a, 'burst');
  a = rules.playCard(content, b, bu);
  const burst = api(a).autoscale as unknown as { min: number; max: number };
  assert.equal(burst.min, api(a).instances, 'starts from the burst count');
  assert.equal(burst.max - burst.min, 4);
});


test('module counters: the enemy reads installed modules (autoscaler → short burst, queue → poison messages)', () => {
  // Bầy Kiến's 2nd intent is a spike; with an autoscaler in, it comes as a burst too short for new pods
  let s = playIn(rules.newBattle(content, 5, { enemy: 'swarm' }), 'autoscaler');
  s = endTurn(s);
  const it = rules.currentIntent(content, s);
  assert.equal(it.label, 'Spike chớp nhoáng');
  const traffic = (rules.planTurn(content, s).input.scenario as { traffic: { atMs: number; rps: number }[] }).traffic;
  assert.equal(traffic.length, 3);
  assert.ok(traffic[1].rps > traffic[0].rps && traffic[2].rps === traffic[0].rps);
  // without it: the plain spike
  const plain = endTurn(rules.newBattle(content, 5, { enemy: 'swarm' }));
  assert.equal(rules.currentIntent(content, plain).label, 'Spike');

  const sum = summary({ errorRate: 0.1 });
  const p = rules.planTurn(content, s);
  assert.deepEqual(rules.scoreTurn(content, s, p, sum).damage, rules.resolveTurn(content, s, p, sum).reports.at(-1)!.damage);
});

test('combos: on while every module is in, off when one goes; mods and flags apply', () => {
  let s = rules.newBattle(content, 5, { enemy: 'retry_storm' });
  s = playIn(playIn(s, 'breaker'), 'retry_budget');
  assert.deepEqual(rules.activeCombos(content, s).map((c) => c.id), ['resilience']);
  // Bão Retry's drizzle: client retries; the combo shields them
  const client = (st: BattleState) => rules.planTurn(content, st).input.design.edges.find((e) => e.source === 'client')!;
  assert.ok(!client(s).retries);
  s = playIn(s, 'timeout');
  assert.ok(rules.activeCombos(content, s).some((c) => c.id === 'fail_fast'));
  assert.ok(Math.abs(rules.statusMods(content, s).apiLatency - 0.85) < 1e-9);
  const off = playIn(s, 'pool', rules.moduleOf(s, 'breaker')!.uid);
  assert.deepEqual(rules.activeCombos(content, off), [], 'the breaker went: both combos are off');
  assert.ok(client(off).retries! > 0);

  let q = playIn(playIn(rules.newBattle(content, 5, { enemy: 'swarm' }), 'queue'), 'autoscaler');
  const queue = rules.nodeOf(rules.planTurn(content, q).input.design, 'queue')!.config!;
  assert.equal((queue.autoscale as unknown as { metric: string }).metric, 'queueLength', 'KEDA: workers follow the backlog');
  q = playIn(q, 'cache');
  assert.equal(rules.modulesOf(q).length, 3, 'queue, autoscaler and cache each have their own socket');
});

test('chassis: every system plans a turn; roles and sockets point at its own nodes', () => {
  for (const ch of content.chassis) {
    const s = rules.newBattle(content, 4, { enemy: 'swarm', chassis: ch.id });
    assert.equal(s.chassis, ch.id);
    const d = rules.planTurn(content, s).input.design;
    for (const ref of ['api', 'db', 'ext'] as const) assert.ok(rules.nodeOf(d, ch.aliases[ref]), `${ch.id}: ${ref} → ${ch.aliases[ref]}`);
    for (const sk of ch.sockets) {
      const at = sk.at;
      if ('node' in at) assert.ok(rules.nodeOf(d, at.node), `${ch.id}/${sk.id}`);
      if ('before' in at) assert.ok(rules.nodeOf(d, at.before), `${ch.id}/${sk.id}`);
      if ('edge' in at) assert.ok(rules.edgeAt(d, at.edge), `${ch.id}/${sk.id}`);
    }
  }
  // microservices: a compute module goes where it is dropped, on that service only
  const m = rules.newBattle(content, 4, { enemy: 'swarm', chassis: 'microservice' });
  const [h, uid] = withCard(m, 'bigger_queue');
  assert.deepEqual(rules.placements(content, h, uid).map((x) => x.socket), ['svcA', 'svcB']);
  const q = (st: BattleState, id: string) => rules.nodeOf(rules.designOf(content, st), id)!.config!.queueSize;
  const onB = rules.playCard(content, h, uid, { socket: 'svcB' });
  assert.ok(q(onB, 'svcB')! > q(m, 'svcB')! && q(onB, 'svcA') === q(m, 'svcA'));
  // the event-driven system has no async socket: a Message Queue has nowhere to go
  const e = rules.newBattle(content, 4, { enemy: 'swarm', chassis: 'event_driven' });
  const [eh, eu] = withCard(e, 'queue');
  assert.equal(rules.canPlay(content, eh, eu), false);
});

test('run saves: a run from before chassis existed is still valid and builds on the first one', () => {
  const old = structuredClone(fresh(9)) as RunState;
  delete old.chassis;
  assert.ok(runs.isValidRun(content, old));
  assert.equal(rules.chassisDef(content, old.chassis).id, content.chassis[0].id);
  assert.ok(!runs.isValidRun(content, { ...old, chassis: 'nope' }));
});

test('new parts: CDN in front of the entry, edge filter while installed, DB shards behind a router', () => {
  const s = rules.newBattle(content, 4, { enemy: 'swarm' });
  // CDN: a warm cache every request meets first
  const c = playIn(s, 'cdn');
  const d = rules.planTurn(content, c).input.design;
  const cdn = rules.nodeOf(d, 'cdn@edge')!;
  assert.equal(cdn.kind, 'cache');
  assert.equal(cdn.config!.cache!.warm, true);
  assert.equal(d.edges.find((e) => e.source === 'client')!.target, 'cdn@edge');
  assert.ok(d.edges.some((e) => e.source === 'cdn@edge' && e.target === 'lb'));
  assert.equal(rules.nodeOf(rules.designOf(content, playIn(c, 'cdn')), 'cdn@edge')!.config!.cache!.capacity, 500, 'replaying grows it');

  // edge filter: a bot cut that lasts while the module is in, and goes with it
  const f = playIn(s, 'edge_shield');
  assert.ok(Math.abs(rules.botCutNow(content, f) - 0.2) < 1e-9);
  assert.equal(f.waf, 0, 'not a permanent WAF rule');
  const [h, uid] = withCard(f, 'cdn');
  const swapped = rules.playCard(content, h, uid, { replace: rules.moduleOf(f, 'edge_shield')!.uid });
  assert.equal(rules.botCutNow(content, swapped), 0);

  // shard: a router in front of two DBs; an incident on the DB hits one of them
  const sh = playIn(playIn(s, 'index'), 'shard');
  const sd = rules.designOf(content, sh);
  assert.ok(sd.edges.some((e) => e.source === 'api' && e.target === 'db-router'));
  assert.deepEqual(sd.edges.filter((e) => e.source === 'db-router').map((e) => e.target).sort(), ['db', 'db-2']);
  assert.equal(rules.nodeOf(sd, 'db-2')!.config!.latencyP50Ms, rules.nodeOf(sd, 'db')!.config!.latencyP50Ms, 'the shard copies the indexed DB');
  assert.equal(rules.nodeOf(sd, 'db-2')!.config!.costPerHour, 0.3);
});

test('relics can add sockets; an event can give one', () => {
  const s = rules.newBattle(content, 4, { enemy: 'swarm', relics: ['rack_link'] });
  assert.equal(rules.socketOf(content, s, 'api-db')!.cap, 4);
  assert.equal(rules.socketOf(content, rules.newBattle(content, 4, { enemy: 'swarm' }), 'api-db')!.cap, 3);
  const run = { ...structuredClone(fresh(2)), phase: 'event' as const, event: 'hardware', gold: 50 };
  const after = runs.chooseEvent(content, run, 0);
  assert.ok(after.relics.includes('rack_link'));
  assert.equal(after.gold, 10);
});

test('shard after or before the cache: the cache always sits in front of both shards', () => {
  const s = rules.newBattle(content, 4, { enemy: 'swarm' });
  for (const order of [['cache', 'shard'], ['shard', 'cache']]) {
    const d = rules.designOf(content, playIn(playIn(s, order[0]), order[1]));
    assert.ok(d.edges.some((e) => e.source === 'cache' && e.target === 'db-router'), order.join(' → '));
  }
});
