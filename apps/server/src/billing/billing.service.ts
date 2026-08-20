// craftsman-ignore: TS001
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { TransactionService } from './transaction.service';
import { SettlementService } from './settlement.service';
import { currentBusinessDayRange, settlementMonthRange } from '../common/business-day';
import { roundToJiao } from '../common/money';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: WsGateway,
    private readonly transactionService: TransactionService,
    private readonly settlementService: SettlementService,
  ) {}

  // ── Transaction management ──

  async createTransaction(dto: {
    orderId: string;
    companionId: string;
    amount: number;
    paymentMethod: string;
    screenshotUrl: string;
    paidAt: string;
  }) {
    return this.transactionService.createTransaction(dto);
  }

  async approve(transactionId: string, reviewerId: string, reviewerStudioId?: string, reviewerRole?: string) {
    return this.transactionService.approve(transactionId, reviewerId, reviewerStudioId, reviewerRole);
  }

  async reject(transactionId: string, reviewerId: string, reviewerStudioId?: string, reviewerRole?: string) {
    return this.transactionService.reject(transactionId, reviewerId, reviewerStudioId, reviewerRole);
  }

  async proposeTransactionAmount(
    transactionId: string,
    reviewerId: string,
    reviewerStudioId: string | undefined,
    reviewerRole: string,
    amount: number,
    note?: string,
  ) {
    return this.transactionService.proposeAmount(transactionId, reviewerId, reviewerStudioId, reviewerRole, amount, note);
  }

  async acceptTransactionProposal(transactionId: string, companionId: string) {
    return this.transactionService.acceptProposal(transactionId, companionId);
  }

  async rejectTransactionProposal(transactionId: string, companionId: string) {
    return this.transactionService.rejectProposal(transactionId, companionId);
  }
  async batchApprove(ids: string[], reviewerId: string, reviewerStudioId?: string, reviewerRole?: string) {
    return this.transactionService.batchApprove(ids, reviewerId, reviewerStudioId, reviewerRole);
  }

  async batchReject(ids: string[], reviewerId: string, reviewerStudioId?: string, reviewerRole?: string) {
    return this.transactionService.batchReject(ids, reviewerId, reviewerStudioId, reviewerRole);
  }

  async findAll(user: any, status?: string) {
    const where: any = {};

    if (status) where.status = status;

    if (user.role === 'COMPANION') {
      where.companionId = user.companionId;
    } else if (user.role === 'ADMIN' || user.role === 'OWNER') {
      // See all within their studio — filter by companion's studioId
      // We'll add this via the companion relation
    }

    const studioFilter =
      ['ADMIN','OWNER','CS'].includes(user.role) && user.studioId
        ? { companion: { studioId: user.studioId } }
        : {};

    return this.prisma.transaction.findMany({
      where: { ...where, ...studioFilter },
      include: {
        order: { select: { id: true, type: true, amount: true, customerId: true } },
        companion: {
          select: {
            id: true,
            user: { select: { username: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Profit & Loss ──

  async getProfitLoss(studioId: string) {
    return this.settlementService.getProfitLoss(studioId);
  }

  // ── Revenue Statistics ──

  async getDailyRevenue(studioId: string, date: string) {
    return this.settlementService.getDailyRevenue(studioId, date);
  }

  async getMonthlyRevenue(studioId: string, month: string) {
    return this.settlementService.getMonthlyRevenue(studioId, month);
  }

  // ── Expense management ──

  async createExpense(
    studioId: string,
    dto: { category: string; amount: number; description?: string; date?: string },
  ) {
    if (!studioId) throw new ForbiddenException('无工作室权限，无法创建支出');
    return this.prisma.expense.create({
      data: {
        studioId,
        category: dto.category,
        amount: dto.amount,
        description: dto.description ?? null,
        date: dto.date ? new Date(dto.date) : new Date(),
      },
    });
  }

  async getExpenses(studioId: string) {
    if (!studioId) return [];
    return this.prisma.expense.findMany({
      where: { studioId },
      orderBy: { date: 'desc' },
    });
  }

  // ── Expense Reports ──

  async createExpenseReport(dto: {
    companionId: string;
    studioId: string;
    type: string;
    amount: number;
    screenshotUrl?: string;
    description?: string;
  }) {
    return this.prisma.expenseReport.create({
      data: {
        companionId: dto.companionId,
        studioId: dto.studioId,
        type: dto.type,
        amount: dto.amount,
        screenshotUrl: dto.screenshotUrl ?? null,
        description: dto.description ?? null,
        status: 'PENDING',
      },
      include: {
        companion: { include: { user: { select: { username: true } } } },
      },
    });
  }

  async findExpenseReports(studioId: string, status?: string) {
    const where: any = { studioId };
    if (status) where.status = status;
    return this.prisma.expenseReport.findMany({
      where,
      include: {
        companion: { include: { user: { select: { username: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findCompanionExpenseReports(companionId: string) {
    return this.prisma.expenseReport.findMany({
      where: { companionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reviewExpenseReport(id: string, status: string, reviewerId: string, note?: string) {
    return this.prisma.expenseReport.update({
      where: { id },
      data: {
        status,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNote: note ?? null,
      },
    });
  }

  async getExpenseMonthlySummary(studioId: string, month?: string) {
    const now = new Date();
    const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const { start, end } = settlementMonthRange(targetMonth);

    const reports = await this.prisma.expenseReport.findMany({
      where: {
        studioId,
        createdAt: { gte: start, lt: end },
      },
    });

    const approved = reports.filter((r) => r.status === 'APPROVED');
    const pending = reports.filter((r) => r.status === 'PENDING');
    const rejected = reports.filter((r) => r.status === 'REJECTED');

    const sumByType = (list: typeof reports, type: string) =>
      list.filter((r) => r.type === type).reduce((s, r) => s + r.amount, 0);

    return {
      month: targetMonth,
      totalExpense: sumByType(approved, 'EXPENSE'),
      totalWithdraw: sumByType(approved, 'WITHDRAW'),
      pendingCount: pending.length,
      pendingAmount: pending.reduce((s, r) => s + r.amount, 0),
      rejectedCount: rejected.length,
      rejectedAmount: rejected.reduce((s, r) => s + r.amount, 0),
      reports,
    };
  }

  // ── Wallet Transactions ──

  async getWalletTransactions(studioId: string, status?: string) {
    const where: any = { companion: { studioId } };
    if (status) where.status = status;
    return this.prisma.walletTransaction.findMany({
      where,
      include: { companion: { include: { user: { select: { username: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reviewWalletTransaction(id: string, status: string, reviewerId: string) {
    const tx = await this.prisma.walletTransaction.findUnique({ where: { id } });
    if (!tx) throw new NotFoundException('交易不存在');
    if (tx.status !== 'PENDING') throw new ForbiddenException('该交易已处理，无法重复审核');

    const update: any = { status, reviewedById: reviewerId };
    if (status === 'APPROVED' && tx.type === 'WITHDRAW') {
      const companion = await this.prisma.companion.findUnique({ where: { id: tx.companionId } });
      if (!companion) throw new NotFoundException('陪玩不存在');
      if (companion.balance < tx.amount) throw new ForbiddenException('余额不足，无法通过支取');
      update.balanceAfter = companion.balance - tx.amount;
      await this.prisma.companion.update({
        where: { id: tx.companionId },
        data: { balance: { decrement: tx.amount } },
      });
    }

    // Notify the companion about the review result
    const companion = await this.prisma.companion.findUnique({
      where: { id: tx.companionId },
      select: { userId: true },
    });
    if (companion?.userId) {
      const label = tx.type === 'WITHDRAW' ? '支取' : '交易';
      const resultLabel = status === 'APPROVED' ? '已通过' : '已拒绝';
      this.wsGateway.notifyUser(companion.userId, 'wallet:reviewed', {
        transactionId: tx.id,
        type: tx.type,
        amount: tx.amount,
        status,
        message: `${label}申请${resultLabel}${status === 'APPROVED' ? '，¥' + tx.amount + '已到账' : ''}`,
      });
    }

    return this.prisma.walletTransaction.update({ where: { id }, data: update });
  }

  // ── Monthly Settlement ──

  async runMonthlySettlement(studioId: string, month: string) {
    return this.settlementService.runMonthlySettlement(studioId, month);
  }

  async getMonthlySettlement(studioId: string, month?: string) {
    const targetMonth = month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const { start, end } = settlementMonthRange(targetMonth);

    return this.prisma.walletTransaction.findMany({
      where: {
        type: 'SETTLEMENT',
        createdAt: { gte: start, lt: end },
        companion: { studioId },
      },
      include: {
        companion: {
          include: { user: { select: { username: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Revenue Diff Check ──

  /** 计算某陪玩当前营业日的真实服务时长与系统预估流水（主陪 + 副陪都算，按实际计时）。 */
  private async computeActualServiceStats(companionId: string, start: Date, end: Date) {
    const sessions = await this.prisma.orderSession.findMany({
      where: {
        OR: [{ companionId }, { coCompanionId: companionId }],
        status: 'DONE',
        startedAt: { gte: start, lt: end },
      },
      select: {
        companionId: true,
        coCompanionId: true,
        amount: true,
        coAmount: true,
        claimedPrice: true,
        duration: true,
        startedAt: true,
        endedAt: true,
        totalPausedSec: true,
      },
    });

    let actualHours = 0;
    let systemRevenue = 0;
    for (const s of sessions) {
      if (!s.startedAt) continue;
      const filledHours = Number(s.duration) || 1;
      const started = new Date(s.startedAt).getTime();
      const ended = s.endedAt ? new Date(s.endedAt).getTime() : started + filledHours * 3600 * 1000;
      const activeSec = Math.max(0, (ended - started) / 1000 - (s.totalPausedSec || 0));
      const hours = activeSec / 3600;
      actualHours += hours;

      if (s.companionId === companionId) {
        // 主陪：单价 × 实际时长
        const hourlyRate = Number(s.claimedPrice) > 0 ? Number(s.claimedPrice) : (Number(s.amount) || 0) / filledHours;
        systemRevenue += hourlyRate * hours;
      } else {
        // 副陪：搭档单价 × 实际时长
        const coHourlyRate = (Number(s.coAmount) || 0) / filledHours;
        systemRevenue += coHourlyRate * hours;
      }
    }
    return { actualHours, systemRevenue, sessionCount: sessions.length };
  }

  async checkRevenueDiff(companionId: string, studioId: string, reportedAmount: number) {
    const { start, end } = currentBusinessDayRange();
    const { actualHours, systemRevenue } = await this.computeActualServiceStats(companionId, start, end);
    const diff = systemRevenue - reportedAmount;

    if (Math.abs(diff) > 0.01) {
      const companion = await this.prisma.companion.findUnique({
        where: { id: companionId },
        select: { user: { select: { username: true, displayName: true } } },
      });
      const name = companion?.user?.displayName || companion?.user?.username || companionId;

      this.wsGateway.broadcastToBridgedStudios(studioId, 'billing:revenue_diff', {
        companionId,
        companionName: name,
        actualHours: Number(actualHours.toFixed(1)),
        systemTotal: roundToJiao(systemRevenue),
        reportedAmount: roundToJiao(reportedAmount),
        diff: roundToJiao(diff),
        message: `${name} 今日实际服务 ${actualHours.toFixed(1)} 小时，系统预估流水 ¥${roundToJiao(systemRevenue)}，转公户 ¥${roundToJiao(reportedAmount)}，差额 ¥${roundToJiao(diff)}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** 把每单实际报账金额回写到客户身上，累计客户实际消费（可重复上报，按差值修正，不重复累计）。 */
  async applyCustomerActualSpent(items: Array<{ orderId: string; amount: number }>) {
    const byOrder = new Map<string, number>();
    for (const item of items) {
      if (!item.orderId) continue;
      byOrder.set(item.orderId, (byOrder.get(item.orderId) || 0) + (Number(item.amount) || 0));
    }
    for (const [orderId, actual] of byOrder) {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { customerId: true, customFields: true },
      });
      if (!order?.customerId) continue;
      const cf = (order.customFields as any) || {};
      const prevReported = Number(cf.reportedAmount || 0);
      const delta = actual - prevReported;
      if (Math.abs(delta) < 0.005) continue;
      await this.prisma.customer.update({
        where: { id: order.customerId },
        data: { totalSpent: { increment: delta } },
      }).catch(() => {});
      await this.prisma.order.update({
        where: { id: orderId },
        data: { customFields: { ...cf, reportedAmount: actual } },
      }).catch(() => {});
    }
  }

  /** 下班前转公户：业绩金额 + 公户转账截图，作为当日实际流水的最终口径 */
  async submitCompanyTransfer(
    companionId: string,
    studioId: string,
    amount: number,
    screenshotUrl: string,
  ) {
    if (!amount || !Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('请填写正确的业绩金额');
    }
    if (!screenshotUrl) {
      throw new BadRequestException('请上传转给公户的转账截图');
    }
    const report = await this.createExpenseReport({
      companionId,
      studioId,
      type: 'COMPANY_TRANSFER',
      amount,
      screenshotUrl,
    });
    // 用转公户金额与系统累计流水做一次对账提示（仅提示，不影响最终口径）
    await this.checkRevenueDiff(companionId, studioId, amount);
    return report;
  }

  /** 获取某陪玩当前营业日的系统累计流水与转公户金额 */
  async getCompanionDailyReconciliation(companionId: string) {
    const { start, end } = currentBusinessDayRange();
    // 系统累计：按真实计时（结束时间 - 开始时间 - 暂停时间），主陪 + 副陪都算
    const { actualHours, systemRevenue } = await this.computeActualServiceStats(companionId, start, end);
    const transferAgg = await this.prisma.expenseReport.aggregate({
      where: {
        companionId,
        type: 'COMPANY_TRANSFER',
        createdAt: { gte: start, lt: end },
      },
      _sum: { amount: true },
    });
    const transferTotal = transferAgg._sum.amount ?? 0;
    const finalAmount = transferTotal > 0 ? transferTotal : systemRevenue;
    return {
      actualHours: Number(actualHours.toFixed(1)),
      systemTotal: roundToJiao(systemRevenue),
      transferTotal: roundToJiao(transferTotal),
      finalAmount: roundToJiao(finalAmount),
      isAuthoritative: transferTotal > 0,
    };
  }

  // ── Unified Billing Overview ──

  async getOverview(studioId: string, companionId?: string, month?: string) {
    return this.settlementService.getOverview(studioId, companionId, month);
  }

  // ── Sidebar Badge ──

  async getPendingCount(studioId: string, role: string) {
    const whereStudio: any = role === 'OWNER' ? {} : { companion: { studioId } };
    // Transaction has no studioId — filter via companion relation for non-OWNER
    const txWhere: any = { status: 'PENDING' };
    if (role !== 'OWNER' && studioId) {
      txWhere.companion = { studioId };
    }
    const [txPending, reports, walletPending] = await Promise.all([
      this.prisma.transaction.count({ where: txWhere }),
      this.prisma.expenseReport.findMany({ where: { ...whereStudio, status: 'PENDING' }, select: { id: true } }),
      this.prisma.walletTransaction.count({ where: { ...whereStudio, status: 'PENDING' } }),
    ]);
    return { transactions: txPending, expenseReports: reports.length, walletTransactions: walletPending, total: txPending + reports.length + walletPending };
  }
}
