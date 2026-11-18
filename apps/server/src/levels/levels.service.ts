import { BadRequestException, ForbiddenException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EngineService, InvalidDesignError } from '../engine/engine.service';
import type { AuthUser } from '../common/types';

export interface LevelFile {
  id: string;
  title: string;
  brief: string;
  hint?: string;
  palette: string[];
  locked: string[];
  design: unknown;
  scenario: { durationMs?: number; [k: string]: unknown };
  [key: string]: unknown;
}

const COMMUNITY = /^u-[a-z0-9-]{3,60}$/;
const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'level';

/**
 * Official levels live in the repo's `levels/` folder (shared with the web
 * app and the engine tests); community levels (`u-…`) in PostgreSQL.
 */
@Injectable()
export class LevelsService implements OnModuleInit {
  private levels = new Map<string, { level: LevelFile; json: string }>();
  readonly dir = process.env.LEVELS_DIR ?? resolve(__dirname, '../../../../levels');

  constructor(
    private readonly db: PrismaService,
    private readonly engine: EngineService,
  ) {}

  onModuleInit() {
    for (const file of readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort()) {
      const json = readFileSync(join(this.dir, file), 'utf8');
      const level = JSON.parse(json) as LevelFile;
      this.levels.set(level.id, { level, json });
    }
  }

  list() {
    return [...this.levels.values()].map(({ level }) => ({ id: level.id, title: level.title }));
  }

  /** Official level (sync, from memory). */
  get(id: string) {
    const entry = this.levels.get(id);
    if (!entry) throw new NotFoundException(`level '${id}' not found`);
    return entry;
  }

  /** Official or published community level, as the engine wants it. */
  async resolve(id: string, viewer?: AuthUser) {
    if (!COMMUNITY.test(id)) return this.get(id);
    const row = await this.db.level.findUnique({ where: { id } });
    const visible = row && ((row.published && !row.hidden) || row.authorId === viewer?.id || viewer?.role === 'admin');
    if (!row || !visible) throw new NotFoundException(`level '${id}' not found`);
    const level = { ...(row.json as object), id } as LevelFile;
    return { level, json: JSON.stringify(level), row };
  }

  async community(viewer?: AuthUser) {
    const rows = await this.db.level.findMany({
      where: viewer
        ? { OR: [{ published: true, hidden: false }, { authorId: viewer.id }, ...(viewer.role === 'admin' ? [{ hidden: true }] : [])] }
        : { published: true, hidden: false },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { displayName: true } } },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      brief: (r.json as { brief?: string }).brief ?? '',
      author: r.author.displayName,
      mine: r.authorId === viewer?.id,
      published: r.published,
      hidden: r.hidden,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Check a level with the engine, like the repo's level tests: the
   * starting design must fail (below 3★) and the reference solution must
   * reach 3★. Returns both ratings.
   */
  async validate(level: LevelFile, solution: unknown) {
    const duration = level.scenario?.durationMs;
    if (!duration || duration < 10_000 || duration > 300_000) throw new BadRequestException('scenario.durationMs: 10–300 s');
    if (!level.title?.trim() || !level.brief?.trim()) throw new BadRequestException('title and brief are required');
    const json = JSON.stringify({ ...level, id: level.id || 'u-draft' });
    try {
      const start = await this.engine.playLevel(json, level.design);
      const best = await this.engine.playLevel(json, solution);
      return { start: start.stars, solution: best.stars, ok: start.stars < 3 && best.stars === 3, startSummary: start, solutionSummary: best };
    } catch (err) {
      if (err instanceof InvalidDesignError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  async create(author: AuthUser, level: LevelFile, solution: unknown, publish: boolean) {
    const check = await this.validate(level, solution);
    if (publish && !check.ok)
      throw new BadRequestException(`design ban đầu phải dưới 3★ (đang ${check.start}★) và lời giải phải đạt 3★ (đang ${check.solution}★)`);
    const mine = await this.db.level.count({ where: { authorId: author.id } });
    if (mine >= 50) throw new BadRequestException('at most 50 levels per user');
    const id = `u-${slugify(level.title)}-${randomBytes(3).toString('hex')}`;
    const { id: _ignored, ...body } = level;
    await this.db.level.create({
      data: {
        id,
        authorId: author.id,
        title: level.title.trim().slice(0, 120),
        json: body as Prisma.InputJsonValue,
        solution: solution as Prisma.InputJsonValue,
        published: publish,
      },
    });
    return { id, check: { start: check.start, solution: check.solution } };
  }

  async update(viewer: AuthUser, id: string, level: LevelFile, solution: unknown, publish: boolean) {
    const row = await this.ownRow(viewer, id);
    const check = await this.validate(level, solution);
    if (publish && !check.ok) throw new BadRequestException(`design ban đầu phải dưới 3★ và lời giải phải đạt 3★ (đang ${check.start}★ / ${check.solution}★)`);
    const { id: _ignored, ...body } = level;
    await this.db.level.update({
      where: { id: row.id },
      data: { title: level.title.trim().slice(0, 120), json: body as Prisma.InputJsonValue, solution: solution as Prisma.InputJsonValue, published: publish },
    });
    // a changed level invalidates its scores
    await this.db.leaderboardEntry.deleteMany({ where: { levelId: id } });
    return { id, check: { start: check.start, solution: check.solution } };
  }

  /** Author's own copy, solution included (for editing). */
  async editable(viewer: AuthUser, id: string) {
    const row = await this.ownRow(viewer, id);
    return { id, level: { ...(row.json as object), id }, solution: row.solution, published: row.published };
  }

  async remove(viewer: AuthUser, id: string) {
    const row = await this.db.level.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('level not found');
    if (row.authorId !== viewer.id && viewer.role !== 'admin') throw new ForbiddenException('not your level');
    await this.db.leaderboardEntry.deleteMany({ where: { levelId: id } });
    await this.db.level.delete({ where: { id } });
  }

  async setHidden(id: string, hidden: boolean) {
    await this.db.level.update({ where: { id }, data: { hidden } }).catch(() => {
      throw new NotFoundException('level not found');
    });
  }

  private async ownRow(viewer: AuthUser, id: string) {
    const row = await this.db.level.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('level not found');
    if (row.authorId !== viewer.id) throw new ForbiddenException('not your level');
    return row;
  }
}
