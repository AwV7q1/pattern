// Balance check for the card battle prototype: bots play many seeded fights
// through the real engine (Node WASM build) and report win rate, turns and HP.
// Usage: node --experimental-strip-types apps/web/scripts/cards-balance.mjs [fights=20] [--log]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const require = createRequire(import.meta.url);
const wasm = require(join(root, 'crates/engine-wasm/pkg-node/pattern_engine_wasm.js'));
const rules = await import('../src/cards/rules.ts');

const data = (f) => JSON.parse(readFileSync(join(here, '../src/cards/data', f), 'utf8'));
const content = { cards: data('cards.json'), enemies: data('enemies.json'), battle: data('battle.json') };

const fights = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 20);
const verbose = process.argv.includes('--log');
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
      ? ['coffee', 'cache', 'timeout', 'breaker', 'hotfix', 'rate_limit', 'burst', 'stale', 'runbook', 'waf', 'scale_api', 'block_ip', 'honeypot']
      : ['coffee', 'cache', 'timeout', 'waf', 'runbook', 'honeypot', 'block_ip', 'rate_limit', 'breaker', 'scale_api', 'stale', 'burst'];
    for (const id of order) {
      const c = s.hand.find((h) => h.id === id && rules.canPlay(content, s, h.uid));
      if (!c) continue;
      if (id === 'hotfix' && !(intent.chaos || intent.clientRetries)) continue;
      if (id === 'cache' && rules.nodeOf(s.design, 'cache')?.config.hitRate >= 0.95) continue;
      return c.uid;
    }
    return null;
  },
};

function fight(policy, seed) {
  let s = rules.newBattle(content, seed);
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
