import { Module } from '@nestjs/common';
import { CustomerTrackingService } from './customer-tracking.service';
import { CustomerTrackingController } from './customer-tracking.controller';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [CustomerTrackingController],
  providers: [CustomerTrackingService],
  exports: [CustomerTrackingService],
})
export class CustomerTrackingModule {}
