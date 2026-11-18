import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { EyeOff, Eye, Gamepad2, Pencil, Plus, Star, Trash2, Users } from 'lucide-react';
import { LEARN_LEVELS, LEVELS } from '@/presets';
import { Workspace } from '@/features/workspace/Workspace';
import { api } from '@/app/api';
import { useAuth } from '@/app/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Level } from '@/types';

interface CommunityLevel {
  id: string;
  title: string;
  brief: string;
  author: string;
  mine: boolean;
  published: boolean;
  hidden: boolean;
}

/** Levels made by players (server), with edit / delete for the author and hide for admins. */
function CommunityLevels() {
  const auth = useAuth();
  const [levels, setLevels] = useState<CommunityLevel[] | null>(null);
  const load = useCallback(() => {
    api<CommunityLevel[]>('/levels/community')
      .then(setLevels)
      .catch(() => setLevels(null));
  }, []);
  useEffect(() => load(), [load, auth.status]);
  const admin = auth.user?.role === 'admin';
  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Users className="size-4" /> Level cộng đồng
        </h2>
        <Button asChild size="sm" variant="ghost" className="ml-auto">
          <Link to="/levels/new">
            <Plus /> Tạo level
          </Link>
        </Button>
      </div>
      {levels === null ? (
        <p className="text-sm text-muted-foreground">Cần server (`pnpm dev:server`) để xem level cộng đồng.</p>
      ) : levels.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có level nào. Dựng một design trong Studio rồi bấm “Tạo level”.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {levels.map((l) => (
            <div key={l.id} className="grid gap-2 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <Link to={`/play/${l.id}`} className="mr-auto font-medium hover:underline">
                  {l.title}
                </Link>
                {!l.published && <Badge variant="secondary">nháp</Badge>}
                {l.hidden && <Badge variant="destructive">đã ẩn</Badge>}
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">{l.brief}</p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="mr-auto">của {l.author}</span>
                {l.mine && (
                  <Button asChild size="icon-sm" variant="ghost" aria-label="Sửa level">
                    <Link to={`/levels/${l.id}/edit`}>
                      <Pencil />
                    </Link>
                  </Button>
                )}
                {(l.mine || admin) && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Xoá level"
                    onClick={async () => {
                      if (!confirm(`Xoá level “${l.title}” và bảng điểm của nó?`)) return;
                      await api(`/levels/${l.id}`, { method: 'DELETE' });
                      load();
                    }}
                  >
                    <Trash2 />
                  </Button>
                )}
                {admin && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={l.hidden ? 'Hiện level' : 'Ẩn level'}
                    onClick={async () => {
                      await api(`/levels/${l.id}/hidden`, { method: 'PATCH', body: { hidden: !l.hidden } });
                      load();
                    }}
                  >
                    {l.hidden ? <Eye /> : <EyeOff />}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const bestKey = (id: string) => `pattern.best.${id}`;

/** `/play`: the official levels with the best rating reached on this device. */
export function PlayHome() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-6 px-6 py-8">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Gamepad2 className="size-5" /> Game
          </h1>
          <p className="text-sm text-muted-foreground">
            Mỗi level là một sự cố có thật thu nhỏ: ngân sách, kịch bản chaos và 3 tiêu chí sao. Server chấm lại bằng đúng engine.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(LEVELS).map(([key, l]) => {
            const best = Number(localStorage.getItem(bestKey(l.id)) ?? 0);
            return (
              <Link key={key} to={`/play/${key}`} className="grid gap-2 rounded-lg border p-4 transition-colors hover:bg-accent/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{l.title}</span>
                  <span className="flex text-warning" aria-label={`${best} sao`}>
                    {[1, 2, 3].map((i) => (
                      <Star key={i} className="size-4" fill={i <= best ? 'currentColor' : 'none'} />
                    ))}
                  </span>
                </div>
                <p className="line-clamp-3 text-sm text-muted-foreground">{l.brief}</p>
              </Link>
            );
          })}
        </div>
        <CommunityLevels />
      </div>
    </div>
  );
}

/** `/play/<levelKey>` (`learn/...` levels come from a lesson: `?lesson=`). */
export function GameRoute() {
  const levelKey = useParams()['*'] ?? '';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const lesson = params.get('lesson');
  const community = levelKey.startsWith('u-');
  const [remote, setRemote] = useState<Level | null | undefined>(undefined);
  useEffect(() => {
    if (!community) return;
    setRemote(undefined);
    api<Level>(`/levels/${levelKey}`)
      .then(setRemote)
      .catch(() => setRemote(null));
  }, [community, levelKey]);
  const known = levelKey in LEVELS || levelKey in LEARN_LEVELS;
  if (community) {
    if (remote === undefined) return <div className="p-6 text-sm text-muted-foreground">Đang tải level…</div>;
    if (remote === null) return <Navigate to="/play" replace />;
  } else if (!known) return <Navigate to="/play" replace />;
  return (
    <Workspace
      key={`${levelKey}:${lesson ?? ''}`}
      mode="game"
      level={community ? (remote ?? undefined) : undefined}
      levelKey={levelKey}
      lessonId={lesson}
      onBackToPath={() => navigate('/learn')}
      onLevelChange={(k) => navigate(`/play/${k}`)}
    />
  );
}
