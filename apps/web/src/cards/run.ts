// A run: climbing the tower ("Tháp On-Call"), `run.acts` floors high.
//
// Each floor is a seeded map (map.ts). The player picks a path node by node:
// fights (normal, elite, boss), rest stops and events. Beating a floor's boss
// climbs to the next floor; beating the last boss wins the run.
//
// Pure and seeded like rules.ts: the run only stores card ids, HP and the
// node it stands on, and each fight is a fresh `newBattle` from `battleSetup`.
//
//   let run = newRun(content, seed);                  // phase 'map'
//   run = chooseNode(content, run, reachable(content, run)[0]);
//   const battle = newBattle(content, battleSeed(run), battleSetup(content, run));
//   ...play the fight with rules.ts...
//   run = finishBattle(content, run, battleEnd);      // -> reward / cleared / won / lost
//   run = pickReward(content, run, cardId | null);    // -> map
//   run = rest(content, run, { heal: true } | { remove: index });
//   run = chooseEvent(content, run, option, removeIndex?);
//   run = nextAct(content, run);                      // after 'cleared'

import { canUpgrade, cardDef, nextRandom } from './rules.ts';
import { generateMap, mapNode } from './map.ts';
import type { BattleSetup, BattleState, Content, FloorResult, MapNode, RunEvent, RarityWeights, RelicRarity, RestChoice, RunState, Scale, ShopStock, TowerMap } from './types';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function newRun(content: Content, seed: number): RunState {
  return {
    version: 3,
    seed,
    rng: (seed ^ 0x9e3779b9) >>> 0,
    act: 1,
    node: null,
    path: [],
    climbed: 0,
    phase: 'map',
    hp: content.run.hp,
    maxHp: content.run.hp,
    deck: [...content.battle.startingDeck],
    reward: [],
    event: null,
    gold: content.run.startGold,
    removals: 0,
    shop: null,
    relics: [],
    relicOffer: [],
    history: [],
  };
}

// ---------------------------------------------------------------- relics

/** Relics of these rarities the run does not hold yet. */
const relicsLeft = (content: Content, run: RunState, rarities: RelicRarity[]) =>
  content.relics.filter((r) => rarities.includes(r.rarity) && !run.relics.includes(r.id)).map((r) => r.id);

/** One relic drawn by rarity odds (a rarity with nothing left falls through to the others); null when none is left. */
export function rollRelic(content: Content, run: RunState, odds: Partial<Record<RelicRarity, number>> = content.run.relicWeights): string | null {
  const rarities = (Object.keys(odds) as RelicRarity[]).filter((r) => relicsLeft(content, run, [r]).length);
  if (!rarities.length) return null;
  const total = rarities.reduce((sum, r) => sum + (odds[r] ?? 0), 0);
  let roll = nextRandom(run) * total;
  const rarity = rarities.find((r) => (roll -= odds[r] ?? 0) < 0) ?? rarities[rarities.length - 1];
  const left = relicsLeft(content, run, [rarity]);
  return left[Math.floor(nextRandom(run) * left.length)];
}

/** Take a relic: it joins the run and its pickup bonus applies once. */
export function gainRelic(content: Content, run: RunState, id: string) {
  const relic = content.relics.find((r) => r.id === id);
  if (!relic || run.relics.includes(id)) return;
  run.relics.push(id);
  if (relic.pickup?.maxHp) {
    run.maxHp += relic.pickup.maxHp;
    run.hp += relic.pickup.maxHp;
  }
}

/** Boss relics to pick from after a boss (rare ones once the boss pool runs dry). */
function bossOffer(content: Content, run: RunState): string[] {
  const picks: string[] = [];
  for (let i = 0; i < content.run.bossRelicChoices; i++) {
    const probe = { ...run, relics: [...run.relics, ...picks] };
    const id = rollRelic(content, probe, relicsLeft(content, probe, ['boss']).length ? { boss: 1 } : { rare: 1 });
    run.rng = probe.rng;
    if (id) picks.push(id);
  }
  return picks;
}

// ---------------------------------------------------------------- map

let memo: { key: string; content: Content; map: TowerMap } | null = null;

/** The current floor's map (rebuilt from the seed, cached). */
export function towerMap(content: Content, run: Pick<RunState, 'seed' | 'act'>): TowerMap {
  const key = `${run.seed}:${run.act}`;
  if (memo?.key !== key || memo.content !== content) memo = { key, content, map: generateMap(content, run.seed, run.act) };
  return memo.map;
}

