// Validates the learning path against the real engine:
// - every `predict` card's scenario runs, and its result falls in exactly one option
// - choice answers / order items / build levels are well formed
// Usage: node --experimental-strip-types apps/web/scripts/check-curriculum.mjs
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const require = createRequire(import.meta.url);
const wasm = require(join(root, 'crates/engine-wasm/pkg-node/pattern_engine_wasm.js'));
const { UNITS } = await import('../src/learn/curriculum.ts');

let failures = 0;
const fail = (where, msg) => {
  failures++;
  console.log(`FAIL ${where}: ${msg}`);
};
const ids = new Set();
for (const unit of UNITS) {
  for (const lesson of unit.lessons) {
    if (ids.has(lesson.id)) fail(lesson.id, 'duplicate lesson id');
    ids.add(lesson.id);
    lesson.cards.forEach((card, i) => {
      const where = `${lesson.id}#${i} (${card.type})`;
      switch (card.type) {
        case 'choice':
          if (!(card.answer >= 0 && card.answer < card.options.length)) fail(where, 'answer out of range');
          break;
        case 'order':
          if (card.items.length < 3) fail(where, 'needs at least 3 items');
          break;
        case 'build': {
          const file = join(root, 'levels', `${card.level}.json`);
          if (!existsSync(file)) fail(where, `missing level ${file}`);
          break;
        }
        case 'predict': {
          const summary = JSON.parse(wasm.run_headless(JSON.stringify(card.sim)));
          const v = summary[card.metric];
          const hits = card.options.filter((o) => v >= o.min && v < o.max);
          const shown = card.metric === 'errorRate' ? `${(v * 100).toFixed(1)}%` : v.toFixed(1);
          if (hits.length !== 1) fail(where, `${card.metric} = ${shown} matches ${hits.length} options`);
          else console.log(`ok   ${where}: ${card.metric} = ${shown} -> "${hits[0].label}"`);
          break;
        }
      }
    });
  }
}
console.log(failures ? `${failures} problem(s)` : `curriculum ok: ${ids.size} lessons`);
process.exit(failures ? 1 : 0);
