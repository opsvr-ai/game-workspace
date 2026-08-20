import { Module } from '@nestjs/common';
import { WsModule } from '../ws/ws.module';
import { StudiosModule } from '../studios/studios.module';
import { CompanionsModule } from '../companions/companions.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderWorkflowService } from './order-workflow.service';
import { OrderDispatchService } from './order-dispatch.service';
import { ScheduledOrderReminderService } from './scheduled-order-reminder.service';
import { ServiceDurationReminderService } from './service-duration-reminder.service';

@Module({
  imports: [WsModule, StudiosModule, CompanionsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderWorkflowService, OrderDispatchService, ScheduledOrderReminderService, ServiceDurationReminderService],
  exports: [OrdersService],
})
export class OrdersModule {}
