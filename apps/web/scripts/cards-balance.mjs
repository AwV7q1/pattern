// Balance check for the card battle prototype: bots play many seeded fights
// through the real engine (Node WASM build) and report win rate, turns and HP.
// Usage: node --experimental-strip-types apps/web/scripts/cards-balance.mjs [fights=20] [--log] [--run]
// --run: climb the whole tower (map paths, fights, rewards, rests, events) instead of the single first fight.
// --by-enemy (with --run): also list win rate and HP lost per enemy.
// --only=greedy: run just these policies (comma list).
// --jobs=4 (with --run): split the seeds over 4 processes.
// --chassis=monolith: the system to build on (data/chassis.json; default the first).
// --each: every normal and elite enemy, one by one, unscaled, at 80 HP (the "rut" policy uses its fixed deck).
// Policies: idle, random, greedy (a reasonable human playing from a fixed priority list), forecast (plays the card
// whose engine forecast is best, like a player reading the Dự kiến panel), rut (one fixed cache → scale → rate limit line, never
// takes a card), cacheOnly and filterOnly (single-axis builds: if one of them clears the tower often, the
// game has a dominant line again).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const require = createRequire(import.meta.url);
const wasm = require(join(root, 'crates/engine-wasm/pkg-node/pattern_engine_wasm.js'));
const rules = await import('../src/cards/rules.ts');
const runs = await import('../src/cards/run.ts');

const data = (f) => JSON.parse(readFileSync(join(here, '../src/cards/data', f), 'utf8'));
const content = { cards: data('cards.json'), enemies: data('enemies.json'), battle: data('battle.json'), run: data('run.json'), events: data('events.json'), relics: data('relics.json'), minions: data('minions.json'), statuses: data('statuses.json'), combos: data('combos.json'), chassis: data('chassis.json') };

// BALANCE_RUN='{"fight":{"hp":0.6}}': merge over run.json (one level deep), to try difficulty knobs without editing it.
if (process.env.BALANCE_RUN) {
  for (const [k, v] of Object.entries(JSON.parse(process.env.BALANCE_RUN)))
    content.run[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...content.run[k], ...v } : v;
}

const fights = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 20);
const verbose = process.argv.includes('--log');
const runMode = process.argv.includes('--run');
const byEnemy = process.argv.includes('--by-enemy');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const eachMode = process.argv.includes('--each');
const chassis = process.argv.find((a) => a.startsWith('--chassis='))?.slice(10) ?? content.chassis[0].id;
if (!content.chassis.some((c) => c.id === chassis)) throw new Error(`unknown chassis ${chassis}`);
const run = (input) => JSON.parse(wasm.run_headless(JSON.stringify(input)));
// The forecast bot asks the engine about the same plan many times: memoise by input.
const memo = new Map();
const runCached = (input) => {
  const key = JSON.stringify(input);
  let out = memo.get(key);
  if (!out) {
    if (memo.size > 4000) memo.clear();
    out = JSON.parse(wasm.run_headless(key));
    memo.set(key, out);
  }
  return out;
};

// Policies: which card to play next (uid) or null to end the turn.
const policies = {
  idle: () => null,
  random: (s, rnd) => {
    const playable = s.hand.filter((c) => rules.canPlay(content, s, c.uid));
    if (!playable.length) return null;
    const uid = playable[Math.floor(rnd() * playable.length)].uid;
    const moves = rules.placements(content, s, uid);
    if (!moves.length) return uid;
    return { uid, ...moves[Math.floor(rnd() * moves.length)] };
  },
};

