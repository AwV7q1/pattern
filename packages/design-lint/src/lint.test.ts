import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyPatches, countByTarget, lint, scoreInterview } from './index.ts';
import type { LintDesign, LintEdge, LintNode } from './types.ts';

const root = join(import.meta.dirname, '../../..');
const n = (id: string, kind: LintNode['kind'], config: LintNode['config'] = {}): LintNode => ({ id, kind, label: id, config });
const e = (source: string, target: string, extra: Partial<LintEdge> = {}): LintEdge => ({ source, target, ...extra });
const rules = (d: LintDesign, sc?: Parameters<typeof lint>[1]) => lint(d, sc).map((f) => f.rule);

/** client → lb → api(2) → db(1) */
const base = (edge: Partial<LintEdge> = {}, api: LintNode['config'] = {}): LintDesign => ({
  nodes: [n('c', 'client'), n('lb', 'loadBalancer', { instances: 2 }), n('api', 'service', { instances: 2, ...api }), n('db', 'database', { instances: 2 })],
  edges: [e('c', 'lb'), e('lb', 'api'), e('api', 'db', edge)],
});

test('a clean design has no findings', () => {
  assert.deepEqual(lint(base({ timeoutMs: 100 })), []);
});

test('retry hygiene: backoff, jitter, timeout, with one-click fixes', () => {
  const d = base({ retries: 3, backoffMs: 0, jitter: false });
  const found = rules(d);
  for (const r of ['retry-no-backoff', 'retry-no-jitter', 'retry-no-timeout', 'retry-storm-risk']) assert.ok(found.includes(r), r);
  let fixed = d;
  for (const f of lint(d)) if (f.fix) fixed = applyPatches(fixed, f.fix.patches);
  assert.deepEqual(rules(fixed), []);
});

test('timeouts must shrink inward', () => {
  const d = base({ timeoutMs: 800, retries: 2, backoffMs: 50 });
  assert.ok(rules(d, { timeoutMs: 1000 }).includes('timeout-order'));
  assert.ok(!rules(d, { timeoutMs: 5000 }).includes('timeout-order'));
});

test('retries multiplying across layers are flagged, worst as an error', () => {
  const d: LintDesign = {
    nodes: [n('c', 'client'), n('a', 'service', { instances: 2 }), n('b', 'service', { instances: 2 }), n('db', 'database', { instances: 2 })],
    edges: [e('c', 'a', { retries: 2 }), e('a', 'b', { retries: 2, timeoutMs: 100 }), e('b', 'db', { retries: 2, timeoutMs: 30 })],
  };
  const f = lint(d).find((x) => x.rule === 'retry-amplification')!;
  assert.equal(f.severity, 'error');
  assert.match(f.message, /27 lời gọi/);
  assert.deepEqual(f.target, { edge: ['b', 'db'] });
  assert.ok(!rules(applyPatches(d, f.fix!.patches)).includes('retry-amplification'));
});

test('single points of failure, but not with a replica path', () => {
  const d = base({ timeoutMs: 100 }, { instances: 1 });
  assert.deepEqual(lint(d).filter((f) => f.rule === 'spof').map((f) => f.target), [{ node: 'api' }]);
  // a second api behind the LB: neither is a SPOF any more
  d.nodes.push(n('api2', 'service'));
  d.edges.push(e('lb', 'api2'), e('api2', 'db', { timeoutMs: 100 }));
  assert.ok(!rules(d).includes('spof'));
});

test('pools larger than the database are an error (autoscale counted at max)', () => {
  const d = base({ poolSize: 10, timeoutMs: 100 }, { model: 'cpu', cpuLanes: 4, autoscale: { min: 2, max: 6 } });
  d.nodes[3].config = { instances: 2, concurrency: 100 };
  assert.ok(rules(d).includes('pool-exceeds-db')); // 10 × 6 × 4 = 240 > 200
  d.nodes[3].config.concurrency = 150;
  assert.ok(!rules(d).includes('pool-exceeds-db'));
});