export const currentNode = (content: Content, run: RunState): MapNode | undefined => mapNode(towerMap(content, run), run.node);

/** Nodes the player may step on next. */
export function reachable(content: Content, run: RunState): number[] {
  const map = towerMap(content, run);
  if (run.node === null) return map.nodes.filter((n) => n.row === 0).map((n) => n.id);
  return mapNode(map, run.node)?.next ?? [];
}

/** Step onto a reachable node; its kind decides the next phase. */
export function chooseNode(content: Content, prev: RunState, id: number): RunState {
  if (prev.phase !== 'map' || !reachable(content, prev).includes(id)) return prev;
  const run = clone(prev);
  const node = mapNode(towerMap(content, run), id)!;
  run.node = id;
  run.path.push(id);
  run.climbed++;
  if (node.kind === 'rest') run.phase = 'rest';
  else if (node.kind === 'shop') {
    run.phase = 'shop';
    run.shop = stock(content, run);
  } else if (node.kind === 'event') {
    run.phase = 'event';
    run.event = pickEvent(content, run).id;
  } else run.phase = 'battle';
  return run;
}

function pickEvent(content: Content, run: RunState): RunEvent {
  const seen = new Set(run.history.filter((h) => h.kind === 'event').map((h) => h.enemy));
  const fresh = content.events.filter((e) => !seen.has(e.id));
  const pool = fresh.length ? fresh : content.events;
  return pool[Math.floor(nextRandom(run) * pool.length)];
}

export const currentEvent = (content: Content, run: RunState) => content.events.find((e) => e.id === run.event);

// ---------------------------------------------------------------- fights

/** Seed of the current node's fight: the same run always deals the same hands. */
export const battleSeed = (run: RunState) => (Math.imul(run.seed, 31) + run.climbed + 1) >>> 0;

export const bossOf = (content: Content, act: number) => content.run.bosses[(act - 1) % content.run.bosses.length];

/** Enemies a floor's normal (or elite) fights draw from. */
export function poolOf(content: Content, act: number, kind: 'battle' | 'elite'): string[] {
  const lists = kind === 'elite' ? content.run.elites : content.run.normal;
  return lists[(act - 1) % lists.length];
}

function enemyOf(content: Content, run: RunState, node: MapNode): string {
  if (node.kind === 'boss') return bossOf(content, run.act);
  const list = poolOf(content, run.act, node.kind === 'elite' ? 'elite' : 'battle');
  const r = { rng: (battleSeed(run) ^ 0x5bd1e995) >>> 0 };
  // the fight just before on this floor was against someone else, if the pool allows
  const last = run.history.filter((h) => h.act === run.act && h.kind === node.kind).at(-1)?.enemy;
  const options = list.length > 1 ? list.filter((id) => id !== last) : list;
  return options[Math.floor(nextRandom(r) * options.length)];
}

function scaleOf(content: Content, run: RunState, node: MapNode): Scale {
  const { actScale, fight, elite, boss } = content.run;
  const k = node.kind === 'elite' ? elite : node.kind === 'boss' ? boss : fight;
  const up = run.act - 1;
  return { hp: k.hp * (1 + actScale.hp * up), rps: k.rps * (1 + actScale.rps * up) };
}

export function battleSetup(content: Content, run: RunState): BattleSetup {
  const node = currentNode(content, run);
  if (!node || (node.kind !== 'battle' && node.kind !== 'elite' && node.kind !== 'boss')) throw new Error(`node ${run.node} is not a fight`);
  return { enemy: enemyOf(content, run, node), hp: run.hp, maxHp: run.maxHp, deck: run.deck, enemyScale: scaleOf(content, run, node), relics: run.relics };
}

/** Title of the current fight, e.g. "Tinh anh: Bão Retry". */
export function battleTitle(content: Content, run: RunState): string {
  const node = currentNode(content, run);
  const enemy = content.enemies.find((e) => e.id === battleSetup(content, run).enemy)!;
  if (node?.kind === 'boss') return `Trùm tầng ${run.act}: ${enemy.name}`;
  if (node?.kind === 'elite') return `Tinh anh: ${enemy.name}`;
  return enemy.name;
}

/** Cards that can be offered: every playable card but the starting basics. */
export const rewardPool = (content: Content) => content.cards.filter((c) => !c.unplayable && c.rarity !== 'basic').map((c) => c.id);

