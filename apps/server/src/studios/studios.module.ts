import { Module, forwardRef } from '@nestjs/common';
import { StudiosService } from './studios.service';
import { StudiosController } from './studios.controller';
import { BridgeService } from './bridge.service';
import { BridgeController } from './bridge.controller';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [forwardRef(() => WsModule)],
  controllers: [StudiosController, BridgeController],
  providers: [StudiosService, BridgeService],
  exports: [StudiosService, BridgeService],
})
export class StudiosModule {}
