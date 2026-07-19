import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MulterModule } from '@nestjs/platform-express';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { UploadController } from './upload.controller';
import { TransactionService } from './transaction.service';
import { SettlementService } from './settlement.service';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? (() => { throw new Error('FATAL: JWT_SECRET environment variable is not set'); })(),
      signOptions: { expiresIn: '15m' },
    }),
    MulterModule.register({
      dest: './uploads/screenshots',
    }),
    WsModule,
  ],
  controllers: [BillingController, UploadController],
  providers: [BillingService, TransactionService, SettlementService],
  exports: [BillingService],
})
export class BillingModule {}
