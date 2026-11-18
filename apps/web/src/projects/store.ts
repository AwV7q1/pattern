import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { useCallback, useEffect, useState } from 'react';
import type { Design, Preset, Scenario } from '@/types';

/** Frame drawn around nodes on the canvas (namespace, node pool…); ignored by the engine. */
export interface DesignGroup {
  id: string;
  label: string;
  kind: 'cluster' | 'namespace' | 'nodePool' | 'zone';
  position: { x: number; y: number };
  size: { width: number; height: number };
  parent?: string;
}

export interface StudioDesign extends Design {
  groups?: DesignGroup[];
}

/** Last simulation numbers, so a project (and its prompt) remembers how it behaved. */
export interface RunSnapshot {
  at: number;
  simSeconds: number;
  rps: number;
  p50Ms: number;
  p99Ms: number;
  errorRate: number;
  sloOk: number;
  costPerHour: number;
  hot: { label: string; utilization: number; dropped: number; queue: number }[];
}

export interface Project {
  id: string;
  name: string;
  /** Text of the template it came from. */
  description: string;
  /** User notes: goals, business requirements; feeds the agent prompt. */
  notes: string;
  design: StudioDesign;
  scenario: Scenario;
  createdAt: number;
  updatedAt: number;
  /** Template / case it was created from. */
  source?: string;
  lastRun?: RunSnapshot;
}

export interface Version {
  id: string;
  projectId: string;
  at: number;
  /** Named by the user (⌘S) or automatic. */
  label?: string;
  auto: boolean;
  name: string;
  notes: string;
  design: StudioDesign;
  scenario: Scenario;
}

interface StudioDB extends DBSchema {
  projects: { key: string; value: Project; indexes: { updatedAt: number } };
  versions: { key: string; value: Version; indexes: { projectId: string } };
}

/** Storage behind the UI; an HTTP adapter (NestJS) can implement the same interface. */
export interface ProjectStore {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | undefined>;
  put(p: Project): Promise<void>;
  /**
   * Write only if the stored copy is still the one this tab started from
   * (`updatedAt === expected`): another tab may have saved in between.
   * An HTTP adapter maps this to `If-Match` / 412.
   */
  putIfUnchanged(p: Project, expected: number): Promise<PutResult>;
  remove(id: string): Promise<void>;
  versions(projectId: string): Promise<Version[]>;
  addVersion(v: Version): Promise<void>;
  updateVersion(v: Version): Promise<void>;
}

export type PutResult = { ok: true } | { ok: false; current: Project | undefined };

const MAX_AUTO_VERSIONS = 50;
const CHANGED = 'pattern:projects-changed';

let dbp: Promise<IDBPDatabase<StudioDB>> | null = null;
const db = () =>
  (dbp ??= openDB<StudioDB>('pattern-studio', 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      d.createObjectStore('versions', { keyPath: 'id' }).createIndex('projectId', 'projectId');
    },
  }));

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pattern-studio') : null;
const notify = () => {
  window.dispatchEvent(new Event(CHANGED));
  channel?.postMessage('changed');
};
channel?.addEventListener('message', () => window.dispatchEvent(new Event(CHANGED)));

/** Called after any write to the projects store, from this tab or another one. */
export function onProjectsChanged(cb: () => void) {
  window.addEventListener(CHANGED, cb);
  return () => window.removeEventListener(CHANGED, cb);
}

export const idbStore: ProjectStore = {
  async list() {
    const all = await (await db()).getAllFromIndex('projects', 'updatedAt');
    return all.reverse();
  },
  async get(id) {
    return (await db()).get('projects', id);
  },
  async put(p) {
    await (await db()).put('projects', p);
    notify();
  },
  async putIfUnchanged(p, expected) {
    // one readwrite transaction: no other tab can write between the check and the put
    const tx = (await db()).transaction('projects', 'readwrite');
    const current = await tx.store.get(p.id);
    if (current?.updatedAt !== expected) {
      await tx.done;
      return { ok: false, current };
    }
    await tx.store.put(p);
    await tx.done;
    notify();
    return { ok: true };
  },
  async remove(id) {
    const d = await db();
    const tx = d.transaction(['projects', 'versions'], 'readwrite');
    await tx.objectStore('projects').delete(id);
    const vs = await tx.objectStore('versions').index('projectId').getAllKeys(id);
    await Promise.all(vs.map((k) => tx.objectStore('versions').delete(k)));
    await tx.done;
    notify();
  },
  async versions(projectId) {
    const vs = await (await db()).getAllFromIndex('versions', 'projectId', projectId);
    return vs.sort((a, b) => b.at - a.at);
  },
  async addVersion(v) {
    const d = await db();
    await d.put('versions', v);
    // keep every named version, prune the oldest automatic ones
    const autos = (await this.versions(v.projectId)).filter((x) => x.auto);
    await Promise.all(autos.slice(MAX_AUTO_VERSIONS).map((x) => d.delete('versions', x.id)));
  },
  async updateVersion(v) {
    await (await db()).put('versions', v);
  },
};

