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

  async checkRevenueDiff(companionId: string, studioId: string, reportedAmount: number) {
    const { start, end } = currentBusinessDayRange();

    const sessions = await this.prisma.orderSession.findMany({
      where: {
        companionId,
        status: 'DONE',
        startedAt: { gte: start, lt: end },
      },
      select: { amount: true, claimedPrice: true, duration: true },
    });

    const systemTotal = sessions.reduce((s, o) => {
      const price = Number(o.claimedPrice || 0) > 0 ? Number(o.claimedPrice) : Number(o.amount || 0);
      return s + price * (o.duration || 1);
    }, 0);
    const diff = systemTotal - reportedAmount;

    if (Math.abs(diff) > 0.01) {
      const companion = await this.prisma.companion.findUnique({
        where: { id: companionId },
        select: { user: { select: { username: true, displayName: true } } },
      });
      const name = companion?.user?.displayName || companion?.user?.username || companionId;

      this.wsGateway.broadcastToBridgedStudios(studioId, 'billing:revenue_diff', {
        companionId,
        companionName: name,
        systemTotal: roundToJiao(systemTotal),
        reportedAmount: roundToJiao(reportedAmount),
        diff: roundToJiao(diff),
        message: `${name} 上报流水 ¥${roundToJiao(reportedAmount)}，系统订单 ¥${roundToJiao(systemTotal)}，差额 ¥${roundToJiao(diff)}`,
        timestamp: new Date().toISOString(),
      });
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
    // 系统累计：以开始服务时填的客单价×时长为准（会话口径），匹配“点开始服务自动累计”的语义
    const sessions = await this.prisma.orderSession.findMany({
      where: {
        companionId,
        status: 'DONE',
        startedAt: { gte: start, lt: end },
      },
      select: { amount: true, claimedPrice: true, duration: true },
    });
    const systemTotal = sessions.reduce((s, o) => {
      const price = Number(o.claimedPrice || 0) > 0 ? Number(o.claimedPrice) : Number(o.amount || 0);
      return s + price * (o.duration || 1);
    }, 0);
    const transferAgg = await this.prisma.expenseReport.aggregate({
      where: {
        companionId,
        type: 'COMPANY_TRANSFER',
        createdAt: { gte: start, lt: end },
      },
      _sum: { amount: true },
    });
    const transferTotal = transferAgg._sum.amount ?? 0;
    const finalAmount = transferTotal > 0 ? transferTotal : systemTotal;
    return {
      systemTotal: roundToJiao(systemTotal),
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
