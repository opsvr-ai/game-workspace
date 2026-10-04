import { Module } from '@nestjs/common';
import { BattleScreenshotsController } from './battle-screenshots.controller';
import { BattleScreenshotsService } from './battle-screenshots.service';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [WsModule],
  controllers: [BattleScreenshotsController],
  providers: [BattleScreenshotsService],
})
export class BattleScreenshotsModule {}
