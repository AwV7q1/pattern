// Rules and run tests, no engine: turns are resolved with hand-made summaries.
// Run: pnpm --filter web test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rules from './rules.ts';
import * as runs from './run.ts';
import type { BattleState, Content, RunState } from './types';
import type { Summary } from '@/types';

const here = dirname(fileURLToPath(import.meta.url));
const data = (f: string) => JSON.parse(readFileSync(join(here, 'data', f), 'utf8'));
const content: Content = { cards: data('cards.json'), enemies: data('enemies.json'), battle: data('battle.json'), run: data('run.json') };

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
  for (const f of content.run.floors) if (f.kind === 'battle') assert.ok(enemies.has(f.enemy), f.enemy);
  for (const e of content.enemies) for (const i of e.intents) if (i.addCards) assert.ok(cards.has(i.addCards.card));
  assert.equal(content.run.floors.at(-1)?.kind, 'battle', 'a run ends on a fight');
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

// ---------------------------------------------------------------- run

const win = (run: RunState, hpLeft: number): BattleState => {
  const s = rules.newBattle(content, runs.battleSeed(run), runs.battleSetup(content, run));
  return { ...s, phase: 'won', hp: hpLeft, turn: 6 };
};

test('run: fight, reward, fight, rest, boss', () => {
  let run = runs.newRun(content, 11);
  assert.equal(run.phase, 'battle');
  assert.deepEqual(run.deck, content.battle.startingDeck);

  run = runs.finishBattle(content, run, win(run, 50));
  assert.equal(run.phase, 'reward');
  assert.equal(run.hp, 50);
  assert.equal(run.reward.length, content.run.rewardChoices);
  assert.equal(new Set(run.reward).size, run.reward.length, 'offers are distinct');
  for (const id of run.reward) assert.ok(!rules.cardDef(content, id).unplayable);

  const pick = run.reward[0];
  run = runs.pickReward(content, run, pick);
  assert.equal(run.deck.length, content.battle.startingDeck.length + 1);
  assert.equal(run.deck.at(-1), pick);
  assert.equal(run.phase, 'battle');
  assert.equal(runs.battleSetup(content, run).enemy, 'retry_storm');
  assert.equal(runs.battleSetup(content, run).hp, 50);

  run = runs.finishBattle(content, run, win(run, 30));
  run = runs.pickReward(content, run, null);
  assert.equal(run.phase, 'rest');
  assert.equal(run.history[1].picked, null);

  const healed = runs.rest(content, run, { heal: true });
  assert.equal(healed.hp, Math.min(run.maxHp, 30 + Math.ceil(run.maxHp * content.run.restHeal)));
  const trimmed = runs.rest(content, run, { remove: 0 });
  assert.equal(trimmed.deck.length, run.deck.length - 1);
  assert.equal(trimmed.hp, 30);

  run = healed;
  assert.equal(run.phase, 'battle');
  assert.equal(runs.battleSetup(content, run).enemy, 'herd');
  run = runs.finishBattle(content, run, win(run, 10));
  assert.equal(run.phase, 'won');
  assert.equal(run.history.filter((h) => h.enemy).length, 3);
});

test('run: losing a fight ends the run; invalid moves are ignored', () => {
  let run = runs.newRun(content, 4);
  assert.equal(runs.pickReward(content, run, 'cache'), run, 'no reward during a fight');
  assert.equal(runs.rest(content, run, { heal: true }), run);
  const lost = { ...win(run, 0), phase: 'lost' as const };
  run = runs.finishBattle(content, run, lost);
  assert.equal(run.phase, 'lost');
  assert.equal(run.hp, 0);

  let r2 = runs.finishBattle(content, runs.newRun(content, 4), win(runs.newRun(content, 4), 40));
  const notOffered = runs.rewardPool(content).find((id) => !r2.reward.includes(id))!;
  assert.equal(runs.pickReward(content, r2, notOffered), r2);
  r2 = runs.pickReward(content, r2, r2.reward[1]);
  assert.equal(r2.phase, 'battle');
});

test('run: same seed, same offers and fight seeds; saved runs are validated', () => {
  const a = runs.finishBattle(content, runs.newRun(content, 99), win(runs.newRun(content, 99), 40));
  const b = runs.finishBattle(content, runs.newRun(content, 99), win(runs.newRun(content, 99), 40));
  assert.deepEqual(a.reward, b.reward);
  assert.notEqual(runs.battleSeed(a), runs.battleSeed({ ...a, floor: a.floor + 1 }));

  assert.ok(runs.isValidRun(content, JSON.parse(JSON.stringify(a))));
  assert.ok(!runs.isValidRun(content, null));
  assert.ok(!runs.isValidRun(content, { ...a, deck: ['no_such_card'] }));
  assert.ok(!runs.isValidRun(content, { ...a, version: 2 }));
  assert.ok(!runs.isValidRun(content, { ...a, phase: 'rest' }), 'floor 0 is not a rest stop');
});
