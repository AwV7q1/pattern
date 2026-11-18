import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EngineService, InvalidDesignError } from '../engine/engine.service';
import { CurrentUser, Public } from '../auth/decorators';
import type { AuthUser } from '../common/types';
import { LeaderboardService } from './leaderboard.service';
import { LevelsService } from './levels.service';

interface SubmitBody {
  design?: { nodes?: unknown; edges?: unknown };
}

export function assertDesign(design: SubmitBody['design']): asserts design is { nodes: unknown[]; edges: unknown[] } {
  if (!design || !Array.isArray(design.nodes) || !Array.isArray(design.edges)) {
    throw new BadRequestException('design: { nodes: [], edges: [] } required');
  }
}

@Controller('levels')
export class LevelsController {
  constructor(
    private readonly levels: LevelsService,
    private readonly engine: EngineService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  @Public()
  @Get()
  list() {
    return this.levels.list();
  }

  @Public()
  @Get(':id')
  get(@Param('id') id: string) {
    return this.levels.get(id).level;
  }

  /**
   * The client only sends its design. The scenario, catalog and rules come
   * from the level file on the server, and the engine re-runs the whole
   * simulation, so a tampered client cannot fake a score. The name on the
   * board is the signed-in user's.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/submit')
  async submit(@Param('id') id: string, @Body() body: SubmitBody, @CurrentUser() user: AuthUser) {
    const { json } = this.levels.get(id);
    assertDesign(body.design);
    try {
      const summary = await this.engine.playLevel(json, body.design);
      const result = await this.leaderboard.submit(id, user.id, summary, body.design);
      return { summary, ...result };
    } catch (err) {
      if (err instanceof InvalidDesignError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  @Public()
  @Get(':id/leaderboard')
  board(@Param('id') id: string) {
    this.levels.get(id);
    return this.leaderboard.top(id);
  }
}