/** `n` different cards, each drawn by rarity odds first, then evenly within that rarity. */
function offer(content: Content, run: RunState, n: number, odds: RarityWeights = content.run.rarityWeights.battle): string[] {
  const pool = rewardPool(content);
  const byRarity = (r: string) => pool.filter((id) => (cardDef(content, id).rarity ?? 'common') === r);
  const picks: string[] = [];
  while (picks.length < Math.min(n, pool.length)) {
    const rarities = (Object.keys(odds) as (keyof RarityWeights)[]).filter((r) => byRarity(r).some((id) => !picks.includes(id)));
    const total = rarities.reduce((sum, r) => sum + odds[r], 0);
    let roll = nextRandom(run) * total;
    const rarity = rarities.find((r) => (roll -= odds[r]) < 0) ?? rarities[rarities.length - 1];
    const left = byRarity(rarity).filter((id) => !picks.includes(id));
    picks.push(left[Math.floor(nextRandom(run) * left.length)]);
  }
  return picks;
}

/** Record a finished fight (won or lost): reward, next floor, or the end of the run. */
export function finishBattle(content: Content, prev: RunState, battle: BattleState): RunState {
  if (prev.phase !== 'battle' || (battle.phase !== 'won' && battle.phase !== 'lost')) return prev;
  const run = clone(prev);
  const node = currentNode(content, run)!;
  const won = battle.phase === 'won';
  run.history.push({ act: run.act, kind: node.kind, enemy: battle.enemy.id, won, turns: battle.turn, hpLost: run.hp - battle.hp });
  run.hp = battle.hp;
  if (!won) {
    run.phase = 'lost';
    return run;
  }
  const gold = Math.max(0, content.run.gold[node.kind as 'battle' | 'elite' | 'boss'] + Math.floor((nextRandom(run) * 2 - 1) * (content.run.goldJitter + 1)));
  run.gold += gold;
  run.history.at(-1)!.gold = gold;
  if (node.kind === 'boss') {
    run.phase = run.act >= content.run.acts ? 'won' : 'cleared';
    if (run.phase === 'cleared') run.relicOffer = bossOffer(content, run);
    return run;
  }
  let choices = content.run.rewardChoices;
  if (node.kind === 'elite') {
    run.maxHp += content.run.elite.maxHp;
    run.hp += content.run.elite.maxHp;
    choices++;
    const relic = rollRelic(content, run);
    if (relic) {
      gainRelic(content, run, relic);
      run.history.at(-1)!.relic = relic;
    }
  }
  run.phase = 'reward';
  run.reward = offer(content, run, choices, content.run.rarityWeights[node.kind === 'elite' ? 'elite' : 'battle']);
  return run;
}

/** Take one of the offered cards (or `null` to skip) and go back to the map. */
export function pickReward(content: Content, prev: RunState, cardId: string | null): RunState {
  if (prev.phase !== 'reward' || (cardId !== null && !prev.reward.includes(cardId))) return prev;
  const run = clone(prev);
  if (cardId) {
    cardDef(content, cardId);
    run.deck.push(cardId);
  }
  const last = run.history.at(-1);
  if (last) last.picked = cardId;
  run.reward = [];
  run.phase = 'map';
  return run;
}

/** A card can be removed only while the deck stays bigger than a hand. */
export const canRemove = (content: Content, run: RunState, index: number) =>
  index >= 0 && index < run.deck.length && run.deck.length > content.battle.handSize;

/** Heal a share of max HP, remove one card from the deck, or upgrade one (by index). */
export function rest(content: Content, prev: RunState, choice: RestChoice): RunState {
  if (prev.phase !== 'rest') return prev;
  if ('remove' in choice && !canRemove(content, prev, choice.remove)) return prev;
  if ('upgrade' in choice && !canUpgrade(content, prev.deck[choice.upgrade] ?? '')) return prev;
  const run = clone(prev);
  if ('heal' in choice) {
    const healed = Math.min(run.maxHp - run.hp, Math.ceil(run.maxHp * content.run.restHeal));
    run.hp += healed;
    run.history.push({ act: run.act, kind: 'rest', enemy: '', won: true, turns: 0, hpLost: 0, healed });
  } else if ('upgrade' in choice) {
    const id = run.deck[choice.upgrade];
    run.deck[choice.upgrade] = `${id}+`;
    run.history.push({ act: run.act, kind: 'rest', enemy: '', won: true, turns: 0, hpLost: 0, upgraded: id });
  } else {
    const [removed] = run.deck.splice(choice.remove, 1);
    run.history.push({ act: run.act, kind: 'rest', enemy: '', won: true, turns: 0, hpLost: 0, removed });
  }
  run.phase = 'map';
  return run;
}

