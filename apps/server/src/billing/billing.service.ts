// craftsman-ignore: TS001
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionService } from './transaction.service';
import { SettlementService } from './settlement.service';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
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

  async approve(transactionId: string, reviewerId: string) {
    return this.transactionService.approve(transactionId, reviewerId);
  }

  async reject(transactionId: string, reviewerId: string) {
    return this.transactionService.reject(transactionId, reviewerId);
  }

  async batchApprove(ids: string[], reviewerId: string) {
    return this.transactionService.batchApprove(ids, reviewerId);
  }

  async batchReject(ids: string[], reviewerId: string) {
    return this.transactionService.batchReject(ids, reviewerId);
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
      (user.role === 'ADMIN' || user.role === 'OWNER') && user.studioId
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
    const [year, mon] = targetMonth.split('-').map(Number);
    const start = new Date(year, mon - 1, 1);
    const end = new Date(year, mon, 1);

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

    const update: any = { status, reviewedById: reviewerId };
    if (status === 'APPROVED' && tx.type === 'WITHDRAW') {
      const companion = await this.prisma.companion.findUnique({ where: { id: tx.companionId } });
      update.balanceAfter = (companion?.balance ?? 0) - tx.amount;
      await this.prisma.companion.update({
        where: { id: tx.companionId },
        data: { balance: { decrement: tx.amount } },
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
    const [year, mon] = targetMonth.split('-').map(Number);
    const start = new Date(year, mon - 1, 1);
    const end = new Date(year, mon, 1);

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

  // ── Unified Billing Overview ──

  async getOverview(studioId: string, companionId?: string, month?: string) {
    return this.settlementService.getOverview(studioId, companionId, month);
  }
}
