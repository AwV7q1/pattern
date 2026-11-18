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
  // the native CLI test idles for seconds: keep sockets alive longer than fetch's pool
  app.getHttpServer().keepAliveTimeout = 65_000;
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

// ------------------------------------------------------------ projects and share links

const project = (over: Record<string, unknown> = {}) => ({
  name: 'Shop',
  description: 'demo',
  notes: '',
  design: solution('01-first-sale'),
  scenario: { seed: 1, timeoutMs: 1000, traffic: [{ atMs: 0, rps: 100 }], slo: { p99Ms: 200, errorRate: 0.01 }, windowMs: 1000 },
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...over,
});
const PID = '7b0f5c0e-0d7a-4a59-9a63-0c7f7f2a1a01';
const put = (b: ReturnType<typeof browser>, body: unknown, id = PID) =>
  fetch(`${base}/projects/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'pattern', cookie: b.cookie },
    body: JSON.stringify(body),
  });

test('projects: create, list changes since a cursor, conflicts on a stale revision', async () => {
  const created = await put(alice, project());
  assert.equal(created.status, 200);
  assert.equal(((await created.json()) as { rev: number }).rev, 1);

  const first = await alice.json<{ now: string; projects: { id: string; rev: number }[] }>(await alice.get('/projects'));
  assert.deepEqual(first.projects.map((p) => p.id), [PID]);
  const empty = await alice.json<{ projects: unknown[] }>(await alice.get(`/projects?since=${encodeURIComponent(first.now)}`));
  assert.equal(empty.projects.length, 0, 'nothing changed since the cursor');

  const edit = await put(alice, project({ name: 'Shop v2', baseRev: 1, updatedAt: 1_700_000_100_000 }));
  assert.equal(((await edit.json()) as { rev: number }).rev, 2);
  const stale = await put(alice, project({ name: 'from laptop', baseRev: 1 }));
  assert.equal(stale.status, 409);
  const conflict = (await stale.json()) as { project: { name: string; rev: number } };
  assert.equal(conflict.project.name, 'Shop v2');
  const forced = await put(alice, project({ name: 'from laptop', baseRev: 1, force: true }));
  assert.equal(((await forced.json()) as { rev: number; name: string }).rev, 3);

  const changed = await alice.json<{ projects: { name: string }[] }>(await alice.get(`/projects?since=${encodeURIComponent(first.now)}`));
  assert.deepEqual(changed.projects.map((p) => p.name), ['from laptop']);
});

test('projects: other users cannot read or overwrite them', async () => {
  assert.equal((await bob.get(`/projects/${PID}`)).status, 404);
  assert.equal((await put(bob, project({ name: 'stolen' }))).status, 404);
  assert.equal((await put(browser(), project())).status, 401, 'signed out');
  assert.equal((await alice.post('/projects/not-a-uuid/shares', { mode: 'live' })).status, 400);
});

test('versions are idempotent by id', async () => {
  const v = { id: '2b9a4f1e-5c3d-4e2f-8a1b-9c0d1e2f3a4b', at: Date.now(), label: 'v1', auto: false, name: 'Shop', notes: '', design: solution('01-first-sale'), scenario: project().scenario };
  const send = () =>
    fetch(`${base}/projects/${PID}/versions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'pattern', cookie: alice.cookie },
      body: JSON.stringify(v),
    });
  assert.equal((await send()).status, 204);
  assert.equal((await send()).status, 204);
  const list = await alice.json<{ id: string; label: string }[]>(await alice.get(`/projects/${PID}/versions`));
  assert.deepEqual(list.map((x) => x.label), ['v1']);
});

test('share links: live follows edits, snapshot is frozen, revoke works', async () => {
  const live = await alice.json<{ slug: string }>(await alice.post(`/projects/${PID}/shares`, { mode: 'live' }));
  const snap = await alice.json<{ slug: string }>(await alice.post(`/projects/${PID}/shares`, { mode: 'snapshot' }));
  await put(alice, project({ name: 'after share', force: true }));
  const anon = browser();
  const a = await anon.json<{ name: string; author: string; design: { nodes: unknown[] } }>(await anon.get(`/share/${live.slug}`));
  assert.equal(a.name, 'after share');
  assert.equal(a.author, 'alice');
  assert.ok(a.design.nodes.length > 0);
  const b = await anon.json<{ name: string }>(await anon.get(`/share/${snap.slug}`));
  assert.equal(b.name, 'from laptop');
  const listed = await alice.json<{ slug: string; views: number }[]>(await alice.get(`/projects/${PID}/shares`));
  assert.equal(listed.find((s) => s.slug === live.slug)?.views, 1);
  assert.equal((await bob.del(`/shares/${live.slug}`)).status, 404);
  assert.equal((await alice.del(`/shares/${live.slug}`)).status, 204);
  assert.equal((await anon.get(`/share/${live.slug}`)).status, 404);
});

