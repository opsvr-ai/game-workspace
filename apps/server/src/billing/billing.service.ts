import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Transaction management ──

  async createTransaction(dto: {
    orderId: string;
    companionId: string;
    amount: number;
    paymentMethod: string;
    screenshotUrl: string;
    paidAt: string;
  }) {
    return this.prisma.transaction.create({
      data: {
        orderId: dto.orderId,
        companionId: dto.companionId,
        amount: dto.amount,
        paymentMethod: dto.paymentMethod,
        screenshotUrl: dto.screenshotUrl,
        status: 'PENDING',
        paidAt: new Date(dto.paidAt),
      },
      include: {
        order: { select: { id: true, type: true, amount: true } },
        companion: {
          select: {
            id: true,
            user: { select: { username: true } },
          },
        },
      },
    });
  }

  async approve(transactionId: string, reviewerId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { order: { select: { customerId: true } } },
    });

    if (!tx) throw new NotFoundException('报账记录不存在');
    if (tx.status !== 'PENDING') throw new ForbiddenException('该报账已处理');

    const updated = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: { status: 'APPROVED', reviewedById: reviewerId },
    });

    // Increment customer.totalSpent
    await this.prisma.customer.update({
      where: { id: tx.order.customerId },
      data: { totalSpent: { increment: tx.amount } },
    });

    // Increment companion.monthlyRevenue
    await this.prisma.companion.update({
      where: { id: tx.companionId },
      data: { monthlyRevenue: { increment: tx.amount } },
    });

    return updated;
  }

  async reject(transactionId: string, reviewerId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!tx) throw new NotFoundException('报账记录不存在');
    if (tx.status !== 'PENDING') throw new ForbiddenException('该报账已处理');

    return this.prisma.transaction.update({
      where: { id: transactionId },
      data: { status: 'REJECTED', reviewedById: reviewerId },
    });
  }

  // ── Batch operations ──

  async batchApprove(ids: string[], reviewerId: string) {
    const results = { succeeded: 0, failed: 0, errors: [] as string[] };

    for (const id of ids) {
      try {
        await this.approve(id, reviewerId);
        results.succeeded++;
      } catch (err: any) {
        results.failed++;
        results.errors.push(`${id}: ${err.message}`);
      }
    }

    return results;
  }

  async batchReject(ids: string[], reviewerId: string) {
    const results = { succeeded: 0, failed: 0, errors: [] as string[] };

    for (const id of ids) {
      try {
        await this.reject(id, reviewerId);
        results.succeeded++;
      } catch (err: any) {
        results.failed++;
        results.errors.push(`${id}: ${err.message}`);
      }
    }

    return results;
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
    if (!studioId) {
      const now = new Date();
      return { month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, studioId: null, totalRevenue: 0, totalExpense: 0, profit: 0 };
    }
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Total revenue from DONE orders
    const revenueAgg = await this.prisma.order.aggregate({
      where: {
        studioId,
        status: 'DONE',
        createdAt: { gte: startOfMonth, lt: endOfMonth },
      },
      _sum: { amount: true },
    });

    // Total expenses
    const expenseAgg = await this.prisma.expense.aggregate({
      where: {
        studioId,
        date: { gte: startOfMonth, lt: endOfMonth },
      },
      _sum: { amount: true },
    });

    const totalRevenue = revenueAgg._sum.amount ?? 0;
    const totalExpense = expenseAgg._sum.amount ?? 0;

    return {
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      studioId,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalExpense: Math.round(totalExpense * 100) / 100,
      profit: Math.round((totalRevenue - totalExpense) * 100) / 100,
    };
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

    const approved = reports.filter(r => r.status === 'APPROVED');
    const pending = reports.filter(r => r.status === 'PENDING');
    const rejected = reports.filter(r => r.status === 'REJECTED');

    const sumByType = (list: typeof reports, type: string) =>
      list.filter(r => r.type === type).reduce((s, r) => s + r.amount, 0);

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
    const [year, mon] = month.split('-').map(Number);
    const start = new Date(year, mon - 1, 1);
    const end = new Date(year, mon, 1);

    // Get all companions in studio
    const companions = await this.prisma.companion.findMany({
      where: { studioId },
      select: { id: true, balance: true, revenueShare: true, user: { select: { username: true } } },
    });

    // Check studio split mode (TASK-12)
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { splitMode: true } });
    const isFixedMode = studio?.splitMode === 'FIXED';

    // Get share tiers config (only used in TIERED mode)
    const config = !isFixedMode ? await this.prisma.systemConfig.findUnique({
      where: { key: 'revenue.share_tiers' },
    }) : null;
    const tiers: Array<{ min: number; max: number | null; studio: number; companion: number }> =
      (config?.value as any) ?? [
        { min: 0, max: 5999.99, studio: 50, companion: 50 },
        { min: 6000, max: 9999, studio: 40, companion: 60 },
        { min: 10000, max: null, studio: 30, companion: 70 },
      ];

    const results: Array<{
      companionId: string;
      companionName: string;
      monthlyRevenue: number;
      tierCompanionPct: number;
      companionShare: number;
      studioShare: number;
    }> = [];

    for (const c of companions) {
      // Get monthly completed orders revenue for this companion
      const orders = await this.prisma.order.findMany({
        where: {
          companionId: c.id,
          status: 'DONE',
          createdAt: { gte: start, lt: end },
        },
      });
      const monthlyRevenue = orders.reduce((s, o) => s + o.amount, 0);

      if (monthlyRevenue === 0) continue; // skip companions with no revenue

      let companionPct: number;
      let companionShare: number;
      let studioShare: number;

      if (isFixedMode) {
        // FIXED mode: use companion's personal revenueShare
        const share = (c.revenueShare as number) ?? 0.8;
        companionPct = Math.round(share * 100);
        companionShare = Math.round(monthlyRevenue * share * 100) / 100;
        studioShare = Math.round((monthlyRevenue - companionShare) * 100) / 100;
      } else {
        // TIERED mode: find applicable tier
        const tier =
          tiers.find(
            (t) =>
              monthlyRevenue >= t.min &&
              (t.max === null || monthlyRevenue <= t.max),
          ) || tiers[tiers.length - 1];
        companionPct = tier.companion;
        companionShare = Math.round(monthlyRevenue * (tier.companion / 100) * 100) / 100;
        studioShare = Math.round(monthlyRevenue * (tier.studio / 100) * 100) / 100;
      }

      // Create settlement transaction
      await this.prisma.walletTransaction.create({
        data: {
          companionId: c.id,
          type: 'SETTLEMENT',
          amount: companionShare,
          balanceBefore: c.balance,
          balanceAfter: c.balance + companionShare,
          status: 'APPROVED',
          note: `${month} 月底结算：业绩¥${monthlyRevenue}，${companionPct}%分成`,
        },
      });

      // Update companion balance and reset monthlyRevenue
      await this.prisma.companion.update({
        where: { id: c.id },
        data: {
          balance: { increment: companionShare },
          monthlyRevenue: 0,
        },
      });

      results.push({
        companionId: c.id,
        companionName: c.user?.username ?? c.id,
        monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
        tierCompanionPct: companionPct,
        companionShare,
        studioShare,
      });
    }

    return {
      month,
      results,
      totalDistributed: Math.round(results.reduce((s, r) => s + r.companionShare, 0) * 100) / 100,
    };
  }

  async getMonthlySettlement(studioId: string, month?: string) {
    const targetMonth =
      month ||
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
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
}
