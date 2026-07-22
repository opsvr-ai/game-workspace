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
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async findAll(
    @Req() req: any,
    @Query('status') status?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.findAll(req.user, status);
    return { code: 200, message: 'ok', data };
  }

  @Put('transactions/:id/approve')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async approve(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.approve(id, req.user.id);
    return { code: 200, message: '审核通过', data };
  }

  @Put('transactions/:id/reject')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async reject(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.reject(id, req.user.id);
    return { code: 200, message: '已拒绝', data };
  }

  @Put('transactions/batch')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
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
        ? await this.billingService.batchApprove(ids, req.user.id)
        : await this.billingService.batchReject(ids, req.user.id);

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
      this.jwtService.verify(secondToken);
    } catch {
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
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
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
