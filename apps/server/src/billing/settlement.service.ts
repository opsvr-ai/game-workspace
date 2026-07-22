// craftsman-ignore: TS001
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettlementService {
  constructor(private readonly prisma: PrismaService) {}

  async runMonthlySettlement(studioId: string, month: string) {
    // Idempotency guard: check if settlement already exists for this month
    const existing = await this.prisma.walletTransaction.findFirst({
      where: { type: 'SETTLEMENT', companion: { studioId }, createdAt: { gte: new Date(month + '-01') } },
    });
    if (existing) {
      return { skipped: true, message: `工作室 ${studioId} 的 ${month} 月结算已存在，跳过重复执行` };
    }

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
        // FIXED mode: use companion's personal revenueShare, fallback to global config
        const clubCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'revenue.club_companion_share' } });
        const defaultClubShare = (clubCfg?.value as number) ?? 80;
        const share = (c.revenueShare as number) || (defaultClubShare / 100);
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

  async getOverview(studioId: string, companionId?: string, month?: string) {
    if (!studioId) {
      // OWNER may not have a studioId — return all studios' data
      const firstStudio = await this.prisma.studio.findFirst();
      if (!firstStudio) return { summary: { todayRevenue:0,totalRevenue:0,totalWithdrawn:0,pendingWithdraw:0,withdrawable:0,deposit:0,splitRatio:50 }, records: [], companions: [] };
      studioId = firstStudio.id;
    }

    // All companions in studio (for dropdown)
    const allCompanions = await this.prisma.companion.findMany({
      where: { studioId },
      select: { id: true, user: { select: { username: true } } },
    });

    // Target companion IDs for aggregation
    const targetIds = companionId ? [companionId] : allCompanions.map(c => c.id);
    const companionFilter = companionId
      ? companionId
      : { in: targetIds.length > 0 ? targetIds : ['__none__'] };

    // Today's date range
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Today's DONE revenue
    const todayAgg = await this.prisma.order.aggregate({
      where: { studioId, status: 'DONE', companionId: companionFilter, createdAt: { gte: todayStart, lte: todayEnd } },
      _sum: { amount: true },
    });

    // All-time DONE revenue
    const totalAgg = await this.prisma.order.aggregate({
      where: { studioId, status: 'DONE', companionId: companionFilter },
      _sum: { amount: true },
    });

    const totalRevenue = totalAgg._sum.amount ?? 0;

    // Approved WITHDRAW sum (all-time, not month-filtered)
    const withdrawnAgg = await this.prisma.walletTransaction.aggregate({
      where: { companionId: companionFilter, type: 'WITHDRAW', status: 'APPROVED' },
      _sum: { amount: true },
    });

    // Pending WITHDRAW sum (all-time, not month-filtered)
    const pendingAgg = await this.prisma.walletTransaction.aggregate({
      where: { companionId: companionFilter, type: 'WITHDRAW', status: 'PENDING' },
      _sum: { amount: true },
    });

    // Deposit
    let deposit = 0;
    if (companionId) {
      const comp = await this.prisma.companion.findUnique({
        where: { id: companionId }, select: { deposit: true },
      });
      deposit = comp?.deposit ?? 0;
    } else {
      const depAgg = await this.prisma.companion.aggregate({
        where: { studioId }, _sum: { deposit: true },
      });
      deposit = depAgg._sum.deposit ?? 0;
    }

    // Split ratio — read from studio config and system configs
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId }, select: { splitMode: true },
    });
    let splitRatio = 0;

    if (companionId && totalRevenue > 0) {
      if (studio?.splitMode === 'FIXED') {
        const comp = await this.prisma.companion.findUnique({
          where: { id: companionId }, select: { revenueShare: true },
        });
        const clubCfg = await this.prisma.systemConfig.findUnique({
          where: { key: 'revenue.club_companion_share' },
        });
        const defaultShare = (clubCfg?.value as number) ?? 80;
        const share = (comp?.revenueShare as number) || (defaultShare / 100);
        splitRatio = Math.round(share * 100);
      } else {
        const config = await this.prisma.systemConfig.findUnique({
          where: { key: 'revenue.share_tiers' },
        });
        const tiers: Array<{ min: number; max: number | null; studio: number; companion: number }> =
          (config?.value as any) ?? [
            { min: 0, max: 5999.99, studio: 50, companion: 50 },
            { min: 6000, max: 9999, studio: 40, companion: 60 },
            { min: 10000, max: null, studio: 30, companion: 70 },
          ];
        const tier = tiers.find(
          t => totalRevenue >= t.min && (t.max === null || totalRevenue <= t.max),
        ) || tiers[tiers.length - 1];
        splitRatio = tier.companion;
      }
    }

    const totalWithdrawn = withdrawnAgg._sum.amount ?? 0;
    const pendingWithdraw = pendingAgg._sum.amount ?? 0;
    const withdrawable = Math.max(0, totalRevenue * (splitRatio / 100) - totalWithdrawn - pendingWithdraw);

    // Records — all wallet transaction types, filtered by month if provided
    const recordsWhere: any = { companionId: companionFilter };
    if (month) {
      const [y, m] = month.split('-').map(Number);
      recordsWhere.createdAt = { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
    }

    const records = await this.prisma.walletTransaction.findMany({
      where: recordsWhere,
      include: { companion: { include: { user: { select: { username: true } } } } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      summary: {
        todayRevenue: todayAgg._sum.amount ?? 0,
        totalRevenue,
        totalWithdrawn,
        pendingWithdraw,
        withdrawable,
        deposit,
        splitRatio,
      },
      records: records.map(r => ({
        id: r.id,
        type: r.type,
        amount: r.amount,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        note: r.note,
        companionName: r.companion?.user?.username ?? '',
      })),
      companions: allCompanions.map(c => ({ id: c.id, name: c.user?.username ?? '' })),
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

  async getDailyRevenue(studioId: string, date: string) {
    const start = new Date(date);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);

    const orders = await this.prisma.order.aggregate({
      where: { studioId, status: 'DONE', createdAt: { gte: start, lt: end } },
      _sum: { amount: true },
    });
    return {
      date,
      totalRevenue: orders._sum.amount ?? 0,
      orderCount: await this.prisma.order.count({
        where: { studioId, status: 'DONE', createdAt: { gte: start, lt: end } },
      }),
    };
  }

  async getMonthlyRevenue(studioId: string, month: string) {
    const [year, mon] = month.split('-').map(Number);
    const start = new Date(year, mon - 1, 1);
    const end = new Date(year, mon, 1);

    const orders = await this.prisma.order.aggregate({
      where: { studioId, status: 'DONE', createdAt: { gte: start, lt: end } },
      _sum: { amount: true },
    });
    return {
      month,
      totalRevenue: orders._sum.amount ?? 0,
      orderCount: await this.prisma.order.count({
        where: { studioId, status: 'DONE', createdAt: { gte: start, lt: end } },
      }),
    };
  }
}
