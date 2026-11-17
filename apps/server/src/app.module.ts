import { Module } from '@nestjs/common';
import { EngineService } from './engine/engine.service';
import { LeaderboardService } from './levels/leaderboard.service';
import { LevelsController } from './levels/levels.controller';
import { LevelsService } from './levels/levels.service';

@Module({
  controllers: [LevelsController],
  providers: [EngineService, LevelsService, LeaderboardService],
})
export class AppModule {}
