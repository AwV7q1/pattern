// Balance check for the card battle prototype: bots play many seeded fights
// through the real engine (Node WASM build) and report win rate, turns and HP.
// Usage: node --experimental-strip-types apps/web/scripts/cards-balance.mjs [fights=20] [--log] [--run]
// --run: climb the whole tower (map paths, fights, rewards, rests, events) instead of the single first fight.
// --by-enemy (with --run): also list win rate and HP lost per enemy.
// --only=greedy: run just these policies (comma list).
// --each: every normal and elite enemy, one by one, unscaled, at 80 HP (the "rut" policy uses its fixed deck).
// Policies: idle, random, greedy (a reasonable human), rut (one fixed cache → scale → rate limit line, never
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
const content = { cards: data('cards.json'), enemies: data('enemies.json'), battle: data('battle.json'), run: data('run.json'), events: data('events.json'), relics: data('relics.json'), minions: data('minions.json') };

const fights = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 20);
const verbose = process.argv.includes('--log');
const runMode = process.argv.includes('--run');
const byEnemy = process.argv.includes('--by-enemy');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const eachMode = process.argv.includes('--each');
const run = (input) => JSON.parse(wasm.run_headless(JSON.stringify(input)));

// Policies: which card to play next (uid) or null to end the turn.
const policies = {
  idle: () => null,
  random: (s, rnd) => {
    const playable = s.hand.filter((c) => rules.canPlay(content, s, c.uid));
    return playable.length ? playable[Math.floor(rnd() * playable.length)].uid : null;
  },
};

// Smart policies play the first card of their list that is playable and useful now.
const SMART = {
  // A reasonable human: infra first, then defend on big intents, otherwise attack.
  greedy: {
    big: ['coffee', 'refactor', 'restart', 'cache', 'cache_key', 'swr', 'index', 'timeout', 'pool', 'retry_budget', 'backoff', 'breaker', 'hotfix', 'load_shed', 'rate_limit', 'captcha', 'burst', 'stale', 'buffer', 'postmortem', 'runbook', 'null_route', 'waf', 'replica', 'scale_api', 'vertical', 'block_ip', 'patch', 'honeypot'],
    calm: ['coffee', 'refactor', 'restart', 'cache', 'cache_key', 'swr', 'index', 'timeout', 'pool', 'retry_budget', 'backoff', 'waf', 'runbook', 'postmortem', 'honeypot', 'block_ip', 'patch', 'null_route', 'rate_limit', 'captcha', 'breaker', 'replica', 'scale_api', 'stale', 'buffer', 'burst'],
    want: ['retry_budget', 'backoff', 'waf', 'cache', 'index', 'pool', 'breaker', 'timeout', 'null_route', 'honeypot', 'hotfix', 'runbook', 'refactor', 'captcha', 'block_ip', 'swr', 'cache_key', 'restart'],
  },
  // The rut the research doc measured: the same seven cards in the same order, every fight.
  rut: {
    big: ['cache', 'scale_api', 'index', 'timeout', 'rate_limit', 'patch', 'buffer'],
    want: [],
    deck: [...content.battle.startingDeck, 'rate_limit', 'scale_api'],
  },
  // Single axis: make the system fast (cache, DB, scale) and nothing else.
  cacheOnly: {
    big: ['coffee', 'refactor', 'cache', 'cache_key', 'swr', 'index', 'scale_api', 'replica', 'vertical', 'bigger_queue', 'timeout', 'pool', 'stale', 'buffer', 'postmortem', 'runbook', 'patch', 'block_ip', 'honeypot'],
    want: ['cache', 'index', 'replica', 'vertical', 'scale_api', 'swr', 'cache_key', 'pool', 'timeout', 'runbook', 'refactor'],
  },
  // Single axis: filter bots (WAF, rate limit, captcha) and hit the botnet.
  filterOnly: {
    big: ['coffee', 'refactor', 'waf', 'rate_limit', 'captcha', 'null_route', 'honeypot', 'block_ip', 'patch', 'stale', 'buffer', 'postmortem', 'runbook'],
    want: ['waf', 'captcha', 'rate_limit', 'null_route', 'honeypot', 'block_ip', 'runbook', 'refactor'],
  },
};

function useless(id, s, intent) {
  if (id === 'hotfix') return !rules.hotfixable(intent);
  if (id === 'cache') return (rules.nodeOf(s.design, 'cache')?.config.cache?.capacity ?? 0) >= 4000;
  if (id === 'cache_key') return !!s.cache?.normalize;
  if (id === 'swr') return !!s.cache?.swr;
  if (id === 'restart') return (s.enemy.leak ?? 0) < 0.6;
  if (id === 'refactor') return !s.hand.some((h) => h.id === 'tech_debt');
  if (id === 'index') return rules.nodeOf(s.design, 'db').config.latencyP50Ms < 5;
  return false;
}

