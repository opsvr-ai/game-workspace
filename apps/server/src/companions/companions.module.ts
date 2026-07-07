import { Module, forwardRef } from '@nestjs/common';
import { WsModule } from '../ws/ws.module';
import { PrismaService } from '../prisma/prisma.service';
import { CompanionsService } from './companions.service';
import { CompanionsController } from './companions.controller';
import { RestingMonitorService } from './resting-monitor.service';

@Module({
  imports: [forwardRef(() => WsModule)],
  controllers: [CompanionsController],
  providers: [CompanionsService, PrismaService, RestingMonitorService],
  exports: [CompanionsService],
})
export class CompanionsModule {}