// Smart policies play the first card of their list that is playable and useful now.
const SMART = {
  // A reasonable human: infra first, then defend on big intents, otherwise attack.
  greedy: {
    big: ['coffee', 'refactor', 'rollback', 'restart', 'cache', 'cache_key', 'swr', 'index', 'timeout', 'pool', 'queue', 'autoscaler', 'retry_budget', 'backoff', 'breaker', 'hotfix', 'load_shed', 'rate_limit', 'captcha', 'burst', 'stale', 'buffer', 'postmortem', 'runbook', 'null_route', 'geo_block', 'tarpit', 'waf', 'replica', 'scale_api', 'vertical', 'block_ip', 'patch', 'honeypot'],
    calm: ['coffee', 'refactor', 'rollback', 'restart', 'cache', 'cache_key', 'swr', 'index', 'timeout', 'pool', 'queue', 'autoscaler', 'retry_budget', 'backoff', 'waf', 'runbook', 'postmortem', 'tarpit', 'honeypot', 'geo_block', 'block_ip', 'patch', 'null_route', 'rate_limit', 'captcha', 'breaker', 'replica', 'scale_api', 'stale', 'buffer', 'burst'],
    // what to take, best first; past `keep` cards it only takes the first `core` of them, to keep the deck thin
    want: ['cache', 'index', 'scale_api', 'rate_limit', 'retry_budget', 'hotfix', 'rollback', 'breaker', 'waf', 'queue', 'autoscaler', 'captcha', 'null_route', 'timeout', 'swr', 'cache_key', 'restart', 'refactor', 'runbook', 'honeypot', 'pool', 'backoff', 'geo_block', 'tarpit'],
    keep: 18,
    core: 7,
  },
  // The rut the research doc measured: the same seven cards in the same order, every fight.
  rut: {
    big: ['cache', 'scale_api', 'index', 'timeout', 'rate_limit', 'patch', 'buffer'],
    want: [],
    // the old starting deck (it held cache and index) plus one more rate limit and scale: the line measured in phase 1
    deck: ['patch', 'patch', 'patch', 'patch', 'buffer', 'buffer', 'buffer', 'buffer', 'scale_api', 'rate_limit', 'cache', 'timeout', 'index', 'rate_limit', 'scale_api'],
  },
  // The same line from today's starting deck: take Redis at the start, then never another card.
  thin: {
    big: ['cache', 'scale_api', 'index', 'timeout', 'rate_limit', 'patch', 'buffer'],
    want: [],
    deck: [...content.battle.startingDeck, 'cache'],
  },
  // Single axis: make the system fast (cache, DB, scale) and nothing else.
  cacheOnly: {
    big: ['coffee', 'refactor', 'rollback', 'cache', 'cache_key', 'swr', 'index', 'queue', 'autoscaler', 'scale_api', 'replica', 'vertical', 'bigger_queue', 'timeout', 'pool', 'stale', 'buffer', 'postmortem', 'runbook', 'patch', 'block_ip', 'honeypot'],
    want: ['cache', 'index', 'queue', 'autoscaler', 'replica', 'vertical', 'scale_api', 'swr', 'cache_key', 'pool', 'timeout', 'runbook', 'refactor', 'rollback'],
  },
  // Single axis: filter bots (WAF, rate limit, captcha) and hit the botnet.
  filterOnly: {
    big: ['coffee', 'refactor', 'rollback', 'tarpit', 'waf', 'rate_limit', 'captcha', 'null_route', 'geo_block', 'honeypot', 'block_ip', 'patch', 'stale', 'buffer', 'postmortem', 'runbook'],
    want: ['waf', 'captcha', 'rate_limit', 'null_route', 'geo_block', 'tarpit', 'honeypot', 'block_ip', 'runbook', 'refactor', 'rollback'],
  },
};

function useless(id, s, intent) {
  if (id === 'hotfix') return !rules.hotfixable(intent);
  if (id === 'cache') return (rules.nodeOf(rules.designOf(content, s), 'cache')?.config.cache?.capacity ?? 0) >= 4000;
  if (id === 'cache_key') return !!s.cache?.normalize;
  if (id === 'swr') return !!s.cache?.swr;
  if (id === 'restart') return (s.enemy.leak ?? 0) < 0.6;
  if (id === 'refactor') return !s.hand.some((h) => h.id === 'tech_debt');
  if (id === 'rollback') {
    const bad = (s.statuses ?? []).filter((x) => rules.statusDef(content, x.id).kind === 'debuff');
    return !bad.length || (bad.length === 1 && bad[0].id === 'adapted' && bad[0].stacks < 2);
  }
  if (id === 'tarpit' || id === 'geo_block') return (s.statuses ?? []).some((x) => x.id === (id === 'tarpit' ? 'tarpit' : 'geo_blocked') && x.turns > 1) && id === 'tarpit';
  if (id === 'index') return rules.nodeOf(rules.designOf(content, s), 'db').config.latencyP50Ms < 5;
  // a module already in: playing it again only levels it up, which does nothing for these
  if (['timeout', 'backoff', 'breaker', 'pool', 'retry_budget', 'autoscaler', 'queue', 'load_shed'].includes(id)) return !!rules.moduleOf(s, id);
  return false;
}

