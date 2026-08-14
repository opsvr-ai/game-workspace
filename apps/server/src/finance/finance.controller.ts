import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import { PriceRuleService } from './price-rule.service';
import { SettlementSnapshotService } from './settlement-snapshot.service';
import { CommissionService } from './commission.service';
import { ReconciliationService } from './reconciliation.service';
import { CustomerAnalyticsService } from './customer-analytics.service';

function studioIdFor(req: any, explicit?: string): string {
  if (req.user.role === UserRole.OWNER && explicit) return explicit;
  return req.user.studioId;
}

@Controller('finance')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.ADMIN, UserRole.OWNER)
export class FinanceController {
  constructor(
    private readonly priceRules: PriceRuleService,
    private readonly settlements: SettlementSnapshotService,
    private readonly commissions: CommissionService,
    private readonly reconciliations: ReconciliationService,
    private readonly analytics: CustomerAnalyticsService,
  ) {}

  @Get('price-rules')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async listPriceRules(@Req() req: any, @Query('studioId') studioId?: string) {
    const data = await this.priceRules.list(studioIdFor(req, studioId));
    return { code: 200, message: 'ok', data };
  }

  @Post('price-rules')
  async createPriceRule(@Req() req: any, @Body() body: any) {
    const data = await this.priceRules.create(studioIdFor(req, body.studioId), body);
    return { code: 200, message: 'ok', data };
  }

  @Patch('price-rules/:id')
  async updatePriceRule(@Param('id') id: string, @Body() body: any) {
    const data = await this.priceRules.update(id, body);
    return { code: 200, message: 'ok', data };
  }

  @Get('price-rules/builtin')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async builtinModes() {
    return { code: 200, message: 'ok', data: this.priceRules.builtinModes() };
  }

  @Post('settlement/:month')
  async runSettlement(@Req() req: any, @Param('month') month: string, @Query('studioId') studioId?: string) {
    const data = await this.settlements.runMonthlySettlement(studioIdFor(req, studioId), month);
    return { code: 200, message: 'ok', data };
  }

  @Get('settlement/:month')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async listSettlement(@Req() req: any, @Param('month') month: string, @Query('studioId') studioId?: string) {
    const data = await this.settlements.listMonth(studioIdFor(req, studioId), month);
    return { code: 200, message: 'ok', data };
  }

  @Get('commission/rules')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async listCommissionRules(@Req() req: any, @Query('studioId') studioId?: string) {
    const data = await this.commissions.listRules(studioIdFor(req, studioId));
    return { code: 200, message: 'ok', data };
  }

  @Post('commission/rules')
  async upsertCommissionRule(@Req() req: any, @Body() body: any) {
    const data = await this.commissions.upsertRule(studioIdFor(req, body.studioId), body);
    return { code: 200, message: 'ok', data };
  }

  @Post('commission/calculate/:month')
  async calculateCommission(@Req() req: any, @Param('month') month: string, @Query('studioId') studioId?: string) {
    const data = await this.commissions.calculateMonth(studioIdFor(req, studioId), month);
    return { code: 200, message: 'ok', data };
  }

  @Get('commission/:month')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async listCommission(@Req() req: any, @Param('month') month: string, @Query('studioId') studioId?: string) {
    const data = await this.commissions.listLedgers(studioIdFor(req, studioId), month);
    return { code: 200, message: 'ok', data };
  }

  @Get('reconciliation')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async reconciliation(@Req() req: any, @Query('day') day: string, @Query('studioId') studioId?: string) {
    const data = await this.reconciliations.getDailyReconciliation(studioIdFor(req, studioId), day);
    return { code: 200, message: 'ok', data };
  }

  @Get('risk-queue')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async riskQueue(@Req() req: any, @Query('studioId') studioId?: string) {
    const data = await this.analytics.getRiskQueue(studioIdFor(req, studioId));
    return { code: 200, message: 'ok', data };
  }
}
