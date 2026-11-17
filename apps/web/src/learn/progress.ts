import { useCallback, useEffect, useState } from 'react';
import { LESSONS, lessonXp } from './curriculum';

const KEY = 'pattern.learn.v1';
export const DAILY_GOAL = 30;

export interface Progress {
  /** lessonId -> times completed (1 = done; more = practised again). */
  done: Record<string, number>;
  xp: number;
  /** XP per local day, `YYYY-MM-DD`. */
  days: Record<string, number>;
  /** Unlock every lesson (for people who already know the basics). */
  unlockAll: boolean;
}

const empty = (): Progress => ({ done: {}, xp: 0, days: {}, unlockAll: false });

export const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function load(): Progress {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return empty();
  }
}

/** Consecutive days with XP, ending today (or yesterday, if today has none yet). */
export function streak(p: Progress, now = new Date()) {
  let n = 0;
  const d = new Date(now);
  if (!p.days[today(d)]) d.setDate(d.getDate() - 1);
  while (p.days[today(d)]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** First lesson not done yet, in path order. */
export function nextLesson(p: Progress) {
  return LESSONS.find((l) => !p.done[l.id]) ?? null;
}

export function isUnlocked(p: Progress, lessonId: string) {
  if (p.unlockAll) return true;
  const i = LESSONS.findIndex((l) => l.id === lessonId);
  return i <= 0 || !!p.done[LESSONS[i - 1].id] || !!p.done[lessonId];
}

/** Progress shared by every component through localStorage + a window event. */
export function useProgress() {
  const [p, setP] = useState(load);
  useEffect(() => {
    const sync = () => setP(load());
    window.addEventListener('pattern-learn', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('pattern-learn', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const save = useCallback((next: Progress) => {
    localStorage.setItem(KEY, JSON.stringify(next));
    setP(next);
    window.dispatchEvent(new Event('pattern-learn'));
  }, []);
  /** Mark a lesson done; first completion gives full XP, replays a third. */
  const complete = useCallback(
    (lessonId: string, bonus = 0) => {
      const cur = load();
      const lesson = LESSONS.find((l) => l.id === lessonId);
      const base = lesson ? lessonXp(lesson.kind) : 10;
      const gained = (cur.done[lessonId] ? Math.ceil(base / 3) : base) + bonus;
      const day = today();
      save({
        ...cur,
        done: { ...cur.done, [lessonId]: (cur.done[lessonId] ?? 0) + 1 },
        xp: cur.xp + gained,
        days: { ...cur.days, [day]: (cur.days[day] ?? 0) + gained },
      });
      return gained;
    },
    [save],
  );
  const setUnlockAll = useCallback((unlockAll: boolean) => save({ ...load(), unlockAll }), [save]);
  const reset = useCallback(() => save(empty()), [save]);
  return { progress: p, complete, setUnlockAll, reset };
}
