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

  // ── Revenue statistics ──

  async getDailyRevenue(studioId: string, dateStr?: string) {
    if (!studioId) {
      return { date: dateStr ?? new Date().toISOString().slice(0, 10), studioId: null, breakdown: {} as Record<string, { count: number; amount: number }>, totalAmount: 0 };
    }
    const date = dateStr ? new Date(dateStr) : new Date();
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const orders = await this.prisma.order.findMany({
      where: {
        studioId,
        status: 'DONE',
        createdAt: { gte: startOfDay, lt: endOfDay },
      },
      select: { type: true, amount: true },
    });

    const breakdown: Record<string, { count: number; amount: number }> = {
      NEW: { count: 0, amount: 0 },
      RENEW: { count: 0, amount: 0 },
      REPURCHASE: { count: 0, amount: 0 },
      TIP: { count: 0, amount: 0 },
    };

    let totalAmount = 0;
    for (const o of orders) {
      if (breakdown[o.type]) {
        breakdown[o.type].count++;
        breakdown[o.type].amount += o.amount;
      }
      totalAmount += o.amount;
    }

    return {
      date: startOfDay.toISOString().slice(0, 10),
      studioId,
      breakdown,
      totalAmount: Math.round(totalAmount * 100) / 100,
    };
  }

  async getMonthlyRevenue(studioId: string, monthStr?: string) {
    if (!studioId) {
      const now = new Date();
      return { month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, studioId: null, totalAmount: 0, companionRevenue: [] };
    }
    let year: number;
    let month: number;

    if (monthStr) {
      const parts = monthStr.split('-');
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10) - 1; // JS months are 0-indexed
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth();
    }

    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 1);

    const orders = await this.prisma.order.findMany({
      where: {
        studioId,
        status: 'DONE',
        createdAt: { gte: startOfMonth, lt: endOfMonth },
      },
      select: {
        amount: true,
        companionId: true,
        companion: { select: { user: { select: { username: true } } } },
      },
    });

    const companionMap = new Map<string, { name: string; amount: number }>();
    let totalAmount = 0;

    for (const o of orders) {
      totalAmount += o.amount;
      if (o.companionId) {
        const existing = companionMap.get(o.companionId);
        if (existing) {
          existing.amount += o.amount;
        } else {
          companionMap.set(o.companionId, {
            name: o.companion?.user?.username ?? o.companionId,
            amount: o.amount,
          });
        }
      }
    }

    return {
      month: `${year}-${String(month + 1).padStart(2, '0')}`,
      studioId,
      totalAmount: Math.round(totalAmount * 100) / 100,
      companionRevenue: Array.from(companionMap.values()).map((c) => ({
        name: c.name,
        amount: Math.round(c.amount * 100) / 100,
      })),
    };
  }

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
}
