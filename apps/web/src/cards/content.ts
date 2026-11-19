import cardsData from './data/cards.json';
import enemiesData from './data/enemies.json';
import battleData from './data/battle.json';
import runData from './data/run.json';
import { isValidRun } from './run';
import type { Content, RunState } from './types';

export const CONTENT = { cards: cardsData, enemies: enemiesData, battle: battleData, run: runData } as unknown as Content;

const KEY = 'pattern.cards.run.v1';

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