test('fan-out, hedge, cache, queue and autoscale rules', () => {
  const d: LintDesign = {
    nodes: [
      n('c', 'client'),
      n('api', 'service', { instances: 2, routing: 'hedge' }),
      n('r1', 'database', { instances: 1 }),
      n('r2', 'database', { instances: 1 }),
      n('cache', 'cache', { instances: 2, cache: { zipf: 1, ttlMs: 0 } }),
      n('q', 'queue', { instances: 2 }),
      n('w', 'service', { instances: 2 }),
      n('hpa', 'service', { autoscale: { min: 1, max: 4 } }),
    ],
    edges: [e('c', 'api'), e('api', 'r1'), e('api', 'r2'), e('c', 'cache'), e('cache', 'hpa'), e('c', 'q'), e('q', 'w')],
  };
  const found = rules(d);
  for (const r of ['fan-out-no-timeout', 'hedge-unbounded', 'cache-stampede', 'cache-no-ttl', 'queue-consumer-fixed', 'hpa-min-one'])
    assert.ok(found.includes(r), r);
});

test('budget, payload and breaker rules', () => {
  const d = base({ timeoutMs: 100, responseKb: 2000, bandwidthMbps: 100, circuitBreaker: { minRequests: 2 } }, { costPerHour: 1 });
  const found = rules(d, { budgetPerHour: 1 });
  for (const r of ['over-budget', 'slow-payload', 'cb-min-requests']) assert.ok(found.includes(r), r);
  assert.equal(lint(d, { budgetPerHour: 1 })[0].severity, 'error', 'errors first');
});

test('badge counts per target keep the worst severity', () => {
  const c = countByTarget(lint(base({ retries: 3, backoffMs: 0, jitter: false })));
  assert.equal(c.edges.get('api->db')?.count, 4);
  assert.equal(c.edges.get('api->db')?.worst, 'warn');
});

test('reference solutions of every level have no errors', () => {
  for (const dir of ['levels', 'levels/learn']) {
    for (const file of readdirSync(join(root, dir, 'solutions'))) {
      const level = JSON.parse(readFileSync(join(root, dir, file), 'utf8'));
      const solution = JSON.parse(readFileSync(join(root, dir, 'solutions', file), 'utf8'));
      const errors = lint(solution, level.scenario).filter((f) => f.severity === 'error');
      assert.deepEqual(errors, [], `${dir}/${file}`);
    }
  }
});

test('interview score: weights, verdict and feedback', () => {
  const ok = { sloPass: true, sloWindowRatio: 1, p99Ms: 50, errorRate: 0, costPerHour: 1 };
  const perfect = scoreInterview({
    runs: [
      { name: 'Bình thường', kind: 'normal', summary: ok },
      { name: 'Mất 1 instance', kind: 'failure', summary: ok },
    ],
    findings: [],
    budgetPerHour: 2,
  });
  assert.equal(perfect.total, 100);
  assert.equal(perfect.verdict, 'strong');
  const bad = scoreInterview({
    runs: [
      { name: 'Cao điểm', kind: 'peak', summary: { ...ok, sloPass: false, sloWindowRatio: 0.5, errorRate: 0.2 }, hot: [{ label: 'DB', utilization: 1, rejected: 30 }] },
      { name: 'DB chậm', kind: 'failure', summary: { ...ok, sloPass: false, sloWindowRatio: 0.2 } },
    ],
    findings: lint(base({ retries: 3, backoffMs: 0 })),
    budgetPerHour: 0.5,
  });
  assert.ok(bad.total < 55, String(bad.total));
  assert.equal(bad.verdict, 'fail');
  assert.ok(bad.feedback.some((l) => l.includes('DB quá tải')));
  assert.ok(bad.feedback.some((l) => l.includes('vượt ngân sách')));
});
