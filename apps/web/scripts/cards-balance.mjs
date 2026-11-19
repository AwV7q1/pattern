// Balance check for the card battle prototype: bots play many seeded fights
// through the real engine (Node WASM build) and report win rate, turns and HP.
// Usage: node --experimental-strip-types apps/web/scripts/cards-balance.mjs [fights=20] [--log] [--run]
// --run: climb the whole tower (map paths, fights, rewards, rests, events) instead of the single first fight.
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
const content = { cards: data('cards.json'), enemies: data('enemies.json'), battle: data('battle.json'), run: data('run.json'), events: data('events.json') };

const fights = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 20);
const verbose = process.argv.includes('--log');
const runMode = process.argv.includes('--run');
const run = (input) => JSON.parse(wasm.run_headless(JSON.stringify(input)));

// Policies: which card to play next (uid) or null to end the turn.
const policies = {
  idle: () => null,
  random: (s, rnd) => {
    const playable = s.hand.filter((c) => rules.canPlay(content, s, c.uid));
    return playable.length ? playable[Math.floor(rnd() * playable.length)].uid : null;
  },
  // A reasonable human: infra first, then defend on big intents, otherwise attack.
  greedy: (s) => {
    const intent = rules.currentIntent(content, s);
    const big = intent.botRps >= 1000 || intent.chaos || intent.clientRetries;
    const order = big
      ? ['coffee', 'refactor', 'cache', 'index', 'timeout', 'pool', 'retry_budget', 'backoff', 'breaker', 'hotfix', 'load_shed', 'rate_limit', 'captcha', 'burst', 'stale', 'postmortem', 'runbook', 'null_route', 'waf', 'replica', 'scale_api', 'vertical', 'block_ip', 'honeypot']
      : ['coffee', 'refactor', 'cache', 'index', 'timeout', 'pool', 'retry_budget', 'backoff', 'waf', 'runbook', 'postmortem', 'honeypot', 'block_ip', 'null_route', 'rate_limit', 'captcha', 'breaker', 'replica', 'scale_api', 'stale', 'burst'];
    for (const id of order) {
      const c = s.hand.find((h) => h.id === id && rules.canPlay(content, s, h.uid));
      if (!c) continue;
      if (id === 'hotfix' && !(intent.chaos || intent.clientRetries)) continue;
      if (id === 'cache' && rules.nodeOf(s.design, 'cache')?.config.hitRate >= 0.95) continue;
      if (id === 'refactor' && !s.hand.some((h) => h.id === 'tech_debt')) continue;
      if (id === 'index' && rules.nodeOf(s.design, 'db').config.latencyP50Ms < 5) continue;
      return c.uid;
    }
    return null;
  },
};

function fight(policy, seed, setup) {
  let s = rules.newBattle(content, seed, setup);
  let r = seed;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  while (s.phase === 'player' && s.turn <= 30) {
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
  return s;
}

// Reward picks for the run: what a player who read the cards would take.
const WANT = ['retry_budget', 'backoff', 'waf', 'cache', 'index', 'pool', 'breaker', 'timeout', 'null_route', 'honeypot', 'hotfix', 'runbook', 'refactor', 'captcha', 'block_ip'];

// Path picks on the map: rest when hurt, otherwise fights (and events) over elites unless healthy.
function pickNode(policy, run, rnd) {
  const map = runs.towerMap(content, run);
  const open = runs.reachable(content, run).map((id) => map.nodes.find((n) => n.id === id));
  if (policy !== 'greedy') return open[Math.floor(rnd() * open.length)].id;
  const hurt = run.hp / run.maxHp;
  const score = (n) => ({ rest: hurt < 0.5 ? 3 : 0, elite: hurt > 0.75 ? 2 : -1, event: 1, battle: 1, boss: 0 })[n.kind] + rnd() * 0.5;
  return open.reduce((a, b) => (score(b) > score(a) ? b : a)).id;
}

function playRun(policy, seed) {
  let run = runs.newRun(content, seed);
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
      run = runs.rest(content, run, policy === 'greedy' && debt >= 0 && run.hp / run.maxHp > 0.7 ? { remove: debt } : { heal: true });
    } else if (run.phase === 'event') {
      const ev = runs.currentEvent(content, run);
      const i = ev.options.findIndex((o) => !o.effects.some((e) => e.op === 'removeCard'));
      run = runs.chooseEvent(content, run, i);
    } else if (run.phase === 'cleared') run = runs.nextAct(content, run);
  }
  return run;
}

if (runMode) {
  const kinds = ['battle', 'elite', 'boss'];
  for (const policy of Object.keys(policies)) {
    let wins = 0;
    let actSum = 0;
    const cleared = Array(content.run.acts).fill(0);
    const stat = Object.fromEntries(kinds.map((k) => [k, { n: 0, won: 0, hp: 0 }]));
    for (let seed = 1; seed <= fights; seed++) {
      const run = playRun(policy, seed);
      if (run.phase === 'won') wins++;
      actSum += run.act;
      for (const h of run.history) {
        if (h.kind === 'boss' && h.won) cleared[h.act - 1]++;
        if (!stat[h.kind]) continue;
        stat[h.kind].n++;
        if (h.won) stat[h.kind].won++;
        stat[h.kind].hp += h.hpLost;
      }
    }
    const pct = (x) => `${String(Math.round((x / fights) * 100)).padStart(3)}%`;
    const acts = cleared.map((c, i) => `T${i + 1} ${pct(c)}`).join(' ');
    const per = kinds.map((k) => `${k} ${stat[k].n ? Math.round((stat[k].won / stat[k].n) * 100) : '-'}%/-${stat[k].n ? (stat[k].hp / stat[k].n).toFixed(0) : '-'}hp`).join('  ');
    console.log(`${policy.padEnd(7)} vượt ${acts}  tầng TB ${(actSum / fights).toFixed(2)}   ${per}`);
  }
  process.exit(0);
}

for (const policy of Object.keys(policies)) {
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