/** Take an event option. Options that remove a card need the deck index. */
export function chooseEvent(content: Content, prev: RunState, option: number, removeIndex?: number): RunState {
  const event = currentEvent(content, prev);
  const opt = event?.options[option];
  if (prev.phase !== 'event' || !event || !opt) return prev;
  if (opt.effects.some((e) => e.op === 'removeCard') && (removeIndex === undefined || !canRemove(content, prev, removeIndex))) return prev;
  const run = clone(prev);
  const entry: FloorResult & { added: string[]; healed: number } = { act: run.act, kind: 'event', enemy: event.id, won: true, turns: 0, hpLost: 0, option: opt.label, added: [], healed: 0, removed: undefined };
  let pick = false;
  for (const e of opt.effects) {
    if (e.op === 'heal') {
      const n = Math.min(run.maxHp - run.hp, e.n);
      run.hp += n;
      entry.healed += n;
    } else if (e.op === 'damage') {
      // events hurt, but never end a run on their own
      const n = Math.min(run.hp - 1, e.n);
      run.hp -= n;
      entry.hpLost += n;
    } else if (e.op === 'maxHp') {
      run.maxHp += e.n;
      run.hp += e.n;
    } else if (e.op === 'addCard') {
      cardDef(content, e.card);
      run.deck.push(e.card);
      entry.added.push(e.card);
    } else if (e.op === 'randomCard') {
      const [id] = offer(content, run, 1);
      run.deck.push(id);
      entry.added.push(id);
    } else if (e.op === 'removeCard') {
      entry.removed = run.deck.splice(removeIndex!, 1)[0];
    } else if (e.op === 'gold') {
      const n = Math.max(-run.gold, e.n);
      run.gold += n;
      entry.gold = (entry.gold ?? 0) + n;
    } else if (e.op === 'pickCard') pick = true;
  }
  run.history.push(entry);
  run.event = null;
  if (pick) {
    run.phase = 'reward';
    run.reward = offer(content, run, content.run.rewardChoices);
  } else run.phase = 'map';
  return run;
}

// ---------------------------------------------------------------- shop

const jitterPrice = (run: RunState, price: number) => Math.round(price * (0.9 + nextRandom(run) * 0.2));

/** What a shop sells: cards by rarity odds, relics, each with a slightly varied price. */
function stock(content: Content, run: RunState): ShopStock {
  const { shop } = content.run;
  const cards = offer(content, run, shop.cards).map((id) => ({ id, price: jitterPrice(run, shop.cardPrice[(cardDef(content, id).rarity ?? 'common') as keyof typeof shop.cardPrice]) }));
  const relics: ShopStock['relics'] = [];
  for (let i = 0; i < shop.relics; i++) {
    const probe = { ...run, relics: [...run.relics, ...relics.map((r) => r.id)] };
    const id = rollRelic(content, probe);
    run.rng = probe.rng;
    if (id) relics.push({ id, price: jitterPrice(run, shop.relicPrice[content.relics.find((r) => r.id === id)!.rarity as keyof typeof shop.relicPrice]) });
  }
  return { cards, relics, removed: false };
}

/** Price of the card removal service at this point of the run. */
export const removePriceOf = (content: Content, run: RunState) => content.run.shop.removePrice + content.run.shop.removeStep * run.removals;

/** Buy a card or a relic of the shop (by its index in the stock). */
export function buy(content: Content, prev: RunState, item: { card: number } | { relic: number }): RunState {
  if (prev.phase !== 'shop' || !prev.shop) return prev;
  const slot = 'card' in item ? prev.shop.cards[item.card] : prev.shop.relics[item.relic];
  if (!slot || slot.sold || slot.price > prev.gold) return prev;
  const run = clone(prev);
  const shop = run.shop!;
  const bought = 'card' in item ? shop.cards[item.card] : shop.relics[item.relic];
  bought.sold = true;
  run.gold -= bought.price;
  if ('card' in item) run.deck.push(bought.id);
  else gainRelic(content, run, bought.id);
  shopEntry(run).bought!.push(bought.id);
  shopEntry(run).gold! -= bought.price;
  return run;
}

/** Remove a card of the deck (by index), once per shop. */
export function shopRemove(content: Content, prev: RunState, index: number): RunState {
  if (prev.phase !== 'shop' || !prev.shop || prev.shop.removed) return prev;
  const price = removePriceOf(content, prev);
  if (price > prev.gold || !canRemove(content, prev, index)) return prev;
  const run = clone(prev);
  run.gold -= price;
  run.removals++;
  run.shop!.removed = true;
  const entry = shopEntry(run);
  entry.removed = run.deck.splice(index, 1)[0];
  entry.gold! -= price;
  return run;
}

