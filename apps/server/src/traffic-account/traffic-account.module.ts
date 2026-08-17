import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TrafficAccountController } from './traffic-account.controller';
import { TrafficAccountService } from './traffic-account.service';

@Module({
  imports: [PrismaModule],
  controllers: [TrafficAccountController],
  providers: [TrafficAccountService],
})
export class TrafficAccountModule {}
