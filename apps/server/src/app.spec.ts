import 'reflect-metadata';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';

const root = resolve(__dirname, '../../..');
let app: INestApplication;
let base = '';

before(async () => {
  process.env.LEADERBOARD_FILE = join(mkdtempSync(join(tmpdir(), 'lb-')), 'lb.json');
  process.env.SHARES_DIR = mkdtempSync(join(tmpdir(), 'shares-'));
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api`;
});
after(() => app.close());

const solution = (id: string) => JSON.parse(readFileSync(join(root, 'levels/solutions', `${id}.json`), 'utf8'));
const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('lists levels', async () => {
  const levels = (await (await fetch(`${base}/levels`)).json()) as { id: string }[];
  assert.ok(levels.length >= 4);
  assert.equal(levels[0].id, '01-first-sale');
});

test('scores a submission exactly like the native engine', async () => {
  const res = await post('/levels/01-first-sale/submit', { player: 'alice', design: solution('01-first-sale') });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { summary: { stars: number; p99Ms: number; total: number }; rank: number };
  assert.equal(body.summary.stars, 3);
  assert.equal(body.rank, 1);

  // the CLI (native Rust) must agree to the last digit
  const cli = execFileSync(
    'cargo',
    ['run', '-q', '--release', '-p', 'pattern-sim', '--', '--level', 'levels/01-first-sale.json', 'levels/solutions/01-first-sale.json'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.match(cli, new RegExp(`\\b${body.summary.total}\\b`));
});

test('ranks by stars, then cost, and keeps each player best', async () => {
  const pricey = solution('01-first-sale');
  pricey.nodes.find((n: { id: string }) => n.id === 'api').config.instances = 4;
  await post('/levels/01-first-sale/submit', { player: 'bob', design: pricey });
  const worse = await post('/levels/01-first-sale/submit', { player: 'alice', design: pricey });
  assert.equal(((await worse.json()) as { improved: boolean }).improved, false);

  const board = (await (await fetch(`${base}/levels/01-first-sale/leaderboard`)).json()) as { player: string }[];
  assert.deepEqual(board.map((e) => e.player), ['alice', 'bob']);
});

test('rejects invalid designs and names', async () => {
  const noDb = solution('01-first-sale');
  noDb.nodes = noDb.nodes.filter((n: { id: string }) => n.id !== 'db');
  assert.equal((await post('/levels/01-first-sale/submit', { player: 'eve', design: noDb })).status, 400);
  assert.equal((await post('/levels/01-first-sale/submit', { player: '<script>', design: solution('01-first-sale') })).status, 400);
  assert.equal((await post('/levels/nope/submit', { player: 'eve', design: {} })).status, 404);
});

test('shares a project snapshot and serves it back', async () => {
  const example = JSON.parse(readFileSync(join(root, 'examples/01-no-cache.json'), 'utf8'));
  const groups = [{ id: 'g1', label: 'ns', kind: 'namespace', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }];
  const res = await post('/shares', {
    name: 'Shop',
    notes: 'goal: 1k rps',
    design: { ...example.design, groups },
    scenario: example.scenario,
    secret: 'ignored',
  });
  assert.equal(res.status, 201);
  const { id } = (await res.json()) as { id: string };
  assert.match(id, /^[A-Za-z0-9_-]{12}$/);

  const share = (await (await fetch(`${base}/shares/${id}`)).json()) as Record<string, unknown> & { design: { groups: unknown } };
  assert.equal(share.name, 'Shop');
  assert.equal(share.notes, 'goal: 1k rps');
  assert.deepEqual(share.design.groups, groups);
  assert.deepEqual(share.scenario, example.scenario);
  assert.equal('secret' in share, false);
});

test('rejects shares the engine cannot run, and unknown ids', async () => {
  const example = JSON.parse(readFileSync(join(root, 'examples/01-no-cache.json'), 'utf8'));
  const dangling = { ...example.design, edges: [...example.design.edges, { from: 'client', to: 'ghost' }] };
  assert.equal((await post('/shares', { name: 'x', design: dangling, scenario: example.scenario })).status, 400);
  assert.equal((await post('/shares', { name: '', design: example.design, scenario: example.scenario })).status, 400);
  assert.equal((await post('/shares', { name: 'x', design: { nodes: [] } })).status, 400);
  assert.equal((await fetch(`${base}/shares/nope`)).status, 404);
  assert.equal((await fetch(`${base}/shares/..%2F..%2Fetc`)).status, 404);
});
