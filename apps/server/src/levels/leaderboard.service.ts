import { Injectable, OnModuleInit } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Summary } from '../engine/engine.service';

export interface Entry {
  player: string;
  stars: number;
  costPerHour: number;
  p99Ms: number;
  errorRate: number;
  submittedAt: string;
  design: unknown;
}

/** Better = more stars, then cheaper, then faster. */
export function compareEntries(a: Entry, b: Entry) {
  return b.stars - a.stars || a.costPerHour - b.costPerHour || a.p99Ms - b.p99Ms;
}

/**
 * Best entry per player per level, persisted to a JSON file. Good enough for
 * a prototype; swap for a database table (levelId, player) when needed.
 */
@Injectable()
export class LeaderboardService implements OnModuleInit {
  private boards = new Map<string, Map<string, Entry>>();
  readonly file = process.env.LEADERBOARD_FILE ?? resolve(process.cwd(), 'data/leaderboard.json');

  onModuleInit() {
    if (!existsSync(this.file)) return;
    const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, Entry[]>;
    for (const [level, entries] of Object.entries(raw)) {
      this.boards.set(level, new Map(entries.map((e) => [e.player, e])));
    }
  }

  submit(levelId: string, player: string, summary: Summary, design: unknown) {
    const board = this.boards.get(levelId) ?? new Map<string, Entry>();
    this.boards.set(levelId, board);
    const entry: Entry = {
      player,
      stars: summary.stars,
      costPerHour: summary.costPerHour,
      p99Ms: summary.p99Ms,
      errorRate: summary.errorRate,
      submittedAt: new Date().toISOString(),
      design,
    };
    const prev = board.get(player);
    const improved = !prev || compareEntries(entry, prev) < 0;
    if (improved) {
      board.set(player, entry);
      this.persist();
    }
    return { improved, rank: this.top(levelId, Infinity).findIndex((e) => e.player === player) + 1 };
  }

  top(levelId: string, limit = 20) {
    return [...(this.boards.get(levelId)?.values() ?? [])].sort(compareEntries).slice(0, limit);
  }

  private persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    const out = Object.fromEntries([...this.boards].map(([k, v]) => [k, [...v.values()]]));
    writeFileSync(this.file, JSON.stringify(out, null, 2));
  }
}
