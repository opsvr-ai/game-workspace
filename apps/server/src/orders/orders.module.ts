import { Module } from '@nestjs/common';
import { WsModule } from '../ws/ws.module';
import { StudiosModule } from '../studios/studios.module';
import { CompanionsModule } from '../companions/companions.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderWorkflowService } from './order-workflow.service';
import { CompanionQuotaService } from './companion-quota.service';
import { OrderDispatchService } from './order-dispatch.service';
import { ScheduledOrderReminderService } from './scheduled-order-reminder.service';
import { ServiceDurationReminderService } from './service-duration-reminder.service';
import { ContactReminderService } from './contact-reminder.service';
import { StaleSessionSweepService } from './stale-session-sweep.service';
import { OnlineFirstReleaseService } from './online-first-release.service';

@Module({
  imports: [WsModule, StudiosModule, CompanionsModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderWorkflowService,
    OrderDispatchService,
    CompanionQuotaService,
    ScheduledOrderReminderService,
    ServiceDurationReminderService,
    // 老板 2026-10-04：抢单后迟迟没标「添加成功 / 添加失败」的，定期提醒陪玩本人 + 满 3 天提醒管理端。
    ContactReminderService,
    StaleSessionSweepService,
    // 老板 2026-10-01：「线上→线下流转」的单到点自动放给本店线下时，给本店每个陪玩弹一次。
    OnlineFirstReleaseService,
  ],
  exports: [OrdersService, CompanionQuotaService],
})
export class OrdersModule {}
