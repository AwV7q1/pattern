import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { CurrentUser, Public } from '../auth/decorators';
import type { AuthUser } from '../common/types';
import { ProjectDto, ShareDto, VersionDto } from './dto';
import { ProjectsService, toWire } from './projects.service';

@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @SkipThrottle()
  @Get('projects')
  changes(@CurrentUser() user: AuthUser, @Query('since') since?: string) {
    const t = since ? new Date(since) : undefined;
    if (t && Number.isNaN(t.getTime())) throw new BadRequestException('since: ISO date');
    return this.projects.changes(user.id, t);
  }

  @Get('projects/:id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return toWire(await this.projects.get(user.id, id));
  }

  @SkipThrottle()
  @Put('projects/:id')
  async put(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProjectDto) {
    return toWire(await this.projects.put(user.id, id, dto));
  }

  @HttpCode(204)
  @Delete('projects/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.remove(user.id, id);
  }

  @Get('projects/:id/versions')
  versions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.versions(user.id, id);
  }

  @SkipThrottle()
  @HttpCode(204)
  @Put('projects/:id/versions')
  putVersion(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VersionDto) {
    return this.projects.putVersion(user.id, id, dto);
  }

  @Post('projects/:id/shares')
  share(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShareDto) {
    return this.projects.share(user.id, id, dto.mode);
  }

  @Get('projects/:id/shares')
  shares(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.shares(user.id, id);
  }

  @HttpCode(204)
  @Delete('shares/:slug')
  revoke(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.projects.revoke(user.id, slug);
  }

  @Public()
  @Get('share/:slug')
  open(@Param('slug') slug: string) {
    return this.projects.open(slug);
  }
}
