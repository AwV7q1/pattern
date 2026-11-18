import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '@/app/api';
import { Workspace } from '@/features/workspace/Workspace';
import { newId, store, type Project } from '@/projects/store';
import type { Design, Scenario } from '@/types';

interface Shared {
  slug: string;
  mode: 'live' | 'snapshot';
  author: string;
  name: string;
  description: string;
  design: Design;
  scenario: Scenario;
  updatedAt: number;
}

/** `/s/:slug`: a project someone shared, on the canvas, read-only. */
export function SharePage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [shared, setShared] = useState<Shared | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setShared(null);
    setError(null);
    api<Shared>(`/share/${encodeURIComponent(slug)}`)
      .then(setShared)
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'Link không tồn tại hoặc đã bị thu hồi.' : String(e.message)));
  }, [slug]);

  const project = useMemo<Project | null>(
    () =>
      shared && {
        id: `share-${shared.slug}`,
        name: shared.name,
        description: shared.description,
        notes: '',
        design: shared.design,
        scenario: shared.scenario,
        createdAt: shared.updatedAt,
        updatedAt: shared.updatedAt,
        source: `share:${shared.slug}`,
      },
    [shared],
  );
  const readOnly = useMemo(
    () =>
      shared && {
        author: shared.author,
        onDuplicate: async (p: Project) => {
          const now = Date.now();
          const copy: Project = { ...p, id: newId(), name: `${p.name} (của ${shared.author})`, createdAt: now, updatedAt: now, lastRun: undefined };
          await store.put(copy);
          navigate(`/studio/${copy.id}`);
        },
      },
    [shared, navigate],
  );

  if (error)
    return (
      <div className="grid justify-items-start gap-2 p-6 text-sm">
        <p>{error}</p>
        <Link to="/studio" className="text-primary underline">
          Về Studio
        </Link>
      </div>
    );
  if (!project || !readOnly) return <div className="p-6 text-sm text-muted-foreground">Đang mở link chia sẻ…</div>;
  return <Workspace key={project.id} mode="sandbox" project={project} readOnly={readOnly} onClose={() => navigate('/studio')} />;
}
