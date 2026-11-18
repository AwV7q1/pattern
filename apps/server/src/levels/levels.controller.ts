import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';
import { EngineService, InvalidDesignError } from '../engine/engine.service';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import type { AuthUser } from '../common/types';
import { LeaderboardService } from './leaderboard.service';
import { LevelsService, type LevelFile } from './levels.service';

interface SubmitBody {
  design?: { nodes?: unknown; edges?: unknown };
}

class LevelDto {
  @IsObject()
  level!: LevelFile;

  @IsObject()
  solution!: { nodes: unknown[]; edges: unknown[] };

  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

class HideDto {
  @IsBoolean()
  hidden!: boolean;
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

  /** Community levels: published ones, plus the viewer's drafts (admins also see hidden ones). */
  @Public()
  @Get('community')
  community(@CurrentUser() user?: AuthUser) {
    return this.levels.community(user);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('validate')
  async validate(@Body() dto: LevelDto) {
    assertDesign(dto.level.design as SubmitBody['design']);
    assertDesign(dto.solution);
    const r = await this.levels.validate(dto.level, dto.solution);
    return { start: r.start, solution: r.solution, ok: r.ok };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: LevelDto) {
    assertDesign(dto.level.design as SubmitBody['design']);
    assertDesign(dto.solution);
    return this.levels.create(user, dto.level, dto.solution, dto.publish ?? true);
  }

  @Get(':id/edit')
  editable(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.levels.editable(user, id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: LevelDto) {
    assertDesign(dto.level.design as SubmitBody['design']);
    assertDesign(dto.solution);
    return this.levels.update(user, id, dto.level, dto.solution, dto.publish ?? true);
  }

  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.levels.remove(user, id);
  }

  @Roles('admin')
  @HttpCode(204)
  @Patch(':id/hidden')
  hide(@Param('id') id: string, @Body() dto: HideDto) {
    return this.levels.setHidden(id, dto.hidden);
  }

  @Public()
  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return (await this.levels.resolve(id, user)).level;
  }

  /**
   * The client only sends its design. The scenario, catalog and rules come
   * from the level on the server, and the engine re-runs the whole
   * simulation, so a tampered client cannot fake a score. The name on the
   * board is the signed-in user's.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/submit')
  async submit(@Param('id') id: string, @Body() body: SubmitBody, @CurrentUser() user: AuthUser) {
    const { json } = await this.levels.resolve(id, user);
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
  async board(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    await this.levels.resolve(id, user);
    return this.leaderboard.top(id);
  }
}
