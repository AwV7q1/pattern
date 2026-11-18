import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router';
import { LearnPage } from '@/learn/LearnPage';

/** `/learn` and `/learn/:lessonId` (open a lesson right away). */
export function LearnRoute() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const onOpened = useCallback(() => navigate('/learn', { replace: true }), [navigate]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <LearnPage
        onBuild={(level, lesson) => navigate(`/play/${level}?lesson=${encodeURIComponent(lesson)}`)}
        openLesson={lessonId ?? null}
        onOpened={onOpened}
      />
    </div>
  );
}
