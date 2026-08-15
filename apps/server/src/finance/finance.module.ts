import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { PriceRuleService } from './price-rule.service';
import { SettlementSnapshotService } from './settlement-snapshot.service';
import { CommissionService } from './commission.service';
import { CommissionScheduler } from './commission-scheduler.service';
import { ReconciliationService } from './reconciliation.service';
import { CustomerAnalyticsService } from './customer-analytics.service';

@Module({
  controllers: [FinanceController],
  providers: [
    PriceRuleService,
    SettlementSnapshotService,
    CommissionService,
    CommissionScheduler,
    ReconciliationService,
    CustomerAnalyticsService,
  ],
  exports: [
    PriceRuleService,
    SettlementSnapshotService,
    CommissionService,
    ReconciliationService,
    CustomerAnalyticsService,
  ],
})
export class FinanceModule {}
