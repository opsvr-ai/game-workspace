// craftsman-ignore: TS001
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Daily KPI aggregation service.
 * Populates RevenueDaily and StudioDailyStats tables (M4 fix).
 */
@Injectable()
export class DailyStatsService {
  private readonly logger = new Logger(DailyStatsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Aggregate yesterday's revenue into RevenueDaily */
  async aggregateRevenue(date?: string) {
    const target = date ? new Date(date) : new Date();
    target.setDate(target.getDate() - 1); // yesterday
    target.setHours(0, 0, 0, 0);
    const nextDay = new Date(target);
    nextDay.setDate(nextDay.getDate() + 1);

    const orders = await this.prisma.order.findMany({
      where: { status: 'DONE', createdAt: { gte: target, lt: nextDay } },
      select: { studioId: true, companionId: true, type: true, amount: true },
    });

    // Group by studioId + companionId
    const groups: Record<string, {
      studioId: string; companionId: string | null;
      newCount: number; newAmount: number; renewCount: number; renewAmount: number;
      repurchaseCount: number; repurchaseAmount: number; tipCount: number; tipAmount: number;
    }> = {};

    for (const o of orders) {
      const key = `${o.studioId}:${o.companionId || 'unassigned'}`;
      if (!groups[key]) {
        groups[key] = { studioId: o.studioId, companionId: o.companionId,
          newCount: 0, newAmount: 0, renewCount: 0, renewAmount: 0,
          repurchaseCount: 0, repurchaseAmount: 0, tipCount: 0, tipAmount: 0 };
      }
      const g = groups[key];
      if (o.type === 'RENEW') { g.renewCount++; g.renewAmount += o.amount; }
      else if (o.type === 'REPURCHASE') { g.repurchaseCount++; g.repurchaseAmount += o.amount; }
      else if (o.type === 'TIP') { g.tipCount++; g.tipAmount += o.amount; }
      else { g.newCount++; g.newAmount += o.amount; }
    }

    for (const g of Object.values(groups)) {
      await this.prisma.revenueDaily.upsert({
        where: { date_studioId_companionId: { date: target, studioId: g.studioId, companionId: g.companionId || '' } },
        create: { date: target, studioId: g.studioId, companionId: g.companionId,
          newOrderCount: g.newCount, newOrderAmount: g.newAmount,
          renewCount: g.renewCount, renewAmount: g.renewAmount,
          repurchaseCount: g.repurchaseCount, repurchaseAmount: g.repurchaseAmount,
          tipCount: g.tipCount, tipAmount: g.tipAmount },
        update: { newOrderCount: g.newCount, newOrderAmount: g.newAmount,
          renewCount: g.renewCount, renewAmount: g.renewAmount,
          repurchaseCount: g.repurchaseCount, repurchaseAmount: g.repurchaseAmount,
          tipCount: g.tipCount, tipAmount: g.tipAmount },
      });
    }

    this.logger.log(`Aggregated ${Object.keys(groups).length} revenue groups for ${target.toISOString().slice(0, 10)}`);
  }

  /** Aggregate daily studio stats */
  async aggregateStudioStats(date?: string) {
    const target = date ? new Date(date) : new Date();
    target.setDate(target.getDate() - 1);
    target.setHours(0, 0, 0, 0);
    const nextDay = new Date(target);
    nextDay.setDate(nextDay.getDate() + 1);

    const studios = await this.prisma.studio.findMany({ select: { id: true } });

    for (const studio of studios) {
      const [doneOrders, companions, timeLogs] = await Promise.all([
        this.prisma.order.aggregate({
          where: { studioId: studio.id, status: 'DONE', createdAt: { gte: target, lt: nextDay } },
          _sum: { amount: true }, _count: true,
        }),
        this.prisma.companion.count({
          where: { studioId: studio.id, status: { in: ['AVAILABLE', 'BUSY', 'ENTERTAINMENT'] } },
        }),
        this.prisma.companionTimeLog.aggregate({
          where: { companion: { studioId: studio.id }, startedAt: { gte: target, lt: nextDay }, mode: 'ENTERTAINMENT' },
          _sum: { durationSeconds: true },
        }),
      ]);

      const totalRevenue = doneOrders._sum.amount || 0;
      const orderCount = doneOrders._count;
      const totalCompanions = await this.prisma.companion.count({ where: { studioId: studio.id } });
      const entertainmentFee = (timeLogs._sum.durationSeconds || 0) / 60;

      await this.prisma.studioDailyStats.upsert({
        where: { date_studioId: { date: target, studioId: studio.id } },
        create: { date: target, studioId: studio.id, totalRevenue, orderCount,
          onlineCompanions: companions, totalCompanions, entertainmentFee, acceptRate: 0 },
        update: { totalRevenue, orderCount, onlineCompanions: companions, totalCompanions, entertainmentFee },
      });
    }

    this.logger.log(`Aggregated stats for ${studios.length} studios`);
  }
}
