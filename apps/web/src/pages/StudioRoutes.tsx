import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { PRESETS } from '@/presets';
import { ProjectsHome } from '@/projects/ProjectsHome';
import { projectFromPreset, store, type Project } from '@/projects/store';
import { Workspace } from '@/features/workspace/Workspace';
import { Button } from '@/components/ui/button';

/** `/studio`: saved projects and templates. `?template=<key>` creates a project from a template. */
export function StudioHome() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') ?? 'mine');
  const template = params.get('template');
  const created = useRef<string | null>(null);
  useEffect(() => {
    // once per template, even when StrictMode runs effects twice
    if (!template || !PRESETS[template] || created.current === template) return;
    created.current = template;
    const p = projectFromPreset(PRESETS[template], PRESETS[template].title, template);
    store.put(p).then(() => navigate(`/studio/${p.id}`, { replace: true }));
  }, [template, navigate]);
  return (
    <ProjectsHome
      presets={PRESETS}
      onOpen={(p) => navigate(`/studio/${p.id}`)}
      tab={tab}
      onTab={(t) => {
        setTab(t);
        setParams(t === 'mine' ? {} : { tab: t }, { replace: true });
      }}
    />
  );
}

/** `/studio/:projectId`: one project on the canvas. */
export function StudioProjectRoute() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setProject(undefined);
    store.get(projectId).then((p) => alive && setProject(p ?? null));
    return () => {
      alive = false;
    };
  }, [projectId]);
  if (project === undefined) return <div className="p-6 text-sm text-muted-foreground">Đang mở dự án…</div>;
  if (project === null)
    return (
      <div className="grid justify-items-start gap-3 p-6">
        <p className="text-sm">Không tìm thấy dự án này trên máy.</p>
        <Button size="sm" onClick={() => navigate('/studio')}>
          Về danh sách dự án
        </Button>
      </div>
    );
  return <Workspace key={project.id} mode="sandbox" project={project} onClose={() => navigate('/studio')} />;
}
