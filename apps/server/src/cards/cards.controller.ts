import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, Public } from '../auth/decorators';
import type { AuthUser } from '../common/types';
import { CardsService } from './cards.service';

class DailyDto {
  @IsInt()
  @Min(0)
  @Max(100)
  climbed!: number;

  @IsBoolean()
  won!: boolean;

  /** Error Budget left: the run's max grows with elites and relics, never this far. */
  @IsInt()
  @Min(0)
  @Max(500)
  hp!: number;

  @IsString()
  @Matches(/^[a-z_]+$/)
  @MaxLength(40)
  chassis!: string;

  @IsOptional()
  @IsObject()
  summary?: Record<string, unknown>;
}

/**
 * The card game's daily challenge: everyone gets the same seed and chassis
 * for a UTC day. Runs are played in the browser; the server keeps each
 * user's best and recomputes the score from what the run reports (the run
 * itself is not replayed yet, so entries are trusted, as the board says).
 */
@Controller('cards/daily')
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':date')
  submit(@Param('date') date: string, @Body() dto: DailyDto, @CurrentUser() user: AuthUser) {
    return this.cards.submit(date, user.id, { climbed: dto.climbed, won: dto.won, hp: dto.hp, chassis: dto.chassis, summary: dto.summary ?? {} });
  }

  @Public()
  @Get(':date/leaderboard')
  board(@Param('date') date: string) {
    return this.cards.top(date);
  }
}