for (const [name, p] of Object.entries(SMART)) {
  policies[name] = (s) => {
    const intent = rules.currentIntent(content, s);
    const big = intent.botRps >= 1000 || intent.chaos || intent.clientRetries;
    for (const id of big || !p.calm ? p.big : p.calm) {
      const c = s.hand.find((h) => rules.baseId(h.id) === id && rules.canPlay(content, s, h.uid));
      if (c && !(name !== 'rut' && useless(id, s, intent))) return c.uid;
    }
    return null;
  };
}

// Who attacks go to: greedy takes out guards and healers first, random picks anyone, idle never aims.
function aim(policy, s, rnd) {
  const minions = rules.minionsOf(s);
  if (policy === 'random') {
    const i = Math.floor(rnd() * (minions.length + 1));
    return i < minions.length ? minions[i].uid : null;
  }
  if (!SMART[policy]) return null;
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
    let uid;
    while (s.phase === 'player' && (uid = policies[policy](s, rnd)) != null) s = rules.playCard(content, s, uid);
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
  if (!SMART[policy]) return open[Math.floor(rnd() * open.length)].id;
  const hurt = run.hp / run.maxHp;
  const score = (n) => ({ rest: hurt < 0.5 ? 3 : 0, elite: hurt > 0.75 ? 2 : -1, event: 1, battle: 1, boss: 0 })[n.kind] + rnd() * 0.5;
  return open.reduce((a, b) => (score(b) > score(a) ? b : a)).id;
}

function playRun(policy, seed) {
  let run = runs.newRun(content, seed);
  const WANT = SMART[policy]?.want ?? [];
  if (SMART[policy]?.deck) run = { ...run, deck: SMART[policy].deck };
  let r = seed;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  while (run.phase !== 'won' && run.phase !== 'lost') {
    if (run.phase === 'map') run = runs.chooseNode(content, run, pickNode(policy, run, rnd));
    else if (run.phase === 'battle') run = runs.finishBattle(content, run, fight(policy, runs.battleSeed(run), runs.battleSetup(content, run)));
    else if (run.phase === 'reward') {
      const pick = policy === 'idle' ? null : policy === 'random' ? run.reward[Math.floor(rnd() * run.reward.length)] : (WANT.find((id) => run.reward.includes(id)) ?? null);
      run = runs.pickReward(content, run, pick);
    } else if (run.phase === 'rest') {
      const debt = run.deck.indexOf('tech_debt');
      const healthy = run.hp / run.maxHp > 0.7;
      const up = WANT.map((id) => run.deck.indexOf(id)).find((i) => i >= 0 && rules.canUpgrade(content, run.deck[i])) ?? run.deck.findIndex((id) => rules.canUpgrade(content, id));
      const choice =
        !SMART[policy] ? { heal: true } : healthy && debt >= 0 ? { remove: debt } : healthy && up >= 0 ? { upgrade: up } : { heal: true };
      run = runs.rest(content, run, choice);
    } else if (run.phase === 'event') {
      const ev = runs.currentEvent(content, run);
      const i = ev.options.findIndex((o) => !o.effects.some((e) => e.op === 'removeCard'));
      run = runs.chooseEvent(content, run, i);
    } else if (run.phase === 'shop') {
      // greedy: relics first, then wanted cards, then a Tech Debt removal; random: one random affordable thing
      if (SMART[policy]) {
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
        const s = fight(policy, seed, { enemy, maxHp: 80, deck: SMART[policy]?.deck });
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

if (runMode) {
  const kinds = ['battle', 'elite', 'boss'];
  for (const policy of Object.keys(policies).filter((p) => !only || only.includes(p))) {
    let wins = 0;
    let actSum = 0;
    const cleared = Array(content.run.acts).fill(0);
    const stat = Object.fromEntries(kinds.map((k) => [k, { n: 0, won: 0, hp: 0 }]));
    const deaths = {};
    const foes = {};
    stalls = 0;
    for (let seed = 1; seed <= fights; seed++) {
      const run = playRun(policy, seed);
      if (run.phase === 'won') wins++;
      const end = run.history.at(-1);
      if (run.phase === 'lost' && end) deaths[`${end.kind}@T${end.act}`] = (deaths[`${end.kind}@T${end.act}`] ?? 0) + 1;
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
    console.log(`${policy.padEnd(7)} vượt ${acts}  tầng TB ${(actSum / fights).toFixed(2)}   ${per}${died ? `   chết: ${died}` : ''}${stalls ? `   giằng co 30 lượt: ${stalls}` : ''}`);
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
    const s = fight(policy, seed);
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
