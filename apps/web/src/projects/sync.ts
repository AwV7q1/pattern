import { create } from 'zustand';
import { api, ApiError } from '@/app/api';
import { useAuth } from '@/app/auth-store';
import { idb, idbStore, newId, syncHooks, type OutboxItem, type Project, type Version } from './store';

/**
 * Keeps IndexedDB and the server in step for the signed-in user.
 *
 * - Every local write lands in IndexedDB first (instant, works offline) and
 *   in an outbox; the outbox is replayed in order when the server is reachable.
 * - Pull asks for projects changed since a server-side cursor.
 * - Conflicts (the server has a newer revision than the one an edit was based
 *   on) never lose work: the local copy wins, the server copy is kept as a
 *   version named "Bản từ máy khác".
 */

export interface SyncState {
  state: 'off' | 'idle' | 'syncing' | 'offline' | 'error';
  pending: number;
  lastSync?: number;
  error?: string;
  /** Projects on this device that were never uploaded to the account. */
  localOnly: number;
}

export const useSync = create<SyncState>()(() => ({ state: 'off', pending: 0, localOnly: 0 }));

interface WireProject extends Omit<Project, 'rev' | 'owner'> {
  rev: number;
  deleted: boolean;
}

export const CONFLICT_EVENT = 'pattern:sync-conflict';

let user: string | null = null;
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
/** Project on the canvas right now: pulls must not change it under the user's feet. */
let openProject: string | null = null;

export const setOpenProject = (id: string | null) => {
  openProject = id;
};

const cursorKey = () => `cursor:${user}`;

async function refreshCounts() {
  const [items, all] = await Promise.all([idb.outbox(), idbStore.list()]);
  useSync.setState({ pending: items.length, localOnly: user ? all.filter((p) => !p.owner).length : 0 });
}

function schedule(ms = 1500) {
  if (!user) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
}

/** Push the outbox, then pull remote changes. Single-flight. */
export function syncNow(): Promise<void> {
  if (!user) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    useSync.setState({ state: 'syncing', error: undefined });
    try {
      do {
        again = false;
        await push();
        await pull();
      } while (again);
      useSync.setState({ state: 'idle', lastSync: Date.now() });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await useAuth.getState().refresh();
        useSync.setState({ state: 'off' });
      } else if (err instanceof ApiError && err.offline) {
        useSync.setState({ state: 'offline' });
      } else {
        useSync.setState({ state: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      running = null;
      await refreshCounts();
    }
  })();
  return running;
}

