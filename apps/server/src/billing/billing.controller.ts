// craftsman-ignore: TS001
import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  Req,
  Headers,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { BillingService } from './billing.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { WsGateway } from '../ws/ws.gateway';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly jwtService: JwtService,
    private readonly wsGateway: WsGateway,
  ) {}

  // ── Transactions ──

  @Post('transactions')
  @Roles(UserRole.COMPANION)
  async createTransaction(
    @Body() dto: CreateTransactionDto,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.createTransaction({
      ...dto,
      companionId: req.user.companionId,
    });
    return { code: 201, message: '报账提交成功', data };
  }

  @Get('transactions')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION, UserRole.CS)
  async findAll(
    @Req() req: any,
    @Query('status') status?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.findAll(req.user, status);
    return { code: 200, message: 'ok', data };
  }

  @Put('transactions/:id/approve')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async approve(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.approve(id, req.user.id, req.user.studioId, req.user.role);
    return { code: 200, message: '审核通过', data };
  }

  @Put('transactions/:id/reject')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async reject(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.reject(id, req.user.id, req.user.studioId, req.user.role);
    return { code: 200, message: '已拒绝', data };
  }

  @Put('transactions/:id/propose')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async proposeAmount(
    @Param('id') id: string,
    @Body() dto: { amount: number; note?: string },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.proposeTransactionAmount(
      id,
      req.user.id,
      req.user.studioId,
      req.user.role,
      dto.amount,
      dto.note,
    );
    return { code: 200, message: '已发起金额协商', data };
  }

  @Put('transactions/:id/accept-proposal')
  @Roles(UserRole.COMPANION)
  async acceptProposal(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.acceptTransactionProposal(id, req.user.companionId);
    return { code: 200, message: '已确认调整金额', data };
  }

  @Put('transactions/:id/reject-proposal')
  @Roles(UserRole.COMPANION)
  async rejectProposal(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.rejectTransactionProposal(id, req.user.companionId);
    return { code: 200, message: '已拒绝调整金额', data };
  }
  @Put('transactions/batch')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async batchUpdate(
    @Body() dto: { ids: string[]; action: 'approve' | 'reject' },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const { ids, action } = dto;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return { code: 400, message: '请选择至少一条记录', data: null };
    }

    if (action !== 'approve' && action !== 'reject') {
      return { code: 400, message: 'action 必须为 approve 或 reject', data: null };
    }

    const result =
      action === 'approve'
        ? await this.billingService.batchApprove(ids, req.user.id, req.user.studioId, req.user.role)
        : await this.billingService.batchReject(ids, req.user.id, req.user.studioId, req.user.role);

    const actionLabel = action === 'approve' ? '批量审核通过' : '批量拒绝';
    return {
      code: 200,
      message: `${actionLabel}完成：成功 ${result.succeeded} 条，失败 ${result.failed} 条`,
      data: result,
    };
  }

  @Get('revenue/stats')
  @Roles(UserRole.OWNER)
  getProfitLoss(
    @Req() req: any,
    @Headers('x-second-token') secondToken: string,
  ): Promise<ApiResponse<unknown>> {
    try {
      const payload = this.jwtService.verify<{ sub: string; secondVerified: boolean }>(secondToken);
      if (!payload.secondVerified || payload.sub !== req.user.id) {
        throw new UnauthorizedException('二级密码验证无效');
      }
    } catch (err: any) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('二级密码验证已过期');
    }
    return this.billingService
      .getProfitLoss(req.user.studioId)
      .then((data) => ({ code: 200, message: 'ok', data }));
  }

  // ── Expenses ──

  @Post('expenses')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async createExpense(
    @Req() req: any,
    @Body() dto: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.createExpense(
      req.user.studioId,
      dto,
    );
    return { code: 201, message: '支出记录已创建', data };
  }

  @Get('expenses')
  async getExpenses(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.getExpenses(req.user.studioId);
    return { code: 200, message: 'ok', data };
  }

  @Get('billing/pending-count')
  async pendingCount(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.getPendingCount(req.user.studioId, req.user.role);
    return { code: 200, message: 'ok', data };
  }

  // ── Expense Reports ──

  @Post('expense-reports')
  @Roles(UserRole.COMPANION)
  async createExpenseReport(
    @Req() req: any,
    @Body() dto: { type: string; amount: number; screenshotUrl?: string; description?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.createExpenseReport({
      ...dto,
      companionId: req.user.companionId,
      studioId: req.user.studioId,
    });
    return { code: 201, message: '报账提交成功', data };
  }

  @Get('expense-reports')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS, UserRole.COMPANION)
  async findExpenseReports(
    @Req() req: any,
    @Query('status') status?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = req.user.role === 'COMPANION'
      ? await this.billingService.findCompanionExpenseReports(req.user.companionId)
      : await this.billingService.findExpenseReports(req.user.studioId, status);
    return { code: 200, message: 'ok', data };
  }

  @Put('expense-reports/:id/review')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async reviewExpenseReport(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: { status: string; note?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.reviewExpenseReport(
      id, dto.status, req.user.id, dto.note,
    );
    return { code: 200, message: '审核完成', data };
  }

  @Get('expense-reports/monthly-summary')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getMonthlySummary(
    @Req() req: any,
    @Query('month') month?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.getExpenseMonthlySummary(
      req.user.studioId, month,
    );
    return { code: 200, message: 'ok', data };
  }

  // ── Wallet Transactions ──

  @Get('wallet-transactions')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getWalletTransactions(
    @Req() req: any,
    @Query('status') status?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.getWalletTransactions(
      req.user.studioId, status,
    );
    return { code: 200, message: 'ok', data };
  }

  @Put('wallet-transactions/:id/review')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async reviewWalletTransaction(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: { status: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.reviewWalletTransaction(
      id, dto.status, req.user.id,
    );
    this.wsGateway.broadcastToStudio(req.user.studioId, 'billing:updated', {});
    return { code: 200, message: '审核完成', data };
  }

  // ── Unified Billing Overview ──

  @Post('billing/report-today')
  @Roles(UserRole.COMPANION)
  async reportToday(@Req() req: any, @Body() dto: { screenshots: Record<string,string> }): Promise<ApiResponse<unknown>> {
    await this.billingService.createExpenseReport({
      companionId: req.user.companionId,
      studioId: req.user.studioId,
      type: 'TODAY_REVENUE',
      amount: 0,
      description: JSON.stringify(dto.screenshots),
    });
    return { code: 201, message: '已提交审核', data: null };
  }

  @Post('billing/report-today-v2')
  @Roles(UserRole.COMPANION)
  async reportTodayV2(@Req() req: any, @Body() dto: { items: Array<{ orderId: string; sessionId?: string; gameName: string; amount: number; screenshotUrl?: string; customerWechat: string; claimedMode?: string; claimedPrice?: number; duration?: number; coName?: string; remark?: string }>; totalScreenshotUrl?: string }): Promise<ApiResponse<unknown>> {
    const totalAmount = dto.items.reduce((s, i) => s + (i.amount || 0), 0);
    const screenshots: Record<string, string> = {};
    dto.items.forEach(i => { if (i.screenshotUrl) screenshots[i.orderId] = i.screenshotUrl; });
    await this.billingService.createExpenseReport({
      companionId: req.user.companionId,
      studioId: req.user.studioId,
      type: 'TODAY_REVENUE',
      amount: totalAmount,
      screenshotUrl: dto.totalScreenshotUrl || undefined,
      description: JSON.stringify({ screenshots, totalScreenshotUrl: dto.totalScreenshotUrl, items: dto.items }),
    });

    // Compare with system-calculated order amounts for today
    if (req.user.studioId && req.user.companionId) {
      this.billingService.checkRevenueDiff(req.user.companionId, req.user.studioId, totalAmount);
    }

    return { code: 201, message: `已提交，共 ¥${totalAmount}`, data: null };
  }

  @Get('billing/overview')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS, UserRole.COMPANION)
  async getOverview(
    @Req() req: any,
    @Query('companionId') companionId?: string,
    @Query('month') month?: string,
  ): Promise<ApiResponse<unknown>> {
    const studioId = req.user.studioId;
    const effectiveCompanionId = req.user.role === 'COMPANION' ? req.user.companionId : companionId;
    const data = await this.billingService.getOverview(studioId, effectiveCompanionId, month);
    return { code: 200, message: 'ok', data };
  }

  // ── 下班转公户（当日实际流水的最终口径）──

  @Post('billing/company-transfer')
  @Roles(UserRole.COMPANION)
  async submitCompanyTransfer(
    @Req() req: any,
    @Body() body: { amount: number; screenshotUrl: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.submitCompanyTransfer(
      req.user.companionId,
      req.user.studioId,
      body?.amount,
      body?.screenshotUrl,
    );
    return { code: 201, message: '转公户已提交，以该金额作为今日实际流水', data };
  }

  @Get('billing/daily-reconciliation')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS, UserRole.COMPANION)
  async getDailyReconciliation(
    @Req() req: any,
    @Query('companionId') companionId?: string,
  ): Promise<ApiResponse<unknown>> {
    const effectiveCompanionId =
      req.user.role === 'COMPANION' ? req.user.companionId : companionId;
    if (!effectiveCompanionId) return { code: 400, message: '请指定陪玩', data: null };
    const data = await this.billingService.getCompanionDailyReconciliation(
      effectiveCompanionId,
    );
    return { code: 200, message: 'ok', data };
  }

  // ── Monthly Settlement ──

  @Post('monthly-settlement')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async runMonthlySettlement(
    @Req() req: any,
    @Body() dto: { month: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.runMonthlySettlement(
      req.user.studioId,
      dto.month,
    );
    return { code: 200, message: '月底结算完成', data };
  }

  @Get('monthly-settlement')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getMonthlySettlement(
    @Req() req: any,
    @Query('month') month?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.getMonthlySettlement(
      req.user.studioId,
      month,
    );
    return { code: 200, message: 'ok', data };
  }
}
