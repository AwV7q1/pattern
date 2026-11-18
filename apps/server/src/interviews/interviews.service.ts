import { BadRequestException, ForbiddenException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import { hotNodes, interviewLevels, lint, scoreInterview, type InterviewPrompt, type InterviewRun, type LintDesign } from '@pattern/design-lint';
import { PrismaService } from '../prisma/prisma.service';
import { EngineService, ServiceUnavailableError } from '../engine/engine.service';

const FAILED = { sloPass: false, sloWindowRatio: 0, p99Ms: 0, errorRate: 1, costPerHour: 0, backlog: 0 };

/** Interview prompts live in the repo's `interviews/` folder, shared with the web app. */
@Injectable()
export class InterviewsService implements OnModuleInit {
  private prompts = new Map<string, InterviewPrompt>();
  readonly dir = process.env.INTERVIEWS_DIR ?? resolve(__dirname, '../../../../interviews');

  constructor(
    private readonly db: PrismaService,
    private readonly engine: EngineService,
  ) {}

  onModuleInit() {
    for (const file of readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort()) {
      const p = JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as InterviewPrompt;
      this.prompts.set(p.id, p);
    }
  }

  /** Public view: everything but the reference answer. */
  list() {
    return [...this.prompts.values()].map(({ reference: _r, ...p }) => p);
  }

  get(id: string) {
    const p = this.prompts.get(id);
    if (!p) throw new NotFoundException(`interview '${id}' not found`);
    return p;
  }

  /**
   * Same grading as the browser (shared package + same engine): each
   * grading scenario is played, then lint and the rubric give the score.
   */
  async grade(prompt: InterviewPrompt, design: LintDesign) {
    let sanitized: LintDesign | null = null;
    const runs: (InterviewRun & { error?: string })[] = [];
    for (const r of interviewLevels(prompt, design)) {
      try {
        const out = await this.engine.levelRun(r.level, r.design);
        sanitized ??= out.input.design as LintDesign;
        runs.push({ name: r.name, kind: r.kind, summary: out.summary, hot: hotNodes(out.input.design as LintDesign, out.windows) });
      } catch (err) {
        if (err instanceof ServiceUnavailableError) throw err;
        runs.push({ name: r.name, kind: r.kind, summary: FAILED, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const findings = lint(sanitized ?? design, prompt.level.scenario);
    const score = scoreInterview({ runs, findings, budgetPerHour: prompt.level.scenario.budgetPerHour ?? null, rubric: prompt.rubric });
    return { runs, findings, score };
  }

  async submit(userId: string, promptId: string, design: LintDesign, durationMs: number) {
    const prompt = this.get(promptId);
    if (!design.nodes?.length) throw new BadRequestException('design is empty');
    const graded = await this.grade(prompt, design);
    const row = await this.db.interviewAttempt.create({
      data: {
        userId,
        promptId,
        design: design as unknown as Prisma.InputJsonValue,
        score: graded as unknown as Prisma.InputJsonValue,
        total: graded.score.total,
        durationMs: Math.max(0, Math.round(durationMs)),
      },
    });
    return { id: row.id, createdAt: row.createdAt, ...graded };
  }

  async mine(userId: string) {
    return this.db.interviewAttempt.findMany({
      where: { userId },
      select: { id: true, promptId: true, total: true, durationMs: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async attempt(userId: string, id: string) {
    const row = await this.db.interviewAttempt.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('attempt not found');
    return { id: row.id, promptId: row.promptId, design: row.design, durationMs: row.durationMs, createdAt: row.createdAt, ...(row.score as object) };
  }

  /** The reference answer, once the user has handed in an attempt for this prompt. */
  async reference(userId: string, promptId: string) {
    const prompt = this.get(promptId);
    const tried = await this.db.interviewAttempt.count({ where: { userId, promptId } });
    if (!tried) throw new ForbiddenException('nộp bài trước khi xem lời giải tham khảo');
    return { design: prompt.reference, talkingPoints: prompt.talkingPoints ?? [] };
  }
}