// Every fitting socket full: take out the module this policy values least, if it values it less than the new card.
function replaceFor(p, s, uid, id) {
  const moves = rules.placements(content, s, uid);
  if (!moves.length || moves.some((m) => m.replace === undefined)) return { uid };
  const rankOf = (card) => { const i = p.big.indexOf(rules.baseId(card)); return i < 0 ? Infinity : i; };
  const rank = (mod) => rankOf(rules.modulesOf(s).find((m) => m.uid === mod.replace).card);
  const worst = moves.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  return rank(worst) > rankOf(id) ? { uid, ...worst } : null;
}

for (const [name, p] of Object.entries(SMART)) {
  policies[name] = (s) => {
    const intent = rules.currentIntent(content, s);
    const big = intent.botRps >= 1000 || intent.chaos || intent.clientRetries;
    for (const id of big || !p.calm ? p.big : p.calm) {
      const c = s.hand.find((h) => rules.baseId(h.id) === id && rules.canPlay(content, s, h.uid));
      if (!c || ((name === 'rut' || name === 'thin') ? false : useless(id, s, intent))) continue;
      const move = replaceFor(p, s, c.uid, id);
      if (move) return move;
    }
    return null;
  };
}

// Forecast: what a player who reads the "Dự kiến" panel does. For every card in hand (and every module it could
// replace when its sockets are full) it plays the card on a copy, asks the engine about the turn, and scores it
// like the panel does: HP lost, plus how much enemy HP is left. It plays the best card that beats ending the turn,
// and repeats. Modules and permanent scale keep working in later turns, so their gain counts double; cards whose
// worth this turn cannot show (Ops, draw) get a small fixed bonus.
const ENEMY_W = 0.6;
const enemyHp = (s) => s.enemy.hp + 0.5 * rules.minionsOf(s).reduce((a, m) => a + m.hp, 0);
function forecastValue(s) {
  if (s.phase === 'won') return 1e4;
  const plan = rules.planTurn(content, s);
  const sum = runCached(plan.input);
  const sc = rules.scoreTurn(content, s, plan, sum.summary ?? sum);
  if (sc.damage.total >= s.hp) return -1e4 + s.hp - sc.damage.total;
  return -sc.damage.total - ENEMY_W * Math.max(0, enemyHp(s) - sc.enemyDamage);
}
const isPermanent = (def) => !!def.fits || def.effects.some((e) => e.op === 'scale' && !e.temp);
const isEnabler = (def) => def.effects.some((e) => e.op === 'ops' || e.op === 'draw' || e.op === 'purge');
function forecastMove(s) {
  const intent = rules.currentIntent(content, s);
  const base = forecastValue(s);
  let best = null;
  const seen = new Set();
  for (const c of s.hand) {
    if (seen.has(c.id) || !rules.canPlay(content, s, c.uid)) continue;
    seen.add(c.id);
    const def = rules.cardDef(content, c.id);
    const places = rules.placements(content, s, c.uid);
    const moves = places.length ? places.map((m) => ({ uid: c.uid, ...m })) : [{ uid: c.uid }];
    for (const move of moves) {
      const next = rules.playCard(content, s, move.uid, move);
      if (next === s) continue;
      let gain = forecastValue(next) - base;
      if (isPermanent(def) && gain > 0 && next.phase !== 'won') gain *= 2;
      if (isEnabler(def) && next.ops > 0) gain += 1.5;
      // a card that shows nothing now: still worth playing (leftover Ops are lost) unless it is useless or evicts a module
      const free = gain > -0.01 && !move.replace && !useless(rules.baseId(c.id), s, intent);
      const ok = gain > 0.01 || free;
      const score = gain - 0.01 * def.cost;
      if (ok && (!best || score > best.score)) best = { move, score };
    }
  }
  return best?.move ?? null;
}
policies.forecast = forecastMove;
// Out of fights (map, rewards, shop, rest) the forecast bot drafts like greedy, but takes a card that completes a combo first.
const FORECAST_DRAFT = { ...SMART.greedy, combo: true };
const profile = (policy) => SMART[policy] ?? (policy === 'forecast' ? FORECAST_DRAFT : undefined);
function comboPick(deck, reward) {
  for (const id of reward)
    for (const c of content.combos ?? [])
      if (c.needs.includes(id) && !deck.includes(id) && c.needs.every((n) => n === id || deck.includes(n))) return id;
  return null;
}

