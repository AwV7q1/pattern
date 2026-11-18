import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Summary } from '../engine/engine.service';

export interface Entry {
  player: string;
  stars: number;
  costPerHour: number;
  p99Ms: number;
  errorRate: number;
  submittedAt: Date;
}

type Comparable = Pick<Entry, 'stars' | 'costPerHour' | 'p99Ms'>;

/** Better = more stars, then cheaper, then faster. */
export function compareEntries(a: Comparable, b: Comparable) {
  return b.stars - a.stars || a.costPerHour - b.costPerHour || a.p99Ms - b.p99Ms;
}

/** Best entry of each user on each level (`LeaderboardEntry`, one row per pair). */
@Injectable()
export class LeaderboardService {
  constructor(private readonly db: PrismaService) {}

  async submit(levelId: string, userId: string, summary: Summary, design: unknown) {
    const entry = {
      stars: summary.stars,
      costPerHour: summary.costPerHour,
      p99Ms: summary.p99Ms,
      errorRate: summary.errorRate,
    };
    const prev = await this.db.leaderboardEntry.findUnique({ where: { levelId_userId: { levelId, userId } } });
    const improved = !prev || compareEntries(entry, prev) < 0;
    if (improved) {
      const data = { ...entry, design: design as Prisma.InputJsonValue, submittedAt: new Date() };
      await this.db.leaderboardEntry.upsert({
        where: { levelId_userId: { levelId, userId } },
        create: { levelId, userId, ...data },
        update: data,
      });
    }
    const all = await this.db.leaderboardEntry.findMany({ where: { levelId }, select: { userId: true, stars: true, costPerHour: true, p99Ms: true } });
    const rank = all.sort(compareEntries).findIndex((e) => e.userId === userId) + 1;
    return { improved, rank };
  }

  async top(levelId: string, limit = 20): Promise<Entry[]> {
    const rows = await this.db.leaderboardEntry.findMany({
      where: { levelId },
      orderBy: [{ stars: 'desc' }, { costPerHour: 'asc' }, { p99Ms: 'asc' }],
      take: limit,
      include: { user: { select: { displayName: true } } },
    });
    return rows.map((r) => ({
      player: r.user.displayName,
      stars: r.stars,
      costPerHour: r.costPerHour,
      p99Ms: r.p99Ms,
      errorRate: r.errorRate,
      submittedAt: r.submittedAt,
    }));
  }
}