export const store: ProjectStore = idbStore;

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function projectFromPreset(p: Preset, name = p.title, source?: string): Project {
  const now = Date.now();
  return {
    id: newId(),
    name,
    description: p.description,
    notes: '',
    design: structuredClone(p.design),
    scenario: structuredClone(p.scenario),
    createdAt: now,
    updatedAt: now,
    source,
  };
}

export const BLANK: Preset = {
  title: 'Dự án mới',
  description: 'Bản thiết kế trống. Kéo công nghệ từ thư viện bên trái vào canvas rồi nối từ Client.',
  design: {
    nodes: [{ id: 'client', kind: 'client', label: 'Client', position: { x: 0, y: 200 } }],
    edges: [],
  },
  scenario: {
    seed: 1,
    timeoutMs: 10000,
    traffic: [{ atMs: 0, rps: 200 }],
    slo: { p99Ms: 300, errorRate: 0.01 },
    windowMs: 1000,
  },
};

export function snapshotOf(p: Project, label?: string): Version {
  return {
    id: newId(),
    projectId: p.id,
    at: Date.now(),
    label,
    auto: !label,
    name: p.name,
    notes: p.notes,
    design: structuredClone(p.design),
    scenario: structuredClone(p.scenario),
  };
}

/** Parse an exported project or a plain `examples/*.json` preset. */
export function importJson(text: string): Project {
  const data = JSON.parse(text);
  if (!data?.design?.nodes || !data?.scenario) throw new Error('File không phải design hợp lệ (thiếu design/scenario).');
  const p = projectFromPreset(
    { title: data.name ?? data.title ?? 'Design nhập', description: data.description ?? '', design: data.design, scenario: data.scenario },
    data.name ?? data.title ?? 'Design nhập',
    'import',
  );
  p.notes = data.notes ?? '';
  return p;
}

export function exportJson(p: Project) {
  const data = {
    title: p.name,
    name: p.name,
    description: p.description,
    notes: p.notes,
    design: p.design,
    scenario: p.scenario,
  };
  return JSON.stringify(data, null, 2);
}

export function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  // revoking synchronously can cancel the download in Firefox/Safari
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'design';

/** All projects, newest first; refreshes when any tab changes them. */
export function useProjects() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    store
      .list()
      .then(setProjects)
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, [refresh]);
  return { projects, error, refresh };
}

export function timeAgo(t: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return 'vừa xong';
  if (s < 60) return `${s} giây trước`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return new Date(t).toLocaleDateString('vi-VN');
}

/** Upload an immutable snapshot (NestJS `/api/shares`); returns the link to open it. */
export async function shareProject(p: Project): Promise<string> {
  const res = await fetch('/api/shares', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: p.name, description: p.description, notes: p.notes, design: p.design, scenario: p.scenario }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  const { id } = (await res.json()) as { id: string };
  return shareUrl(id);
}

export const shareUrl = (id: string) => `${location.origin}${location.pathname}?share=${encodeURIComponent(id)}`;

/** A shared snapshot as a new local project (the link never edits the original). */
export async function fetchShare(id: string): Promise<Project> {
  const res = await fetch(`/api/shares/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(res.status === 404 ? 'Link chia sẻ không tồn tại hoặc đã bị xoá.' : await errorText(res));
  const s = (await res.json()) as { name: string; description: string; notes: string; design: StudioDesign; scenario: Scenario };
  const p = projectFromPreset({ title: s.name, description: s.description, design: s.design, scenario: s.scenario }, s.name, 'share');
  p.notes = s.notes;
  return p;
}

async function errorText(res: Response) {
  if (res.status >= 500 && res.status !== 501) return `Không kết nối được server (HTTP ${res.status}). Chạy \`pnpm dev:server\`?`;
  try {
    const body = (await res.json()) as { message?: string | string[] };
    return Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? `HTTP ${res.status}`);
  } catch {
    return `HTTP ${res.status}`;
  }
}
