import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WsModule } from '../ws/ws.module';
import { ManagedPcController } from './managed-pc.controller';
import { ManagedPcService } from './managed-pc.service';

@Module({
  imports: [PrismaModule, WsModule],
  controllers: [ManagedPcController],
  providers: [ManagedPcService],
})
export class ManagedPcModule {}
