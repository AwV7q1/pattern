import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { Gamepad2, Star } from 'lucide-react';
import { LEARN_LEVELS, LEVELS } from '@/presets';
import { Workspace } from '@/features/workspace/Workspace';

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
  const known = levelKey in LEVELS || levelKey in LEARN_LEVELS;
  if (!known) return <Navigate to="/play" replace />;
  return (
    <Workspace
      key={`${levelKey}:${lesson ?? ''}`}
      mode="game"
      levelKey={levelKey}
      lessonId={lesson}
      onBackToPath={() => navigate('/learn')}
      onLevelChange={(k) => navigate(`/play/${k}`)}
    />
  );
}
