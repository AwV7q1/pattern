import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { PRESETS } from '@/presets';
import { ProjectsHome } from '@/projects/ProjectsHome';
import { projectFromPreset, store, type Project } from '@/projects/store';
import { Workspace } from '@/features/workspace/Workspace';
import { Button } from '@/components/ui/button';
import { CloudUpload } from 'lucide-react';
import { useAuth } from '@/app/auth-store';
import { uploadLocalProjects, useSync } from '@/projects/sync';

/** Signed in with projects that only live on this device: offer to upload them. */
function UploadBanner() {
  const signedIn = useAuth((s) => s.status === 'signed-in');
  const { localOnly, state } = useSync();
  const [busy, setBusy] = useState(false);
  if (!signedIn || !localOnly) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
      <CloudUpload className="size-5 shrink-0 text-primary" />
      <span className="flex-1">
        Có <b>{localOnly}</b> dự án chỉ lưu trên máy này. Đẩy lên tài khoản để mở ở máy khác và chia sẻ link?
      </span>
      <Button
        size="sm"
        disabled={busy || state === 'syncing'}
        onClick={() => {
          setBusy(true);
          void uploadLocalProjects().finally(() => setBusy(false));
        }}
      >
        Đẩy lên tài khoản
      </Button>
    </div>
  );
}

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
      banner={<UploadBanner />}
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
