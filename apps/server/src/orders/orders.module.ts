import { Module } from '@nestjs/common';
import { WsModule } from '../ws/ws.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderWorkflowService } from './order-workflow.service';
import { OrderDispatchService } from './order-dispatch.service';

@Module({
  imports: [WsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderWorkflowService, OrderDispatchService],
  exports: [OrdersService],
})
export class OrdersModule {}
