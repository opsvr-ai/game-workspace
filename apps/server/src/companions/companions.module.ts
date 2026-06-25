import { Module } from '@nestjs/common';
import { WsModule } from '../ws/ws.module';
import { CompanionsService } from './companions.service';
import { CompanionsController } from './companions.controller';

@Module({
  imports: [WsModule],
  controllers: [CompanionsController],
  providers: [CompanionsService],
  exports: [CompanionsService],
})
export class CompanionsModule {}
