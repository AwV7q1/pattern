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
  /** Spaced repetition deck: card key (`lessonId#index`) -> schedule. */
  review: Record<string, ReviewItem>;
}

/**
 * Leitner box: a wrong answer puts the card in box 0, due tomorrow; each
 * right answer when it is due moves it up a box and pushes the next review
 * out (3, 7, 21 days). Past the last box it counts as learned.
 */
export interface ReviewItem {
  box: number;
  /** `YYYY-MM-DD`; null once learned. */
  due: string | null;
  misses: number;
  last: string;
}

/** Days until the next review after landing in box `i` (box 0 = after a miss). */
export const INTERVALS = [1, 3, 7, 21];
export const LEARNED = INTERVALS.length;
export const REVIEW_SIZE = 10;

const empty = (): Progress => ({ done: {}, xp: 0, days: {}, unlockAll: false, review: {} });

export const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function load(): Progress {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return empty();
  }
}

export const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return today(new Date(y, m - 1, d + n));
};

/** Next schedule of a card after an answer; `undefined` = leave it out of the deck. */
export function schedule(item: ReviewItem | undefined, correct: boolean, day: string, force = false): ReviewItem | undefined {
  if (!correct) return { box: 0, due: addDays(day, INTERVALS[0]), misses: (item?.misses ?? 0) + 1, last: day };
  if (!item || item.due === null) return item;
  // a right answer only counts once the card is due (or in a review session)
  if (!force && item.due > day) return item;
  const box = item.box + 1;
  return { ...item, box, due: box >= LEARNED ? null : addDays(day, INTERVALS[box]), last: day };
}

/** Keys due today or earlier, most overdue / weakest first. */
export function dueKeys(p: Progress, day = today()) {
  return Object.entries(p.review)
    .filter(([, r]) => r.due !== null && r.due <= day)
    .sort(([, a], [, b]) => a.due!.localeCompare(b.due!) || a.box - b.box)
    .map(([k]) => k);
}

/** Cards still being learned, weakest first (for an early review). */
export function weakKeys(p: Progress) {
  return Object.entries(p.review)
    .filter(([, r]) => r.due !== null)
    .sort(([, a], [, b]) => a.box - b.box || b.misses - a.misses || a.due!.localeCompare(b.due!))
    .map(([k]) => k);
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
  /** Update the review deck after the first answer to a card. */
  const recordAnswer = useCallback(
    (key: string, correct: boolean, force = false) => {
      const cur = load();
      const next = schedule(cur.review[key], correct, today(), force);
      if (next === cur.review[key]) return;
      const review = { ...cur.review };
      if (next) review[key] = next;
      else delete review[key];
      save({ ...cur, review });
    },
    [save],
  );
  /** XP not tied to a lesson (review sessions). */
  const addXp = useCallback(
    (gained: number) => {
      const cur = load();
      const day = today();
      save({ ...cur, xp: cur.xp + gained, days: { ...cur.days, [day]: (cur.days[day] ?? 0) + gained } });
      return gained;
    },
    [save],
  );
  const setUnlockAll = useCallback((unlockAll: boolean) => save({ ...load(), unlockAll }), [save]);
  const reset = useCallback(() => save(empty()), [save]);
  return { progress: p, complete, recordAnswer, addXp, setUnlockAll, reset };
}
