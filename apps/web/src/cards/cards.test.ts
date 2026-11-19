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
import type { Summary } from '@/types';

const here = dirname(fileURLToPath(import.meta.url));
const data = (f: string) => JSON.parse(readFileSync(join(here, 'data', f), 'utf8'));
const content: Content = { cards: data('cards.json'), enemies: data('enemies.json'), battle: data('battle.json'), run: data('run.json'), events: data('events.json'), relics: data('relics.json') };

const summary = (s: Partial<Summary> = {}) => ({ errorRate: 0, p50Ms: 20, p99Ms: 50, costPerHour: 1, throughputRps: 300, ...s }) as Summary;

/** Put a card in hand (replacing the first one) and give enough Ops to play it. */
function withCard(s: BattleState, id: string): [BattleState, number] {
  const next = structuredClone(s);
  const uid = next.nextUid++;
  next.hand[0] = { uid, id };
  next.ops = 10;
  return [next, uid];
}

const endTurn = (s: BattleState, sum = summary()) => rules.resolveTurn(content, s, rules.planTurn(content, s), sum);

test('content: every id referenced exists', () => {
  const cards = new Set(content.cards.map((c) => c.id));
  const enemies = new Set(content.enemies.map((e) => e.id));
  for (const id of content.battle.startingDeck) assert.ok(cards.has(id), id);
  assert.ok(enemies.has(content.battle.enemy));
  for (const id of [...content.run.normal.flat(), ...content.run.elites.flat(), ...content.run.bosses]) assert.ok(enemies.has(id), id);
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
  assert.ok(rules.nodeOf(s.design, 'cache'), 'cache node added');
  assert.equal(rules.apiOut(s.design)?.target, 'cache');

  const p50 = rules.nodeOf(s.design, 'db')!.config!.latencyP50Ms!;
  [s, uid] = withCard(s, 'index');
  s = rules.playCard(content, s, uid);
  assert.ok(rules.nodeOf(s.design, 'db')!.config!.latencyP50Ms! < p50);

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

test('run: starts on the map; only reachable nodes can be chosen', () => {
  const run = runs.newRun(content, 11);
  assert.equal(run.phase, 'map');
  assert.equal(run.act, 1);
  assert.deepEqual(run.deck, content.battle.startingDeck);
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
  let run = runs.chooseNode(content, runs.newRun(content, 11), runs.reachable(content, runs.newRun(content, 11))[0]);
  const setup = runs.battleSetup(content, run);
  assert.ok(runs.poolOf(content, 1, 'battle').includes(setup.enemy!));
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
  let run = climbTo(runs.newRun(content, 21), 'elite');
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

  const third = { ...runs.newRun(content, 21), act: 3 };
  const node = runs.towerMap(content, third).nodes.find((n) => n.row === 0)!;
  const high = runs.battleSetup(content, { ...third, node: node.id, phase: 'battle' });
  const f = content.run.fight;
  assert.deepEqual(high.enemyScale, { hp: f.hp * (1 + 2 * content.run.actScale.hp), rps: f.rps * (1 + 2 * content.run.actScale.rps) });
});

test('run: boss clears the floor, the last boss wins the tower', () => {
  let run = climbTo(runs.newRun(content, 31), 'boss');
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
  let run = runs.newRun(content, 4);
  run = runs.chooseNode(content, run, runs.reachable(content, run)[0]);
  run = runs.finishBattle(content, run, lose(run));
  assert.equal(run.phase, 'lost');
  assert.equal(run.hp, 0);
  assert.equal(runs.chooseNode(content, run, runs.currentNode(content, run)!.next[0]), run);
});

test('run: rest stops and events', () => {
  const base = { ...runs.newRun(content, 8), hp: 30 };
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
  const a = runs.finishBattle(content, climbTo(runs.newRun(content, 99), 'battle'), win(climbTo(runs.newRun(content, 99), 'battle'), 40));
  const b = runs.finishBattle(content, climbTo(runs.newRun(content, 99), 'battle'), win(climbTo(runs.newRun(content, 99), 'battle'), 40));
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

  const base = runs.newRun(content, 8);
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
  let run = climbTo(runs.newRun(content, 21), 'elite');
  run = runs.finishBattle(content, run, win(run, run.hp));
  assert.equal(run.relics.length, 1);
  assert.equal(run.history.at(-1)!.relic, run.relics[0]);

  let boss = climbTo(runs.newRun(content, 31), 'boss');
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
  let run = climbTo(runs.newRun(content, 11), 'battle');
  assert.equal(run.gold, content.run.startGold);
  run = runs.finishBattle(content, run, win(run, run.hp));
  const won = run.gold - content.run.startGold;
  assert.ok(Math.abs(won - content.run.gold.battle) <= content.run.goldJitter + 1, `won ${won}`);
  assert.equal(run.history.at(-1)!.gold, won);

  // every floor has a shop
  for (let act = 1; act <= content.run.acts; act++) assert.ok(generateMap(content, 11, act).nodes.some((n) => n.kind === 'shop'), `act ${act}`);
  let shop = climbTo({ ...runs.newRun(content, 11), gold: 500 }, 'shop');
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
  assert.equal(rules.planTurn(content, boss('black_friday')).legitRps, Math.round(content.battle.legitRps * 1.6));
  const poisoned = boss('cache_poisoner');
  const [withCache, uid] = withCard({ ...poisoned, temp: { ...poisoned.temp, hotfix: true } }, 'cache');
  const plan = rules.planTurn(content, rules.playCard(content, withCache, uid));
  const cache = plan.input.design.nodes.find((n) => n.id === 'cache')!;
  assert.equal(cache.config!.hitRate, 0.7 * content.enemies.find((e) => e.id === 'cache_poisoner')!.passive!.cacheHitScale!);
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
  // a floor's fights land on that floor's pool
  for (const act of [1, 2, 3]) {
    const run = { ...runs.newRun(content, 5), act };
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
