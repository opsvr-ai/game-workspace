import { Module } from '@nestjs/common';
import { CustomerTrackingService } from './customer-tracking.service';
import { CustomerTrackingController } from './customer-tracking.controller';

@Module({
  controllers: [CustomerTrackingController],
  providers: [CustomerTrackingService],
  exports: [CustomerTrackingService],
})
export class CustomerTrackingModule {}