export function leaveShop(_content: Content, prev: RunState): RunState {
  if (prev.phase !== 'shop') return prev;
  const run = clone(prev);
  shopEntry(run);
  run.shop = null;
  run.phase = 'map';
  return run;
}

/** The history entry of the shop the player stands in (created on the first purchase). */
function shopEntry(run: RunState): FloorResult {
  const last = run.history.at(-1);
  if (last?.kind === 'shop' && last.node === run.node && last.act === run.act) return last;
  const entry: FloorResult = { act: run.act, kind: 'shop', enemy: '', won: true, turns: 0, hpLost: 0, node: run.node ?? undefined, gold: 0, bought: [] };
  run.history.push(entry);
  return entry;
}

/** After a boss: take one of the offered boss relics (or none) and climb to the next floor, healing a share of max HP. */
export function nextAct(content: Content, prev: RunState, relic: string | null = null): RunState {
  if (prev.phase !== 'cleared' || (relic !== null && !prev.relicOffer.includes(relic))) return prev;
  const run = clone(prev);
  if (relic) {
    gainRelic(content, run, relic);
    const last = run.history.at(-1);
    if (last) last.relic = relic;
  }
  run.relicOffer = [];
  run.act++;
  run.hp = Math.min(run.maxHp, run.hp + Math.ceil(run.maxHp * content.run.actHeal));
  run.node = null;
  run.path = [];
  run.phase = 'map';
  return run;
}

/** HP restored by `nextAct`. */
export const actHealOf = (content: Content, run: RunState) => Math.min(run.maxHp - run.hp, Math.ceil(run.maxHp * content.run.actHeal));

/** Steps of a floor: the map rows plus the boss. */
export const stepsPerAct = (content: Content) => content.run.map.rows + 1;

// ---------------------------------------------------------------- saves

/** A saved run is only resumed if it still matches the content (cards, events and maps may change between versions). */
export function isValidRun(content: Content, v: unknown): v is RunState {
  if (!v || typeof v !== 'object') return false;
  const r = v as RunState;
  const isCard = (id: unknown) => typeof id === 'string' && (content.cards.some((c) => c.id === id) || (id.endsWith('+') && canUpgrade(content, id.slice(0, -1))));
  const isRelic = (id: unknown) => content.relics.some((x) => x.id === id);
  if (
    !(
      r.version === 3 &&
      Number.isInteger(r.seed) &&
      Number.isInteger(r.rng) &&
      Number.isInteger(r.act) &&
      r.act >= 1 &&
      r.act <= content.run.acts &&
      Number.isInteger(r.climbed) &&
      ['map', 'battle', 'reward', 'rest', 'event', 'shop', 'cleared', 'won', 'lost'].includes(r.phase) &&
      Array.isArray(r.deck) &&
      r.deck.every(isCard) &&
      Array.isArray(r.reward) &&
      r.reward.every(isCard) &&
      Number.isInteger(r.gold) &&
      Number.isInteger(r.removals) &&
      (r.shop === null || (typeof r.shop === 'object' && r.shop.cards.every((c) => isCard(c.id)) && r.shop.relics.every((x) => isRelic(x.id)))) &&
      Array.isArray(r.relics) &&
      r.relics.every(isRelic) &&
      Array.isArray(r.relicOffer) &&
      r.relicOffer.every(isRelic) &&
      Array.isArray(r.path) &&
      Array.isArray(r.history) &&
      typeof r.hp === 'number' &&
      typeof r.maxHp === 'number'
    )
  )
    return false;
  const map = towerMap(content, r);
  if (!r.path.every((id) => mapNode(map, id))) return false;
  if (r.node !== null && !mapNode(map, r.node)) return false;
  const kind = mapNode(map, r.node)?.kind;
  if (r.phase === 'battle' && kind !== 'battle' && kind !== 'elite' && kind !== 'boss') return false;
  if (r.phase === 'rest' && kind !== 'rest') return false;
  if (r.phase === 'shop' && (kind !== 'shop' || !r.shop)) return false;
  if (r.phase === 'event' && !content.events.some((e) => e.id === r.event)) return false;
  if ((r.phase === 'cleared' || r.phase === 'won') && kind !== 'boss') return false;
  return true;
}
