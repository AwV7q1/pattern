import { Module } from '@nestjs/common';
import { EngineService } from './engine/engine.service';
import { LeaderboardService } from './levels/leaderboard.service';
import { LevelsController } from './levels/levels.controller';
import { LevelsService } from './levels/levels.service';
import { SharesController } from './shares/shares.controller';
import { SharesService } from './shares/shares.service';

@Module({
  controllers: [LevelsController, SharesController],
  providers: [EngineService, LevelsService, LeaderboardService, SharesService],
})
export class AppModule {}
