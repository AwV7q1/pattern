import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env';
import { AppConfigModule } from './config/config';
import { PrismaModule } from './prisma/prisma.service';
import { AuthModule } from './auth/auth.module';
import { AuthGuard, CsrfGuard } from './auth/guards';
import { UserThrottlerGuard } from './common/throttler.guard';
import { CardsController } from './cards/cards.controller';
import { CardsService } from './cards/cards.service';
import { EngineService } from './engine/engine.service';
import { HealthController } from './health/health.controller';
import { LeaderboardService } from './levels/leaderboard.service';
import { LevelsController } from './levels/levels.controller';
import { LevelsService } from './levels/levels.service';
import { ProjectsController } from './projects/projects.controller';
import { InterviewsController } from './interviews/interviews.controller';
import { InterviewsService } from './interviews/interviews.service';
import { ProjectsService } from './projects/projects.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env'] }),
    // generous default; auth and simulation routes set tighter limits
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    AppConfigModule,
    PrismaModule,
    AuthModule,
  ],
  controllers: [HealthController, LevelsController, ProjectsController, InterviewsController, CardsController],
  providers: [
    EngineService,
    LevelsService,
    LeaderboardService,
    ProjectsService,
    InterviewsService,
    CardsService,
    // order matters: CSRF, then who is calling, then rate limits per user
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
  ],
})
export class AppModule {}