// Who attacks go to: greedy takes out guards and healers first, random picks anyone, idle never aims.
function aim(policy, s, rnd) {
  const minions = rules.minionsOf(s);
  if (policy === 'random') {
    const i = Math.floor(rnd() * (minions.length + 1));
    return i < minions.length ? minions[i].uid : null;
  }
  if (!SMART[policy] && policy !== 'forecast') return null;
  const support = minions.filter((m) => { const d = rules.minionDef(content, m.id); return d.guard || d.heal; });
  return support.length ? support.reduce((a, b) => (b.hp < a.hp ? b : a)).uid : null;
}

let stalls = 0;
function fight(policy, seed, setup) {
  let s = rules.newBattle(content, seed, setup);
  let r = seed;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  while (s.phase === 'player' && s.turn <= 30) {
    s = rules.setTarget(s, aim(policy, s, rnd));
    let move;
    while (s.phase === 'player' && (move = policies[policy](s, rnd)) != null) {
      const { uid, ...place } = typeof move === 'number' ? { uid: move } : move;
      const next = rules.playCard(content, s, uid, place);
      if (next === s) break;
      s = next;
    }
    if (s.phase !== 'player') break;
    const plan = rules.planTurn(content, s);
    const summary = run(plan.input);
    s = rules.resolveTurn(content, s, plan, summary);
    if (verbose) {
      const t = s.reports.at(-1);
      console.log(
        `  [${policy} #${seed}] T${t.turn} ${t.intent.padEnd(14)} bot ${String(t.botRps).padStart(4)} chặn ${String(t.botBlockedRps).padStart(4)} ` +
          `err ${(t.errorRate * 100).toFixed(1).padStart(5)}% p99 ${Math.round(t.p99Ms).toString().padStart(4)}ms $${t.costPerHour.toFixed(2)} ` +
          `-> -${t.damage.total} HP (${s.hp}), botnet -${t.enemyDamage} (${s.enemy.hp})`,
      );
    }
  }
  // 30 turns with nobody down (the enemy heals as fast as it is hit): a stalemate,
  // counted as a loss so a run cannot replay the same fight forever
  if (s.phase === 'player') {
    stalls++;
    s = { ...s, phase: 'lost' };
  }
  return s;
}

// Reward picks for the run: what a player who read the cards would take (per policy, `SMART[p].want`).

// Path picks on the map: rest when hurt, otherwise fights (and events) over elites unless healthy.
function pickNode(policy, run, rnd) {
  const map = runs.towerMap(content, run);
  const open = runs.reachable(content, run).map((id) => map.nodes.find((n) => n.id === id));
  if (!profile(policy)) return open[Math.floor(rnd() * open.length)].id;
  const hurt = run.hp / run.maxHp;
  const score = (n) => ({ rest: hurt < 0.5 ? 3 : 0, elite: hurt > 0.75 ? 2 : -1, event: 1, battle: 1, boss: 0 })[n.kind] + rnd() * 0.5;
  return open.reduce((a, b) => (score(b) > score(a) ? b : a)).id;
}

