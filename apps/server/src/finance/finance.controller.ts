import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import { PriceRuleService } from './price-rule.service';
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

  @Get('commission/today')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async commissionToday(@Req() req: any): Promise<any> {
    const data = await this.commissions.getCsCommissionToday(studioIdFor(req));
    return { code: 200, message: 'ok', data };
  }

  @Put('commission/bridge-rule')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async saveCommissionBridgeRule(
    @Req() req: any,
    @Body() body: { bridgeTarget: number },
  ): Promise<any> {
    const data = await this.commissions.saveBridgeRule({ bridgeTarget: body.bridgeTarget }, req.user);
    return { code: 200, message: 'ok', data };
  }

  /** 客服档位：按人存的默认派单范围 + 底薪（老板 2026-09-29）。客服也能读（发单弹窗要用自己的默认值）。 */
  @Get('commission/cs-profiles')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async listCsProfiles(@Req() req: any): Promise<any> {
    const data = await this.commissions.listCsProfiles(studioIdFor(req));
    return { code: 200, message: 'ok', data };
  }

  @Put('commission/cs-profiles')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async saveCsProfile(@Req() req: any, @Body() body: any): Promise<any> {
    const data = await this.commissions.saveCsProfile(studioIdFor(req), body || {});
    return { code: 200, message: 'ok', data };
  }

  /** 今日看板点开某一行：这个客服今天发出的单 + 每张单现在的结果（明细 + 原因排行）。客服只看自己。 */
  @Get('commission/cs-today-orders')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async csTodayOrders(@Req() req: any, @Query('userId') userId?: string): Promise<any> {
    const target = req.user.role === UserRole.CS ? req.user.id : userId;
    const data = await this.commissions.csTodayOrders(studioIdFor(req), target || '');
    return { code: 200, message: 'ok', data };
  }

  /**
   * 「今天我们店接的单」（老板 2026-09-30）：桥接店 / 线上俱乐部自己看 ——
   * 今天别人家的单被我们店陪玩接了多少、成功多少、不成功多少、还有多少没反馈。
   * 老板 / 店长看本店的全部，客服看本店的（这页本来就只有本店范围）。陪玩端没有这个入口。
   */
  @Get('received-today')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async receivedToday(@Req() req: any): Promise<any> {
    const data = await this.commissions.getReceivedToday(studioIdFor(req));
    return { code: 200, message: 'ok', data };
  }

  @Get('commission/:month')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async listCommission(@Req() req: any, @Param('month') month: string, @Query('studioId') studioId?: string) {
    const data = await this.commissions.listLedgers(studioIdFor(req, studioId), month);
    return { code: 200, message: 'ok', data };
  }

  @Get('commission/my-month')
  @Roles(UserRole.CS)
  async myCommission(@Req() req: any, @Query('month') month?: string): Promise<any> {
    const d = new Date();
    const m = month || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const data = await this.commissions.computeCsCommission(studioIdFor(req), m, req.user.id);
    return { code: 200, message: 'ok', data };
  }

  @Get('commission/my-salary')
  @Roles(UserRole.CS)
  async mySalary(@Req() req: any, @Query('month') month?: string): Promise<any> {
    const data = await this.commissions.getCsMySalary(studioIdFor(req), req.user.id, month);
    return { code: 200, message: 'ok', data };
  }

  @Get('commission/live/:month')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async liveCommission(@Req() req: any, @Param('month') month: string, @Query('studioId') studioId?: string): Promise<any> {
    const data = await this.commissions.computeCsCommission(studioIdFor(req, studioId), month);
    return { code: 200, message: 'ok', data };
  }

  @Patch('commission/ledgers/:id/status')
  async updateCommissionLedgerStatus(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    const data = await this.commissions.setLedgerStatus(id, studioIdFor(req, body?.studioId), body?.status);
    return { code: 200, message: 'ok', data };
  }

  @Get('reconciliation')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async reconciliation(@Req() req: any, @Query('day') day: string, @Query('studioId') studioId?: string) {
    const data = await this.reconciliations.getDailyReconciliation(studioIdFor(req, studioId), day);
    return { code: 200, message: 'ok', data };
  }

  @Get('account-reconciliation')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async accountReconciliation(@Req() req: any, @Query('day') day: string, @Query('studioId') studioId?: string) {
    const data = await this.reconciliations.getAccountReconciliation(studioIdFor(req, studioId), day);
    return { code: 200, message: 'ok', data };
  }

  @Get('bridge-online-daily')
  async bridgeOnlineDaily(@Req() req: any, @Query('month') month: string, @Query('studioId') studioId?: string) {
    const data = await this.reconciliations.getBridgeOnlineDaily(studioIdFor(req, studioId), month);
    return { code: 200, message: 'ok', data };
  }

  @Get('profit-daily')
  async profitDaily(@Req() req: any, @Query('month') month: string, @Query('studioId') studioId?: string) {
    const data = await this.reconciliations.getProfitDaily(studioIdFor(req, studioId), month);
    return { code: 200, message: 'ok', data };
  }

  /** 店长端「陪玩收益对比」：派给这个陪玩 vs 派到桥接/线上做首单不结，哪个挣得多。 */
  @Get('companion-compare')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async companionCompare(
    @Req() req: any,
    @Query('month') month: string,
    @Query('studioId') studioId?: string,
  ) {
    const m = month || new Date().toISOString().slice(0, 7);
    const data = await this.reconciliations.getCompanionValueCompare(studioIdFor(req, studioId), m);
    return { code: 200, message: 'ok', data };
  }

  @Get('bridge-returns')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async listBridgeReturns(@Req() req: any, @Query('month') month: string, @Query('studioId') studioId?: string) {
    const data = await this.reconciliations.listBridgeReturns(studioIdFor(req, studioId), month);
    return { code: 200, message: 'ok', data };
  }

  @Post('bridge-returns')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async createBridgeReturn(
    @Req() req: any,
    @Body() body: { amount: number; date?: string; note?: string },
  ) {
    const data = await this.reconciliations.createBridgeReturn(studioIdFor(req), body);
    return { code: 200, message: 'ok', data };
  }

  @Delete('bridge-returns/:id')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async deleteBridgeReturn(@Req() req: any, @Param('id') id: string) {
    await this.reconciliations.deleteBridgeReturn(id, studioIdFor(req));
    return { code: 200, message: 'ok', data: null };
  }

  @Get('expense-items')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getExpenseItems(@Req() req: any) {
    const data = await this.reconciliations.getExpenseItems(studioIdFor(req));
    return { code: 200, message: 'ok', data };
  }

  @Put('expense-items')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async saveExpenseItems(
    @Req() req: any,
    @Body() body: { items: Array<{ id?: string; name?: string; amount?: number }> },
  ) {
    // 老板写全站默认，店长写本店（店跟店相互独立）
    const data = await this.reconciliations.saveExpenseItems(body?.items || [], req.user);
    return { code: 200, message: 'ok', data };
  }

  @Get('risk-queue')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async riskQueue(@Req() req: any, @Query('studioId') studioId?: string) {
    const data = await this.analytics.getRiskQueue(studioIdFor(req, studioId));
    return { code: 200, message: 'ok', data };
  }
}
