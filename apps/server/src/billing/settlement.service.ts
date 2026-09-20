// craftsman-ignore: TS001
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  currentBusinessDayRange,
  businessDayRange,
  settlementMonthRange,
  currentSettlementMonthRange,
} from '../common/business-day';
import { companionOrderRevenue } from '../common/order-revenue';
import { computeWithdrawable } from '../common/withdrawable';
import { roundToJiao } from '../common/money';
import { resolveCompanionPctTiered, effectiveTenureMonths } from '../common/revenue-calculator';
import { resolveConfigs } from '../common/studio-config';

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

    const { start, end } = settlementMonthRange(month);

    // Get all companions in studio
    const companions = await this.prisma.companion.findMany({
      where: { studioId },
      select: { id: true, balance: true, revenueShare: true, createdAt: true, isSeniorStaff: true, user: { select: { username: true } } },
    });

    // Check studio split mode (TASK-12)
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { splitMode: true } });
    const isFixedMode = studio?.splitMode === 'FIXED';

    // 分成口径按**这家店**解析：店长填过就用店长的，没填才用老板的默认（见 common/studio-config.ts）。
    const cfg = await resolveConfigs(this.prisma, studioId, [
      'revenue.share_tiers',
      'revenue.club_companion_share',
    ]);
    const tiers: Array<{ min: number; max: number | null; studio: number; companion: number }> =
      (cfg['revenue.share_tiers'] as any) ?? [
        { min: 0, max: 5999.99, studio: 50, companion: 50 },
        { min: 6000, max: 9999.99, studio: 40, companion: 60 },
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
      // Get monthly completed orders revenue for this companion (primary + coCompanion)
      const orders = await this.prisma.order.findMany({
        where: {
          status: 'DONE',
          createdAt: { gte: start, lt: end },
          OR: [{ companionId: c.id }, { coCompanionId: c.id }],
        },
      });
      // 统一口径：主陪/搭档/splits 一并计算
      let monthlyRevenue = orders.reduce((s, o) => s + companionOrderRevenue(o, c.id), 0);

      if (monthlyRevenue === 0) continue; // skip companions with no revenue

      let companionPct: number;
      let companionShare: number;
      let studioShare: number;

      if (isFixedMode) {
        // FIXED mode: use companion's personal revenueShare, fallback to global config
        const defaultClubShare = (cfg['revenue.club_companion_share'] as number) ?? 80;
        const share = (c.revenueShare as number) || defaultClubShare / 100;
        companionPct = Math.round(share * 100);
        companionShare = roundToJiao(monthlyRevenue * share);
        studioShare = roundToJiao(monthlyRevenue - companionShare);
      } else {
        // TIERED mode: find applicable tier
        companionPct = resolveCompanionPctTiered(monthlyRevenue, effectiveTenureMonths(c.createdAt, c.isSeniorStaff), tiers);
        companionShare = roundToJiao(monthlyRevenue * (companionPct / 100));
        studioShare = roundToJiao(monthlyRevenue - companionShare);
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
        monthlyRevenue: roundToJiao(monthlyRevenue),
        tierCompanionPct: companionPct,
        companionShare,
        studioShare,
      });
    }

    return {
      month,
      results,
      totalDistributed: roundToJiao(results.reduce((s, r) => s + r.companionShare, 0)),
    };
  }

  async getOverview(studioId: string, companionId?: string, month?: string) {
    if (!studioId) {
      // OWNER may not have a studioId — return all studios' data
      const firstStudio = await this.prisma.studio.findFirst();
      if (!firstStudio)
        return {
          summary: {
            todayRevenue: 0,
            totalRevenue: 0,
            totalWithdrawn: 0,
            pendingWithdraw: 0,
            withdrawable: 0,
            deposit: 0,
            splitRatio: 50,
          },
          records: [],
          companions: [],
        };
      studioId = firstStudio.id;
    }

    // All companions in studio (for dropdown)
    const allCompanions = await this.prisma.companion.findMany({
      where: { studioId },
      select: { id: true, user: { select: { username: true } } },
    });

    // Target companion IDs for aggregation
    const targetIds = companionId ? [companionId] : allCompanions.map((c) => c.id);
    const companionFilter = companionId ? companionId : { in: targetIds.length > 0 ? targetIds : ['__none__'] };

      // Today's date range（营业日：当日 12:00 至次日 11:59）
      const { start: todayStart, end: todayEnd } = currentBusinessDayRange();

    // Today's DONE revenue
    const todayAgg = await this.prisma.order.aggregate({
      where: { studioId, status: 'DONE', companionId: companionFilter, createdAt: { gte: todayStart, lt: todayEnd } },
      _sum: { amount: true },
    });

    // 当月业绩：口径见需求文档 §7.1，结算月 = 当月 1 日 12:00 至次月 1 日 12:00
    const nowMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const targetMonth = month || nowMonth;
    const { start: monthStart, end: monthEnd } = settlementMonthRange(targetMonth);

    const monthAgg = await this.prisma.order.aggregate({
      where: {
        studioId,
        status: 'DONE',
        companionId: companionFilter,
        createdAt: { gte: monthStart, lt: monthEnd },
      },
      _sum: { amount: true },
    });
    const monthRevenue = monthAgg._sum.amount ?? 0;

    // 历史累计（只用于展示）
    const totalAgg = await this.prisma.order.aggregate({
      where: { studioId, status: 'DONE', companionId: companionFilter },
      _sum: { amount: true },
    });

    const totalRevenue = totalAgg._sum.amount ?? 0;

    // Deposit
    let deposit = 0;
    if (companionId) {
      const comp = await this.prisma.companion.findUnique({
        where: { id: companionId },
        select: { deposit: true },
      });
      deposit = comp?.deposit ?? 0;
    } else {
      const depAgg = await this.prisma.companion.aggregate({
        where: { studioId },
        _sum: { deposit: true },
      });
      deposit = depAgg._sum.deposit ?? 0;
    }

    // 可支取余额：唯一口径在 common/withdrawable.ts。
    // 以前这里自己算了一遍（用全店流水套一个档位、还带着写死的 5200 兜底），
    // 跟「钱包 / 支取审核」算出来的数能差出几百块，所以统一收敛过去。
    // 全店视图 = 每个陪玩各自的可用额相加（分润档位本来就是按人按月算的）。
    let splitRatio = 0;
    let totalWithdrawn = 0;
    let pendingWithdraw = 0;
    let depositReserve = 0;
    let withdrawable = 0;
    if (companionId) {
      const w = await computeWithdrawable(this.prisma, companionId, { month: targetMonth });
      splitRatio = w.splitRatio;
      totalWithdrawn = w.approvedWithdrawn;
      pendingWithdraw = w.pendingWithdraw;
      depositReserve = w.depositReserve;
      withdrawable = w.withdrawable;
    } else {
      // 平均分润比例 = 各人提成之和 ÷ 各人流水之和（全店视图只做展示）
      let weightedShare = 0;
      let revenueSum = 0;
      for (const c of allCompanions) {
        const w = await computeWithdrawable(this.prisma, c.id, { month: targetMonth });
        totalWithdrawn += w.approvedWithdrawn;
        pendingWithdraw += w.pendingWithdraw;
        depositReserve += w.depositReserve;
        withdrawable += w.withdrawable;
        weightedShare += w.monthRevenue * (w.splitRatio / 100);
        revenueSum += w.monthRevenue;
      }
      totalWithdrawn = roundToJiao(totalWithdrawn);
      pendingWithdraw = roundToJiao(pendingWithdraw);
      depositReserve = roundToJiao(depositReserve);
      withdrawable = roundToJiao(withdrawable);
      splitRatio = revenueSum > 0 ? Math.round((weightedShare / revenueSum) * 100) : 0;
    }

    // Records — all wallet transaction types, filtered by month if provided
    const recordsWhere: any = { companionId: companionFilter };
    if (month) {
      const { start, end } = settlementMonthRange(month);
      recordsWhere.createdAt = { gte: start, lt: end };
    }

    const records = await this.prisma.walletTransaction.findMany({
      where: recordsWhere,
      include: { companion: { include: { user: { select: { username: true } } } } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      summary: {
        todayRevenue: todayAgg._sum.amount ?? 0,
        monthRevenue,
        month: targetMonth,
        totalRevenue,
        totalWithdrawn,
        pendingWithdraw,
        depositReserve,
        withdrawable,
        deposit,
        splitRatio,
      },
      records: records.map((r) => ({
        id: r.id,
        type: r.type,
        amount: r.amount,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        note: r.note,
        companionName: r.companion?.user?.username ?? '',
      })),
      companions: allCompanions.map((c) => ({ id: c.id, name: c.user?.username ?? '' })),
    };
  }

  async getProfitLoss(studioId: string) {
    if (!studioId) {
      const now = new Date();
      return {
        month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
        studioId: null,
        totalRevenue: 0,
        totalExpense: 0,
        profit: 0,
      };
    }
    const now = new Date();
    const { start: startOfMonth, end: endOfMonth } = currentSettlementMonthRange();

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
    const { start, end } = businessDayRange(date);

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
    const { start, end } = settlementMonthRange(month);

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

