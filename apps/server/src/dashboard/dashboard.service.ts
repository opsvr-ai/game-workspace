import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function formatSeconds(sec: number): string {
  const h = Math.floor(sec / 3600);
  const min = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(studioId: string | null) {
    const studioWhere: any = studioId ? { studioId } : {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Today's completed orders
    const todayOrders = await this.prisma.order.findMany({
      where: {
        ...studioWhere,
        status: 'DONE',
        createdAt: { gte: today, lt: tomorrow },
      },
    });

    const totalRevenue = todayOrders.reduce((s, o) => s + o.amount, 0);
    const orderCount = todayOrders.length;

    // Online/Total companions
    const allCompanions = await this.prisma.companion.findMany({
      where: studioWhere,
      select: { id: true, status: true },
    });
    const onlineCompanions = allCompanions.filter(
      c => c.status === 'ONLINE' || c.status === 'BUSY',
    ).length;

    // Accept rate: companion with status BUSY / total online
    const busyCount = allCompanions.filter(c => c.status === 'BUSY').length;
    const acceptRate = onlineCompanions > 0
      ? Math.round((busyCount / onlineCompanions) * 100)
      : 0;

    // Entertainment fee from time logs
    const timeLogs = await this.prisma.companionTimeLog.findMany({
      where: {
        companion: studioWhere,
        mode: 'ENTERTAINMENT',
        startedAt: { gte: today },
      },
    });
    const entertainmentMinutes = timeLogs.reduce(
      (s, t) => s + (t.durationSeconds || 0), 0,
    ) / 60;
    const entertainmentFee = Math.round(entertainmentMinutes); // 1/min

    // Ranking (monthly revenue)
    const ranking = await this.prisma.companion.findMany({
      where: { ...studioWhere, monthlyRevenue: { gt: 0 } },
      orderBy: { monthlyRevenue: 'desc' },
      take: 10,
      select: {
        id: true,
        monthlyRevenue: true,
        user: { select: { username: true } },
      },
    });

    // Alerts: companions with low revenue
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'revenue.low_warning' },
    });
    const lowThreshold = (config?.value as number) ?? 300;

    // Get today's revenue per companion from transactions
    const todayTransactions = await this.prisma.transaction.findMany({
      where: {
        companion: studioWhere,
        createdAt: { gte: today, lt: tomorrow },
        status: 'APPROVED',
      },
      select: { companionId: true, amount: true },
    });
    const revMap = new Map<string, number>();
    for (const t of todayTransactions) {
      revMap.set(t.companionId, (revMap.get(t.companionId) || 0) + t.amount);
    }
    const alerts = allCompanions
      .filter(c => (revMap.get(c.id) || 0) < lowThreshold)
      .map(c => ({
        companionId: c.id,
        companionName: '',
        message: `今日流水低于${lowThreshold}预警线`,
      }));

    return {
      today: {
        totalRevenue,
        orderCount,
        onlineCount: onlineCompanions,
        totalCount: allCompanions.length,
        acceptRate,
        entertainmentFee,
      },
      ranking: ranking.map((r, i) => ({
        rank: i + 1,
        companionId: r.id,
        companionName: r.user?.username ?? '',
        monthlyRevenue: r.monthlyRevenue,
      })),
      alerts,
    };
  }

  async getTrend(studioId: string | null, days: number = 7) {
    const studioWhere: any = studioId ? { studioId } : {};
    const result: { date: string; revenue: number; orderCount: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);

      const orders = await this.prisma.order.findMany({
        where: {
          ...studioWhere,
          status: 'DONE',
          createdAt: { gte: d, lt: next },
        },
      });
      result.push({
        date: d.toISOString().slice(0, 10),
        revenue: orders.reduce((s, o) => s + o.amount, 0),
        orderCount: orders.length,
      });
    }
    return result;
  }

  async getCompanionStatus(studioId: string | null) {
    const studioWhere: any = studioId ? { studioId } : {};
    return this.prisma.companion.findMany({
      where: studioWhere,
      select: {
        id: true,
        status: true,
        monthlyRevenue: true,
        user: { select: { username: true } },
        pc: { select: { currentMode: true, lastHeartbeat: true } },
      },
    });
  }

  async getDailyPerformance(studioId: string | null, date?: string) {
    const studioWhere: any = studioId ? { studioId } : {};
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const companions = await this.prisma.companion.findMany({
      where: studioWhere,
      include: { user: { select: { username: true } } },
    });

    const results = [];
    for (const c of companions) {
      const logs = await this.prisma.companionTimeLog.findMany({
        where: { companionId: c.id, startedAt: { gte: targetDate } },
      });
      const totalSec = logs.reduce((s, l) => s + (l.durationSeconds || 0), 0);
      const workSec = logs
        .filter((l) => l.mode === 'WORK')
        .reduce((s, l) => s + (l.durationSeconds || 0), 0);
      const onlineSec = logs
        .filter((l) => l.mode !== 'OFFLINE')
        .reduce((s, l) => s + (l.durationSeconds || 0), 0);

      const orders = await this.prisma.order.findMany({
        where: {
          companionId: c.id,
          status: 'DONE',
          createdAt: { gte: targetDate, lt: nextDay },
        },
      });
      const revenue = orders.reduce((s, o) => s + o.amount, 0);

      const acceptRate =
        onlineSec > 0 ? Math.round((workSec / onlineSec) * 100) : 0;
      const renewOrders = orders.filter((o) => o.type === 'RENEW').length;
      const renewRate =
        orders.length > 0
          ? Math.round((renewOrders / orders.length) * 100)
          : 0;
      const uniqueCustomers = new Set(orders.map((o) => o.customerId)).size;
      const repurchaseRate =
        uniqueCustomers > 0
          ? Math.round(
              (orders.filter((o) => o.type === 'REPURCHASE').length /
                uniqueCustomers) *
                100,
            )
          : 0;

      results.push({
        companionId: c.id,
        companionName: c.user?.username,
        onlineDuration: formatSeconds(totalSec),
        workDuration: formatSeconds(workSec),
        acceptRate,
        renewRate,
        repurchaseRate,
        dailyRevenue: Math.round(revenue * 100) / 100,
        status: c.status,
      });
    }

    return results.sort((a, b) => b.dailyRevenue - a.dailyRevenue);
  }

  async getMonthlyPerformance(studioId: string | null, month?: string) {
    const studioWhere: any = studioId ? { studioId } : {};
    const now = new Date();
    const m =
      month ||
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [y, mon] = m.split('-').map(Number);
    const start = new Date(y, mon - 1, 1);
    const end = new Date(y, mon, 1);

    const companions = await this.prisma.companion.findMany({
      where: studioWhere,
      include: { user: { select: { username: true } } },
    });

    const results = [];
    for (const c of companions) {
      const orders = await this.prisma.order.findMany({
        where: {
          companionId: c.id,
          status: 'DONE',
          createdAt: { gte: start, lt: end },
        },
      });
      const revenue = orders.reduce((s, o) => s + o.amount, 0);
      const renewCount = orders.filter((o) => o.type === 'RENEW').length;
      const repurchaseCount = orders.filter(
        (o) => o.type === 'REPURCHASE',
      ).length;

      results.push({
        companionId: c.id,
        companionName: c.user?.username,
        totalOrders: orders.length,
        monthlyRevenue: Math.round(revenue * 100) / 100,
        renewRate:
          orders.length > 0
            ? Math.round((renewCount / orders.length) * 100)
            : 0,
        repurchaseRate:
          orders.length > 0
            ? Math.round((repurchaseCount / orders.length) * 100)
            : 0,
        firstOrderRatio:
          revenue > 0
            ? Math.round(
                (orders
                  .filter((o) => o.type === 'NEW')
                  .reduce((s, o) => s + o.amount, 0) /
                  revenue) *
                  100,
              )
            : 0,
        renewRatio:
          revenue > 0
            ? Math.round(
                (orders
                  .filter((o) => o.type === 'RENEW')
                  .reduce((s, o) => s + o.amount, 0) /
                  revenue) *
                  100,
              )
            : 0,
        repurchaseRatio:
          revenue > 0
            ? Math.round(
                (orders
                  .filter((o) => o.type === 'REPURCHASE')
                  .reduce((s, o) => s + o.amount, 0) /
                  revenue) *
                  100,
              )
            : 0,
      });
    }

    return results.sort((a, b) => b.monthlyRevenue - a.monthlyRevenue);
  }

  async getRevenueOverview(studioId: string | null) {
    const studioWhere: any = studioId ? { studioId } : {};
    const now = new Date();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setDate(yesterdayEnd.getDate() + 1);
    const yesterdayOrders = await this.prisma.order.findMany({
      where: { ...studioWhere, status: 'DONE', createdAt: { gte: yesterday, lt: yesterdayEnd } },
    });
    const yesterdayRevenue = yesterdayOrders.reduce((s, o) => s + o.amount, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthOrders = await this.prisma.order.findMany({
      where: { ...studioWhere, status: 'DONE', createdAt: { gte: monthStart } },
    });
    const monthlyRevenue = monthOrders.reduce((s, o) => s + o.amount, 0);

    const typeBreakdown: Record<string, number> = { NEW: 0, RENEW: 0, REPURCHASE: 0, TIP: 0 };
    for (const o of monthOrders) typeBreakdown[o.type] = (typeBreakdown[o.type] || 0) + o.amount;

    const companions = await this.prisma.companion.findMany({
      where: studioWhere, include: { user: { select: { username: true } } },
    });
    const companionRevenue: any[] = [];
    for (const c of companions) {
      const rev = monthOrders.filter(o => o.companionId === c.id).reduce((s, o) => s + o.amount, 0);
      if (rev > 0) companionRevenue.push({ companionId: c.id, name: c.user?.username || '?', revenue: Math.round(rev * 100) / 100 });
    }
    companionRevenue.sort((a, b) => b.revenue - a.revenue);
    return { yesterdayRevenue, monthlyRevenue, typeBreakdown, companionRevenue };
  }

  async getCompanionRevenueDetail(companionId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const orders = await this.prisma.order.findMany({
      where: { companionId, status: 'DONE', createdAt: { gte: monthStart } },
    });
    const breakdown: Record<string, number> = { NEW: 0, RENEW: 0, REPURCHASE: 0, TIP: 0 };
    for (const o of orders) breakdown[o.type] = (breakdown[o.type] || 0) + o.amount;
    return { companionId, totalRevenue: orders.reduce((s, o) => s + o.amount, 0), orderCount: orders.length, breakdown };
  }
}
