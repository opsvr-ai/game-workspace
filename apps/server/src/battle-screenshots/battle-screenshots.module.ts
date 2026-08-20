import { Module } from '@nestjs/common';
import { BattleScreenshotsController } from './battle-screenshots.controller';
import { BattleScreenshotsService } from './battle-screenshots.service';

@Module({
  controllers: [BattleScreenshotsController],
  providers: [BattleScreenshotsService],
})
export class BattleScreenshotsModule {}
