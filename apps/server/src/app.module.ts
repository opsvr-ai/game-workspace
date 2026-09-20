import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/app-throttler.guard';
import { APP_GUARD } from '@nestjs/core';
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
import { StatsModule } from './stats/stats.module';
import { FinanceModule } from './finance/finance.module';
import { ChatModule } from './chat/chat.module';
import { CustomerTrackingModule } from './customer-tracking/customer-tracking.module';
import { ManagedPcModule } from './managed-pc/managed-pc.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { PayrollModule } from './payroll/payroll.module';
import { ProfitSplitModule } from './profit-split/profit-split.module';
import { TrafficAccountModule } from './traffic-account/traffic-account.module';
import { BattleScreenshotsModule } from './battle-screenshots/battle-screenshots.module';
import { RedisModule } from './redis/redis.module';
import { LoggerMiddleware } from './common/logger.middleware';
import { ContentCheckModule } from './content-check/content-check.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // 限流配额：2026-09-21 起按「账号 / 用户」记账，不再按公网 IP（见 common/app-throttler.guard.ts）。
    // 每个身份、每个接口各自一份配额：短时的防脚本猛刷，长时的防失控轮询。
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 15,
      },
      {
        name: 'medium',
        ttl: 10000,
        limit: 80,
      },
      {
        name: 'long',
        ttl: 60000,
        limit: 600,
      },
    ]),
    PrismaModule,
    RedisModule,
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
    ChatModule,
    StatsModule,
    FinanceModule,
    CustomerTrackingModule,
    ManagedPcModule,
    AnalyticsModule,
    PayrollModule,
    ProfitSplitModule,
    TrafficAccountModule,
    BattleScreenshotsModule,
    ContentCheckModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
