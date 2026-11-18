import { useEffect, useMemo, useState } from 'react';
import { store, type Project, type Version } from '@/projects/store';
import type { Design, Scenario } from '@/types';

export interface DesignSource {
  key: string;
  title: string;
  group: 'current' | 'version' | 'project' | 'extra';
  design: Design;
  scenario: Scenario;
}

const when = (t: number) => new Date(t).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Designs a page can pick from: the project as saved, its versions and the
 * other projects. Keys: `current`, `v:<versionId>`, `p:<projectId>`, plus any
 * `extra` sources the caller adds.
 */
export function useDesignSources(projectId: string | null, extra: DesignSource[] = []) {
  const [project, setProject] = useState<Project | null | undefined>(projectId ? undefined : null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [others, setOthers] = useState<Project[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const all = await store.list();
      const p = projectId ? ((await store.get(projectId)) ?? null) : null;
      if (!alive) return;
      setProject(p);
      setOthers(all.filter((x) => x.id !== projectId));
      if (p) {
        const vs = await store.versions(p.id);
        if (alive) setVersions(vs);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  const sources = useMemo(() => {
    const m = new Map<string, DesignSource>();
    for (const e of extra) m.set(e.key, e);
    if (project)
      m.set('current', { key: 'current', group: 'current', title: `Bản hiện tại · ${project.name}`, design: project.design, scenario: project.scenario });
    for (const v of versions)
      m.set(`v:${v.id}`, { key: `v:${v.id}`, group: 'version', title: `${v.label ?? 'Tự động'} · ${when(v.at)}`, design: v.design, scenario: v.scenario });
    for (const o of others) m.set(`p:${o.id}`, { key: `p:${o.id}`, group: 'project', title: `Dự án: ${o.name}`, design: o.design, scenario: o.scenario });
    return m;
    // `extra` is rebuilt by callers each render; its keys identify it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, versions, others, extra.map((e) => e.key).join('|')]);

  return { project, versions, others, sources };
}
