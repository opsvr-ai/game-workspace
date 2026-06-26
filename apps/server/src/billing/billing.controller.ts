import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  Req,
  Res,
  Headers,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { BillingService } from './billing.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly jwtService: JwtService,
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

  // ── Revenue ──

  @Get('revenue/daily')
  async getDailyRevenue(
    @Req() req: any,
    @Query('date') date?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.getDailyRevenue(
      req.user.studioId,
      date,
    );
    return { code: 200, message: 'ok', data };
  }

  @Get('revenue/monthly')
  async getMonthlyRevenue(
    @Req() req: any,
    @Query('month') month?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billingService.getMonthlyRevenue(
      req.user.studioId,
      month,
    );
    return { code: 200, message: 'ok', data };
  }

  @Get('revenue/daily/csv')
  async getDailyRevenueCSV(
    @Req() req: any,
    @Res() res: any,
    @Query('date') date?: string,
  ) {
    const data = await this.billingService.getDailyRevenue(
      req.user.studioId,
      date,
    );

    const BOM = '﻿';
    const dateLabel = data.date;
    const rows: string[][] = [
      ['日期', '类型', '单数', '金额'],
    ];

    const orderTypeLabels: Record<string, string> = {
      NEW: '新单',
      RENEW: '续费',
      REPURCHASE: '复购',
      TIP: '打赏',
    };

    for (const type of ['NEW', 'RENEW', 'REPURCHASE', 'TIP']) {
      const item = data.breakdown[type];
      if (item) {
        rows.push([
          dateLabel,
          orderTypeLabels[type] ?? type,
          String(item.count),
          item.amount.toFixed(2),
        ]);
      }
    }

    rows.push([dateLabel, '合计', '', data.totalAmount.toFixed(2)]);

    const csv = BOM + rows.map((r) => r.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="revenue-daily-${dateLabel}.csv"`,
    );
    res.send(csv);
  }

  @Get('revenue/monthly/csv')
  async getMonthlyRevenueCSV(
    @Req() req: any,
    @Res() res: any,
    @Query('month') month?: string,
  ) {
    const data = await this.billingService.getMonthlyRevenue(
      req.user.studioId,
      month,
    );

    const BOM = '﻿';
    const monthLabel = data.month;
    const rows: string[][] = [
      ['排名', '陪玩', '收入', '占比'],
    ];

    const total = data.totalAmount;

    data.companionRevenue.forEach((c, i) => {
      const pct = total > 0 ? ((c.amount / total) * 100).toFixed(1) : '0.0';
      rows.push([
        String(i + 1),
        c.name,
        c.amount.toFixed(2),
        `${pct}%`,
      ]);
    });

    rows.push(['', '合计', total.toFixed(2), '']);

    const csv = BOM + rows.map((r) => r.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="revenue-monthly-${monthLabel}.csv"`,
    );
    res.send(csv);
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
}
