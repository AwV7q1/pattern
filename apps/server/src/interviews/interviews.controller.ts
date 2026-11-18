import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsNumber, IsObject, Min } from 'class-validator';
import type { LintDesign } from '@pattern/design-lint';
import { CurrentUser, Public } from '../auth/decorators';
import type { AuthUser } from '../common/types';
import { assertDesign } from '../levels/levels.controller';
import { InterviewsService } from './interviews.service';

class AttemptDto {
  @IsObject()
  design!: LintDesign;

  @IsNumber()
  @Min(0)
  durationMs!: number;
}

@Controller('interviews')
export class InterviewsController {
  constructor(private readonly interviews: InterviewsService) {}

  @Public()
  @Get()
  list() {
    return this.interviews.list();
  }

  @Get('attempts/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.interviews.mine(user.id);
  }

  @Get('attempts/:id')
  attempt(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.interviews.attempt(user.id, id);
  }

  @Public()
  @Get(':id')
  get(@Param('id') id: string) {
    const { reference: _r, ...prompt } = this.interviews.get(id);
    return prompt;
  }

  @Get(':id/reference')
  reference(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.interviews.reference(user.id, id);
  }

  /** Grade and store an attempt; the score is computed here, never taken from the client. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/attempts')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AttemptDto) {
    assertDesign(dto.design as { nodes?: unknown; edges?: unknown });
    return this.interviews.submit(user.id, id, dto.design, dto.durationMs);
  }
}
