import 'reflect-metadata';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

// a database of its own, wiped before the run
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? 'postgresql://pattern:pattern@localhost:5432/pattern_test';
process.env.ALLOW_SIGNUP = 'true';
process.env.NODE_ENV = 'test';

const root = resolve(__dirname, '../../..');
const serverDir = resolve(__dirname, '..');
let app: INestApplication;
let base = '';

before(async () => {
  // bring the schema up to date (non-destructive), then empty every table
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: serverDir, env: process.env, stdio: 'pipe' });
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  await db.$disconnect();
  const { AppModule } = await import('./app.module');
  const { configure } = await import('./main');
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  configure(app);
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api`;
});
after(() => app.close());

/** A browser: keeps its session cookie and sends the CSRF header like the web app. */
function browser() {
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'pattern',
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return res;
  };
  return {
    get: (path: string) => call('GET', path),
    post: (path: string, body?: unknown, headers?: Record<string, string>) => call('POST', path, body, headers),
    del: (path: string) => call('DELETE', path),
    json: async <T>(res: Response) => (await res.json()) as T,
    get cookie() {
      return cookie;
    },
  };
}

const solution = (id: string) => JSON.parse(readFileSync(join(root, 'levels/solutions', `${id}.json`), 'utf8'));
const alice = browser();
const bob = browser();

test('health reports the database and the engine pool', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { db: string; engine: { threads: number } };
  assert.equal(body.db, 'up');
  assert.ok(body.engine.threads >= 1);
});

test('signup: the first account is admin, the session cookie is httpOnly', async () => {
  const res = await alice.post('/auth/signup', { email: 'Alice@Example.com', password: 'correct horse', displayName: 'alice' });
  assert.equal(res.status, 201);
  assert.match(res.headers.get('set-cookie') ?? '', /pattern_sid=.+HttpOnly.*SameSite=Lax/i);
  const me = await alice.json<{ user: { email: string; role: string } }>(await alice.get('/auth/me'));
  assert.equal(me.user.email, 'alice@example.com');
  assert.equal(me.user.role, 'admin');
  const second = await bob.post('/auth/signup', { email: 'bob@example.com', password: 'hunter2hunter2', displayName: 'bob' });
  assert.equal((await bob.json<{ user: { role: string } }>(second)).user.role, 'user');
  assert.equal((await browser().post('/auth/signup', { email: 'bob@example.com', password: 'whatever123' })).status, 409);
  assert.equal((await browser().post('/auth/signup', { email: 'x@example.com', password: 'short' })).status, 400);
});

test('login, wrong password, logout', async () => {
  const b = browser();
  assert.equal((await b.post('/auth/login', { email: 'alice@example.com', password: 'nope' })).status, 401);
  assert.equal((await b.post('/auth/login', { email: 'ALICE@example.com', password: 'correct horse' })).status, 200);
  assert.ok((await b.json<{ user: object | null }>(await b.get('/auth/me'))).user);
  assert.equal((await b.post('/auth/logout')).status, 204);
  assert.equal((await b.json<{ user: object | null }>(await b.get('/auth/me'))).user, null);
});

test('CSRF: state-changing requests need X-Requested-With', async () => {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'alice@example.com', password: 'correct horse' }),
  });
  assert.equal(res.status, 403);
});

test('sessions: list and revoke another device', async () => {
  const laptop = browser();
  await laptop.post('/auth/login', { email: 'alice@example.com', password: 'correct horse' });
  const list = await alice.json<{ id: string; current: boolean }[]>(await alice.get('/auth/sessions'));
  assert.ok(list.length >= 2);
  const other = list.find((s) => !s.current)!;
  assert.equal((await alice.del(`/auth/sessions/${encodeURIComponent(other.id)}`)).status, 204);
  const left = await alice.json<{ id: string }[]>(await alice.get('/auth/sessions'));
  assert.ok(!left.some((s) => s.id === other.id));
});

test('lists levels without signing in', async () => {
  const levels = (await (await fetch(`${base}/levels`)).json()) as { id: string }[];
  assert.ok(levels.length >= 4);
  assert.equal(levels[0].id, '01-first-sale');
});

test('submitting a score requires signing in', async () => {
  const res = await browser().post('/levels/01-first-sale/submit', { design: solution('01-first-sale') });
  assert.equal(res.status, 401);
});

test('scores a submission exactly like the native engine', async () => {
  const res = await alice.post('/levels/01-first-sale/submit', { design: solution('01-first-sale') });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { summary: { stars: number; total: number }; rank: number };
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
  await bob.post('/levels/01-first-sale/submit', { design: pricey });
  const worse = await alice.post('/levels/01-first-sale/submit', { design: pricey });
  assert.equal(((await worse.json()) as { improved: boolean }).improved, false);

  const board = (await (await fetch(`${base}/levels/01-first-sale/leaderboard`)).json()) as { player: string }[];
  assert.deepEqual(
    board.map((e) => e.player),
    ['alice', 'bob'],
  );
});

test('rejects invalid designs and unknown levels', async () => {
  const noDb = solution('01-first-sale');
  noDb.nodes = noDb.nodes.filter((n: { id: string }) => n.id !== 'db');
  assert.equal((await alice.post('/levels/01-first-sale/submit', { design: noDb })).status, 400);
  assert.equal((await alice.post('/levels/01-first-sale/submit', { design: { nodes: 'x' } })).status, 400);
  assert.equal((await alice.post('/levels/nope/submit', { design: { nodes: [], edges: [] } })).status, 404);
});

test('the worker pool runs simulations in parallel with identical results', async () => {
  const runs = await Promise.all(
    ['02-flaky-db', '02-flaky-db', '03-black-friday'].map((id) => bob.post(`/levels/${id}/submit`, { design: solution(id) })),
  );
  const totals = await Promise.all(runs.map(async (r) => ((await r.json()) as { summary: { total: number; stars: number } }).summary));
  assert.equal(totals[0].total, totals[1].total);
  assert.ok(totals.every((s) => s.stars === 3));
});
