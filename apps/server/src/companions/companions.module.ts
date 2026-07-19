import { Module, forwardRef } from '@nestjs/common';
import { WsModule } from '../ws/ws.module';
import { PrismaService } from '../prisma/prisma.service';
import { CompanionsService } from './companions.service';
import { CompanionsController } from './companions.controller';
import { RestingMonitorService } from './resting-monitor.service';
import { CompanionRevenueService } from './companion-revenue.service';
import { CompanionAttendanceService } from './companion-attendance.service';
import { CompanionWechatService } from './companion-wechat.service';

@Module({
  imports: [forwardRef(() => WsModule)],
  controllers: [CompanionsController],
  providers: [
    CompanionsService,
    PrismaService,
    RestingMonitorService,
    CompanionRevenueService,
    CompanionAttendanceService,
    CompanionWechatService,
  ],
  exports: [CompanionsService],
})
export class CompanionsModule {}
