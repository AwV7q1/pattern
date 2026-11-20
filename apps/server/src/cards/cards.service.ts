import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** What a daily run reports. The score is not taken from the client: `dailyScore` recomputes it. */
export interface DailyRun {
  climbed: number;
  won: boolean;
  hp: number;
  chassis: string;
  summary: unknown;
}

export interface DailyEntry {
  player: string;
  score: number;
  climbed: number;
  won: boolean;
  hp: number;
  chassis: string;
  submittedAt: Date;
}

/** The daily score: nodes cleared, a bonus for clearing the tower, and the Error Budget left. Same formula as the web's `runScore`. */
export const dailyScore = (r: Pick<DailyRun, 'climbed' | 'won' | 'hp'>) => r.climbed * 100 + (r.won ? 1000 : 0) + r.hp * 5;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** A day a run can still be sent for: today or yesterday (UTC), so a run started before midnight still counts. */
export function assertOpenDay(date: string, now = Date.now()) {
  if (!DAY.test(date)) throw new BadRequestException('date: YYYY-MM-DD');
  if (date !== utcDay(now) && date !== utcDay(now - 86_400_000)) throw new BadRequestException('Thử thách của ngày này đã đóng');
}

/** Best daily run of each user (one row per day and user). */
@Injectable()
export class CardsService {
  constructor(private readonly db: PrismaService) {}

  async submit(date: string, userId: string, run: DailyRun) {
    assertOpenDay(date);
    const score = dailyScore(run);
    const prev = await this.db.cardsDailyEntry.findUnique({ where: { date_userId: { date, userId } } });
    const improved = !prev || score > prev.score;
    if (improved) {
      const data = { score, climbed: run.climbed, won: run.won, hp: run.hp, chassis: run.chassis, summary: (run.summary ?? {}) as Prisma.InputJsonValue, submittedAt: new Date() };
      await this.db.cardsDailyEntry.upsert({ where: { date_userId: { date, userId } }, create: { date, userId, ...data }, update: data });
    }
    const best = improved ? score : prev!.score;
    const rank = (await this.db.cardsDailyEntry.count({ where: { date, score: { gt: best } } })) + 1;
    return { score, best, improved, rank };
  }

  async top(date: string, limit = 20): Promise<DailyEntry[]> {
    if (!DAY.test(date)) throw new BadRequestException('date: YYYY-MM-DD');
    const rows = await this.db.cardsDailyEntry.findMany({
      where: { date },
      orderBy: [{ score: 'desc' }, { submittedAt: 'asc' }],
      take: limit,
      include: { user: { select: { displayName: true } } },
    });
    return rows.map((r) => ({ player: r.user.displayName, score: r.score, climbed: r.climbed, won: r.won, hp: r.hp, chassis: r.chassis, submittedAt: r.submittedAt }));
  }
}
