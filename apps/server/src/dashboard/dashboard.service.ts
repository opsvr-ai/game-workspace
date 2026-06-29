import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(studioId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Today's completed orders
    const todayOrders = await this.prisma.order.findMany({
      where: {
        studioId,
        status: 'DONE',
        createdAt: { gte: today, lt: tomorrow },
      },
    });

    const totalRevenue = todayOrders.reduce((s, o) => s + o.amount, 0);
    const orderCount = todayOrders.length;

    // Online/Total companions
    const allCompanions = await this.prisma.companion.findMany({
      where: { studioId },
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
        companion: { studioId },
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
      where: { studioId, monthlyRevenue: { gt: 0 } },
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
        companion: { studioId },
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

  async getTrend(studioId: string, days: number = 7) {
    const result: { date: string; revenue: number; orderCount: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);

      const orders = await this.prisma.order.findMany({
        where: {
          studioId,
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

  async getCompanionStatus(studioId: string) {
    return this.prisma.companion.findMany({
      where: { studioId },
      select: {
        id: true,
        status: true,
        monthlyRevenue: true,
        user: { select: { username: true } },
        pc: { select: { currentMode: true, lastHeartbeat: true } },
      },
    });
  }
}
