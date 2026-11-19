// A run ("ca trực"): a short chain of fights with rewards and a rest stop.
//
// Pure and seeded like rules.ts: the run only stores card ids and HP between
// fights, and each fight is a fresh `newBattle` built from `battleSetup`.
//
//   let run = newRun(content, seed);
//   const battle = newBattle(content, battleSeed(run), battleSetup(content, run));
//   ...play the fight with rules.ts...
//   run = finishBattle(content, run, battleEnd);  // -> reward / won / lost
//   run = pickReward(content, run, cardId | null); // -> next battle / rest
//   run = rest(content, run, { heal: true } | { remove: index });

import { cardDef, nextRandom } from './rules.ts';
import type { BattleSetup, BattleState, Content, Floor, RunState } from './types';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function newRun(content: Content, seed: number): RunState {
  const b = content.battle;
  return {
    version: 1,
    seed,
    rng: (seed ^ 0x9e3779b9) >>> 0,
    floor: 0,
    phase: phaseOf(content.run.floors[0]),
    hp: content.run.hp,
    maxHp: content.run.hp,
    deck: [...b.startingDeck],
    reward: [],
    history: [],
  };
}

const phaseOf = (floor: Floor | undefined) => (floor?.kind === 'rest' ? 'rest' : 'battle');

export const currentFloor = (content: Content, run: RunState): Floor | undefined => content.run.floors[run.floor];

/** Seed of the current floor's fight: the same run always deals the same hands. */
export const battleSeed = (run: RunState) => (Math.imul(run.seed, 31) + run.floor + 1) >>> 0;

export function battleSetup(content: Content, run: RunState): BattleSetup {
  const floor = currentFloor(content, run);
  if (floor?.kind !== 'battle') throw new Error(`floor ${run.floor} is not a battle`);
  return { enemy: floor.enemy, hp: run.hp, maxHp: run.maxHp, deck: run.deck };
}

/** Cards that can be offered: every playable card. */
export const rewardPool = (content: Content) => content.cards.filter((c) => !c.unplayable).map((c) => c.id);

function offer(content: Content, run: RunState): string[] {
  const pool = rewardPool(content);
  const picks: string[] = [];
  while (picks.length < Math.min(content.run.rewardChoices, pool.length)) {
    const id = pool[Math.floor(nextRandom(run) * pool.length)];
    if (!picks.includes(id)) picks.push(id);
  }
  return picks;
}

function advance(content: Content, run: RunState) {
  run.floor++;
  run.reward = [];
  run.phase = run.floor >= content.run.floors.length ? 'won' : phaseOf(content.run.floors[run.floor]);
}

/** Record a finished fight (won or lost) and move to the reward, or end the run. */
export function finishBattle(content: Content, prev: RunState, battle: BattleState): RunState {
  if (prev.phase !== 'battle' || (battle.phase !== 'won' && battle.phase !== 'lost')) return prev;
  const run = clone(prev);
  const won = battle.phase === 'won';
  run.history.push({ floor: run.floor, enemy: battle.enemy.id, won, turns: battle.turn, hpLost: run.hp - battle.hp });
  run.hp = battle.hp;
  if (!won) {
    run.phase = 'lost';
    return run;
  }
  if (run.floor === content.run.floors.length - 1) {
    advance(content, run);
    return run;
  }
  run.phase = 'reward';
  run.reward = offer(content, run);
  return run;
}

/** Take one of the offered cards (or `null` to skip) and go on. */
export function pickReward(content: Content, prev: RunState, cardId: string | null): RunState {
  if (prev.phase !== 'reward' || (cardId !== null && !prev.reward.includes(cardId))) return prev;
  const run = clone(prev);
  if (cardId) {
    cardDef(content, cardId);
    run.deck.push(cardId);
  }
  const last = run.history.at(-1);
  if (last) last.picked = cardId;
  advance(content, run);
  return run;
}

/** Heal a share of max HP, or remove one card from the deck (by index). */
export function rest(content: Content, prev: RunState, choice: { heal: true } | { remove: number }): RunState {
  if (prev.phase !== 'rest') return prev;
  if ('remove' in choice && (choice.remove < 0 || choice.remove >= prev.deck.length || prev.deck.length <= content.battle.handSize)) return prev;
  const run = clone(prev);
  if ('heal' in choice) {
    const healed = Math.min(run.maxHp - run.hp, Math.ceil(run.maxHp * content.run.restHeal));
    run.hp += healed;
    run.history.push({ floor: run.floor, enemy: '', won: true, turns: 0, hpLost: 0, healed });
  } else {
    const [removed] = run.deck.splice(choice.remove, 1);
    run.history.push({ floor: run.floor, enemy: '', won: true, turns: 0, hpLost: 0, removed });
  }
  advance(content, run);
  return run;
}

/** A saved run is only resumed if it still matches the content (cards and floors may change between versions). */
export function isValidRun(content: Content, v: unknown): v is RunState {
  if (!v || typeof v !== 'object') return false;
  const r = v as RunState;
  const ids = new Set(content.cards.map((c) => c.id));
  return (
    r.version === 1 &&
    Number.isInteger(r.seed) &&
    Number.isInteger(r.floor) &&
    r.floor >= 0 &&
    r.floor <= content.run.floors.length &&
    ['battle', 'reward', 'rest', 'won', 'lost'].includes(r.phase) &&
    (r.phase !== 'battle' || content.run.floors[r.floor]?.kind === 'battle') &&
    (r.phase !== 'rest' || content.run.floors[r.floor]?.kind === 'rest') &&
    Array.isArray(r.deck) &&
    r.deck.every((id) => ids.has(id)) &&
    Array.isArray(r.reward) &&
    r.reward.every((id) => ids.has(id)) &&
    Array.isArray(r.history) &&
    typeof r.hp === 'number' &&
    typeof r.maxHp === 'number'
  );
}
