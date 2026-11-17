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
