import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { EngineService, InvalidDesignError } from '../engine/engine.service';
import { LeaderboardService } from './leaderboard.service';
import { LevelsService } from './levels.service';

interface SubmitBody {
  player?: unknown;
  design?: { nodes?: unknown; edges?: unknown };
}

@Controller('levels')
export class LevelsController {
  constructor(
    private readonly levels: LevelsService,
    private readonly engine: EngineService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  @Get()
  list() {
    return this.levels.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.levels.get(id).level;
  }

  /**
   * The client only sends its design. The scenario, catalog and rules come
   * from the level file on the server, and the engine re-runs the whole
   * simulation, so a tampered client cannot fake a score.
   */
  @Post(':id/submit')
  submit(@Param('id') id: string, @Body() body: SubmitBody) {
    const { json } = this.levels.get(id);
    const player = typeof body.player === 'string' ? body.player.trim() : '';
    if (!/^[\p{L}\p{N} _.-]{1,24}$/u.test(player)) {
      throw new BadRequestException('player: 1-24 letters, digits, space, _ . -');
    }
    const design = body.design;
    if (!design || !Array.isArray(design.nodes) || !Array.isArray(design.edges)) {
      throw new BadRequestException('design: { nodes: [], edges: [] } required');
    }
    try {
      const summary = this.engine.playLevel(json, design);
      const result = this.leaderboard.submit(id, player, summary, design);
      return { summary, ...result };
    } catch (err) {
      if (err instanceof InvalidDesignError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  @Get(':id/leaderboard')
  board(@Param('id') id: string) {
    this.levels.get(id);
    return this.leaderboard.top(id).map(({ design: _design, ...rest }) => rest);
  }
}
