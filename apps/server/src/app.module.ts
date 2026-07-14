import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { StudiosModule } from './studios/studios.module';
import { CompanionsModule } from './companions/companions.module';
import { CustomersModule } from './customers/customers.module';
import { OrdersModule } from './orders/orders.module';
import { BillingModule } from './billing/billing.module';
import { HealthModule } from './health/health.module';
import { WsModule } from './ws/ws.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AiModule } from './ai/ai.module';
import { ProcessBlacklistModule } from './process-blacklist/process-blacklist.module';
import { AgentModule } from './agent/agent.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    StudiosModule,
    CompanionsModule,
    CustomersModule,
    OrdersModule,
    BillingModule,
    HealthModule,
    WsModule,
    DashboardModule,
    AiModule,
    AgentModule,
    ProcessBlacklistModule,
  ],
})
export class AppModule {}
