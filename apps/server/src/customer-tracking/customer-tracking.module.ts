import { Module } from '@nestjs/common';
import { CustomerTrackingService } from './customer-tracking.service';
import { CustomerTrackingController } from './customer-tracking.controller';
import { OrdersModule } from '../orders/orders.module';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [OrdersModule, WsModule],
  controllers: [CustomerTrackingController],
  providers: [CustomerTrackingService],
  exports: [CustomerTrackingService],
})
export class CustomerTrackingModule {}
