import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ManagedPcController } from './managed-pc.controller';
import { ManagedPcService } from './managed-pc.service';

@Module({
  imports: [PrismaModule],
  controllers: [ManagedPcController],
  providers: [ManagedPcService],
})
export class ManagedPcModule {}