function playRun(policy, seed) {
  let run = runs.newRun(content, seed, chassis);
  const WANT = profile(policy)?.want ?? [];
  if (SMART[policy]?.deck) run = { ...run, deck: SMART[policy].deck };
  let r = seed;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  while (run.phase !== 'won' && run.phase !== 'lost') {
    if (run.phase === 'map') run = runs.chooseNode(content, run, pickNode(policy, run, rnd));
    else if (run.phase === 'battle') run = runs.finishBattle(content, run, fight(policy, runs.battleSeed(run), runs.battleSetup(content, run)));
    else if (run.phase === 'reward') {
      const p = profile(policy);
      const list = p?.keep && run.deck.length >= p.keep ? WANT.slice(0, p.core) : WANT;
      const pick = policy === 'idle' ? null : policy === 'random' ? run.reward[Math.floor(rnd() * run.reward.length)] : ((p?.combo && comboPick(run.deck, run.reward)) || (list.find((id) => run.reward.includes(id)) ?? null));
      run = runs.pickReward(content, run, pick);
    } else if (run.phase === 'rest') {
      const debt = run.deck.indexOf('tech_debt');
      const healthy = run.hp / run.maxHp > 0.7;
      const up = WANT.map((id) => run.deck.indexOf(id)).find((i) => i >= 0 && rules.canUpgrade(content, run.deck[i])) ?? run.deck.findIndex((id) => rules.canUpgrade(content, id));
      const choice =
        !profile(policy) ? { heal: true } : healthy && debt >= 0 ? { remove: debt } : healthy && up >= 0 ? { upgrade: up } : { heal: true };
      run = runs.rest(content, run, choice);
    } else if (run.phase === 'event') {
      const ev = runs.currentEvent(content, run);
      const i = ev.options.findIndex((o) => !o.effects.some((e) => e.op === 'removeCard'));
      run = runs.chooseEvent(content, run, i);
    } else if (run.phase === 'shop') {
      // greedy: relics first, then wanted cards, then a Tech Debt removal; random: one random affordable thing
      if (profile(policy)) {
        let i;
        while ((i = run.shop.relics.findIndex((r) => !r.sold && r.price <= run.gold)) >= 0) run = runs.buy(content, run, { relic: i });
        for (const id of WANT) {
          const k = run.shop.cards.findIndex((c) => c.id === id && !c.sold && c.price <= run.gold);
          if (k >= 0) run = runs.buy(content, run, { card: k });
        }
        const debt = run.deck.indexOf('tech_debt');
        if (debt >= 0) run = runs.shopRemove(content, run, debt);
      } else if (policy === 'random') {
        const k = run.shop.cards.findIndex((c) => c.price <= run.gold);
        if (k >= 0) run = runs.buy(content, run, { card: k });
      }
      run = runs.leaveShop(content, run);
    } else if (run.phase === 'cleared') run = runs.nextAct(content, run, policy === 'idle' ? null : (run.relicOffer[0] ?? null));
  }
  return run;
}

if (eachMode) {
  const ids = [...new Set([...content.run.normal.flat(), ...content.run.elites.flat()])];
  for (const policy of Object.keys(policies).filter((p) => p !== 'idle' && (!only || only.includes(p)))) {
    const rows = ids.map((enemy) => {
      let won = 0;
      let lost = 0;
      for (let seed = 1; seed <= fights; seed++) {
        const s = fight(policy, seed, { chassis, enemy, maxHp: 80, deck: SMART[policy]?.deck });
        if (s.phase === 'won') won++;
        lost += 80 - s.hp;
      }
      return { enemy, won: won / fights, lost: lost / fights };
    });
    const avg = rows.reduce((a, r) => a + r.won, 0) / rows.length;
    console.log(`${policy.padEnd(10)} thắng TB ${Math.round(avg * 100)}%  ` + rows.map((r) => `${r.enemy} ${Math.round(r.won * 100)}%/-${r.lost.toFixed(0)}`).join('  '));
  }
  process.exit(0);
}

// One climb, reduced to what the report needs (so worker processes can send it back as JSON).
function climb(policy, seed) {
  const before = stalls;
  const run = playRun(policy, seed);
  return { won: run.phase === 'won', lost: run.phase === 'lost', act: run.act, stalled: stalls - before, history: run.history.map(({ kind, act, enemy, won, hpLost, turns }) => ({ kind, act, enemy, won, hpLost, turns })) };
}