test('deleting a project leaves a tombstone for other devices and revokes its links', async () => {
  const before = await alice.json<{ now: string }>(await alice.get('/projects'));
  const snapLink = (await alice.json<{ slug: string }[]>(await alice.get(`/projects/${PID}/shares`)))[0].slug;
  assert.equal((await alice.del(`/projects/${PID}`)).status, 204);
  const after = await alice.json<{ projects: { id: string; deleted: boolean }[] }>(await alice.get(`/projects?since=${encodeURIComponent(before.now)}`));
  assert.deepEqual(after.projects.map((p) => [p.id, p.deleted]), [[PID, true]]);
  assert.equal((await browser().get(`/share/${snapLink}`)).status, 404);
  // saving it again (offline edit on another device) brings it back
  assert.equal((await put(alice, project({ force: true }))).status, 200);
});

// ------------------------------------------------------------ community levels

test('community levels: engine-checked publishing, play, moderation', async () => {
  const official = JSON.parse(readFileSync(join(root, 'levels/01-first-sale.json'), 'utf8'));
  const level = { ...official, id: undefined, title: 'Đợt sale của tôi', brief: 'Giống level 1, do cộng đồng tạo.' };

  // the reference solution must reach 3★ (here the losing start design is offered as the solution)
  const bad = await bob.post('/levels', { level, solution: official.design });
  assert.equal(bad.status, 400);

  const created = await bob.post('/levels', { level, solution: solution('01-first-sale') });
  assert.equal(created.status, 201);
  const { id, check } = (await created.json()) as { id: string; check: { start: number; solution: number } };
  assert.match(id, /^u-dot-sale-cua-toi-[0-9a-f]{6}$/);
  assert.deepEqual(check, { start: 0, solution: 3 });

  const anon = browser();
  const list = await anon.json<{ id: string; author: string }[]>(await anon.get('/levels/community'));
  assert.deepEqual(list.map((l) => [l.id, l.author]), [[id, 'bob']]);
  const fetched = await anon.json<{ id: string; solution?: unknown; title: string }>(await anon.get(`/levels/${id}`));
  assert.equal(fetched.title, 'Đợt sale của tôi');
  assert.equal(fetched.solution, undefined, 'the reference solution is never sent to players');

  const played = await alice.post(`/levels/${id}/submit`, { design: solution('01-first-sale') });
  assert.equal(((await played.json()) as { summary: { stars: number } }).summary.stars, 3);
  assert.equal((await anon.json<unknown[]>(await anon.get(`/levels/${id}/leaderboard`))).length, 1);

  // only the author edits; admins (alice is admin) can hide
  const del = await fetch(`${base}/levels/${id}`, { method: 'DELETE', headers: { 'x-requested-with': 'pattern', cookie: browser().cookie } });
  assert.equal(del.status, 401);
  const hide = await fetch(`${base}/levels/${id}/hidden`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'pattern', cookie: bob.cookie },
    body: JSON.stringify({ hidden: true }),
  });
  assert.equal(hide.status, 403, 'bob is not an admin');
  const hidden = await fetch(`${base}/levels/${id}/hidden`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'pattern', cookie: alice.cookie },
    body: JSON.stringify({ hidden: true }),
  });
  assert.equal(hidden.status, 204);
  assert.equal((await anon.json<unknown[]>(await anon.get('/levels/community'))).length, 0);
  assert.equal((await anon.get(`/levels/${id}`)).status, 404);
  assert.equal((await bob.get(`/levels/${id}`)).status, 200, 'the author still sees it');
  const edit = await bob.json<{ solution: { nodes: unknown[] } }>(await bob.get(`/levels/${id}/edit`));
  assert.ok(edit.solution.nodes.length > 0);
});