const body = (p: Project) => ({
  name: p.name,
  description: p.description,
  notes: p.notes,
  design: p.design,
  scenario: p.scenario,
  source: p.source,
  lastRun: p.lastRun,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

const fromWire = (w: WireProject): Project => {
  const { deleted: _deleted, ...rest } = w;
  return { ...rest, source: w.source ?? undefined, owner: user ?? undefined };
};

async function pushProject(item: OutboxItem) {
  const p = await idbStore.get(item.id);
  if (!p || (p.owner && p.owner !== user)) return;
  try {
    const saved = await api<WireProject>(`/projects/${p.id}`, { method: 'PUT', body: { ...body(p), baseRev: p.rev } });
    await markSynced(p.id, saved.rev);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 409) throw err;
    // conflict: keep the server copy as a version, then save ours on top
    const theirs = (err.body as { project: WireProject }).project;
    const v: Version = {
      id: newId(),
      projectId: p.id,
      at: theirs.updatedAt,
      label: `Bản từ máy khác (rev ${theirs.rev})`,
      auto: false,
      name: theirs.name,
      notes: theirs.notes,
      design: theirs.design,
      scenario: theirs.scenario,
    };
    await idbStore.addVersion(v);
    const saved = await api<WireProject>(`/projects/${p.id}`, { method: 'PUT', body: { ...body(p), baseRev: theirs.rev, force: true } });
    await markSynced(p.id, saved.rev);
    await idb.enqueue({ key: `version:${v.id}`, kind: 'version', id: v.id, projectId: p.id, at: Date.now() });
    again = true; // send that version in this round
    window.dispatchEvent(new CustomEvent(CONFLICT_EVENT, { detail: { name: p.name } }));
  }
}

/** Record the server revision without touching content edited meanwhile. */
async function markSynced(id: string, rev: number) {
  const latest = await idbStore.get(id);
  if (latest) await idbStore.put({ ...latest, rev, owner: user ?? undefined });
}

async function push() {
  for (const item of await idb.outbox()) {
    if (item.kind === 'project') await pushProject(item);
    else if (item.kind === 'delete') {
      await api(`/projects/${item.id}`, { method: 'DELETE' }).catch((e) => {
        if (!(e instanceof ApiError) || e.status !== 404) throw e;
      });
    } else {
      const v = await idb.version(item.id);
      if (v) {
        try {
          await api(`/projects/${v.projectId}/versions`, { method: 'PUT', body: { ...v, projectId: undefined } });
        } catch (e) {
          // project not uploaded (local-only): drop, it will be sent with the upload
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
        }
      }
    }
    await idb.dequeue(item);
  }
}

async function pull() {
  const since = await idb.meta<string>(cursorKey());
  const res = await api<{ now: string; projects: WireProject[] }>(`/projects${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  for (const w of res.projects) {
    // edits waiting to be pushed, or the project open on the canvas: push resolves it later
    if (w.id === openProject || (await idb.pendingFor(w.id))) continue;
    const local = await idbStore.get(w.id);
    if (w.deleted) {
      if (local) await idbStore.remove(w.id);
    } else if (!local || local.rev !== w.rev) {
      await idbStore.put(fromWire(w));
    }
  }
  await idb.setMeta(cursorKey(), res.now);
}

/** Merge the server's versions of a project (another device may have saved some). */
async function pullVersions(projectId: string) {
  if (!user) return;
  const p = await idbStore.get(projectId);
  if (!p?.owner) return;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2000);
  try {
    const remote = await api<Version[]>(`/projects/${projectId}/versions`, { signal: ctl.signal });
    const local = new Set((await idbStore.versions(projectId)).map((v) => v.id));
    for (const v of remote) if (!local.has(v.id)) await idbStore.updateVersion({ ...v, projectId });
  } finally {
    clearTimeout(t);
  }
}

/** Upload the projects that only live on this device to the signed-in account. */
export async function uploadLocalProjects() {
  if (!user) return;
  const now = Date.now();
  for (const p of (await idbStore.list()).filter((x) => !x.owner)) {
    await idb.enqueue({ key: `project:${p.id}`, kind: 'project', id: p.id, at: now });
    for (const v of await idbStore.versions(p.id))
      await idb.enqueue({ key: `version:${v.id}`, kind: 'version', id: v.id, projectId: p.id, at: now + 1 });
  }
  await refreshCounts();
  await syncNow();
}

// ------------------------------------------------------------ wiring

syncHooks.enqueue = async (item, project) => {
  const owner = project?.owner;
  if (owner) {
    // in an account: sync it (signed out = sent at the next sign-in as that user)
    if (user && owner !== user) return;
  } else {
    // only on this device: projects created while signed in sync on their own,
    // older ones wait for the explicit "upload" (they may be private drafts)
    if (!user || item.kind === 'delete' || !project || project.createdAt < signedInAt) {
      void refreshCounts();
      return;
    }
  }
  await idb.enqueue({ ...item, key: `${item.kind}:${item.id}`, at: Date.now() });
  useSync.setState((s) => ({ pending: s.pending + 1 }));
  schedule();
};
syncHooks.pullVersions = pullVersions;

let signedInAt = Infinity;

function start(id: string) {
  if (user === id) return;
  user = id;
  void (async () => {
    // projects made after this user first signed in on this device sync on
    // their own; older local ones wait for the explicit upload
    const key = `firstSignIn:${id}`;
    // first time: everything made since this page loaded counts as new (it was
    // probably created while the session check was still running)
    const first = (await idb.meta<number>(key)) ?? Math.floor(performance.timeOrigin);
    await idb.setMeta(key, first);
    signedInAt = first;
    // catch up with projects created before the session check finished
    for (const p of await idbStore.list())
      if (!p.owner && p.createdAt >= first) await idb.enqueue({ key: `project:${p.id}`, kind: 'project', id: p.id, at: Date.now() });
    await refreshCounts();
    await syncNow();
  })();
  interval ??= setInterval(() => void syncNow(), 30_000);
}

function stop() {
  user = null;
  signedInAt = Infinity;
  if (interval) clearInterval(interval);
  interval = null;
  useSync.setState({ state: 'off', localOnly: 0 });
}

if (typeof window !== 'undefined') {
  useAuth.subscribe((s) => (s.status === 'signed-in' && s.user ? start(s.user.id) : s.status !== 'unknown' && stop()));
  window.addEventListener('online', () => void syncNow());
}