// --worker=policy:from:to (internal): climb those seeds and print the records.
const worker = process.argv.find((a) => a.startsWith('--worker='))?.slice(9);
if (worker) {
  const [policy, from, to] = worker.split(':');
  const out = [];
  for (let seed = Number(from); seed <= Number(to); seed++) out.push(climb(policy, seed));
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// --jobs=N: split the seeds over N node processes (the forecast bot runs the engine ~10× per card played).
const jobs = Number(process.argv.find((a) => a.startsWith('--jobs='))?.slice(7) ?? 1);
async function climbAll(policy) {
  if (jobs <= 1) return Array.from({ length: fights }, (_, i) => climb(policy, i + 1));
  const { spawn } = await import('node:child_process');
  const size = Math.ceil(fights / jobs);
  const parts = [];
  for (let from = 1; from <= fights; from += size) {
    const to = Math.min(fights, from + size - 1);
    parts.push(
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), `--worker=${policy}:${from}:${to}`, `--chassis=${chassis}`], { stdio: ['ignore', 'pipe', 'inherit'] });
        let buf = '';
        child.stdout.on('data', (d) => (buf += d));
        child.on('close', (code) => (code === 0 ? resolve(JSON.parse(buf)) : reject(new Error(`worker ${from}-${to} exited ${code}`))));
      }),
    );
  }
  return (await Promise.all(parts)).flat();
}

if (runMode) {
  const kinds = ['battle', 'elite', 'boss'];
  for (const policy of Object.keys(policies).filter((p) => !only || only.includes(p))) {
    let wins = 0;
    let actSum = 0;
    let stalled = 0;
    const cleared = Array(content.run.acts).fill(0);
    const stat = Object.fromEntries(kinds.map((k) => [k, { n: 0, won: 0, hp: 0 }]));
    const deaths = {};
    const foes = {};
    for (const run of await climbAll(policy)) {
      if (run.won) wins++;
      stalled += run.stalled;
      const end = run.history.at(-1);
      if (run.lost && end) deaths[`${end.kind}@T${end.act}`] = (deaths[`${end.kind}@T${end.act}`] ?? 0) + 1;
      actSum += run.act;
      for (const h of run.history) {
        if (h.kind === 'boss' && h.won) cleared[h.act - 1]++;
        if (!stat[h.kind]) continue;
        const f = (foes[`T${h.act} ${h.kind.padEnd(6)} ${h.enemy}`] ??= { n: 0, won: 0, hp: 0, turns: 0 });
        f.n++;
        f.won += h.won ? 1 : 0;
        f.hp += h.hpLost;
        f.turns += h.turns;
        stat[h.kind].n++;
        if (h.won) stat[h.kind].won++;
        stat[h.kind].hp += h.hpLost;
      }
    }
    const pct = (x) => `${String(Math.round((x / fights) * 100)).padStart(3)}%`;
    const acts = cleared.map((c, i) => `T${i + 1} ${pct(c)}`).join(' ');
    const per = kinds.map((k) => `${k} ${stat[k].n ? Math.round((stat[k].won / stat[k].n) * 100) : '-'}%/-${stat[k].n ? (stat[k].hp / stat[k].n).toFixed(0) : '-'}hp`).join('  ');
    const died = Object.entries(deaths).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
    console.log(`${policy.padEnd(10)} vượt ${acts}  tầng TB ${(actSum / fights).toFixed(2)}   ${per}${died ? `   chết: ${died}` : ''}${stalled ? `   giằng co 30 lượt: ${stalled}` : ''}`);
    if (byEnemy && policy !== 'idle')
      for (const [k, f] of Object.entries(foes).sort())
        console.log(`    ${k.padEnd(34)} ${String(f.n).padStart(3)} trận  thắng ${String(Math.round((f.won / f.n) * 100)).padStart(3)}%  -${(f.hp / f.n).toFixed(0).padStart(2)}hp  ${(f.turns / f.n).toFixed(1)} lượt`);
  }
  process.exit(0);
}

for (const policy of Object.keys(policies).filter((p) => !only || only.includes(p))) {
  let wins = 0;
  let turns = 0;
  let hpLeft = 0;
  for (let seed = 1; seed <= fights; seed++) {
    const s = fight(policy, seed, { chassis });
    if (s.phase === 'won') {
      wins++;
      hpLeft += s.hp;
    }
    turns += s.turn;
  }
  console.log(
    `${policy.padEnd(7)} win ${String(Math.round((wins / fights) * 100)).padStart(3)}%  ` +
      `avg turns ${(turns / fights).toFixed(1)}  avg HP left (wins) ${wins ? (hpLeft / wins).toFixed(1) : '-'}`,
  );
}
