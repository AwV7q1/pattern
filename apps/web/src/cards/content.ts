import cardsData from './data/cards.json';
import enemiesData from './data/enemies.json';
import battleData from './data/battle.json';
import runData from './data/run.json';
import eventsData from './data/events.json';
import relicsData from './data/relics.json';
import { isValidRun } from './run';
import type { Content, RunState } from './types';

export const CONTENT = { cards: cardsData, enemies: enemiesData, battle: battleData, run: runData, events: eventsData, relics: relicsData } as unknown as Content;

const KEY = 'pattern.cards.run.v3';
const BEST_KEY = 'pattern.cards.best.v1';

/** The run in progress, kept between visits. Mid-fight progress is not saved: a reload replays the fight from its (seeded) start. */
export function loadRun(): RunState | null {
  try {
    const raw = localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return isValidRun(CONTENT, v) ? v : null;
  } catch {
    return null;
  }
}

export function saveRun(run: RunState | null) {
  try {
    if (run) localStorage.setItem(KEY, JSON.stringify(run));
    else localStorage.removeItem(KEY);
  } catch {
    // storage full or blocked: the run just is not kept
  }
}

/** Records across runs: towers beaten and the highest point reached. */
export interface Best {
  wins: number;
  runs: number;
  bestAct: number;
  bestClimbed: number;
  /** Seed of the last counted run, so a reload of a finished run is not counted twice. */
  last: number;
  /** Whether that run went further than any run before it. */
  lastRecord: boolean;
}

const NO_BEST: Best = { wins: 0, runs: 0, bestAct: 0, bestClimbed: 0, last: 0, lastRecord: false };

export function loadBest(): Best {
  try {
    const v = JSON.parse(localStorage.getItem(BEST_KEY) ?? 'null') as Partial<Best> | null;
    return { ...NO_BEST, ...(v && typeof v === 'object' ? v : {}) };
  } catch {
    return NO_BEST;
  }
}

/** Count a finished run once (later calls for the same run return the same result). */
export function recordRun(run: RunState): { best: Best; record: boolean } {
  const before = loadBest();
  if (run.phase !== 'won' && run.phase !== 'lost') return { best: before, record: false };
  if (before.last === run.seed) return { best: before, record: before.lastRecord };
  const after: Best = {
    wins: before.wins + (run.phase === 'won' ? 1 : 0),
    runs: before.runs + 1,
    bestAct: Math.max(before.bestAct, run.phase === 'won' ? run.act + 1 : run.act),
    bestClimbed: Math.max(before.bestClimbed, run.climbed),
    last: run.seed,
    lastRecord: before.runs > 0 && run.climbed > before.bestClimbed,
  };
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(after));
  } catch {
    // not kept
  }
  return { best: after, record: after.lastRecord };
}
