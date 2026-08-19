// craftsman-ignore: TS001
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { businessDayOf, businessDayRange } from '../common/business-day';

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
    const { target, start, end } = this.resolveYesterday(date);

    const orders = await this.prisma.order.findMany({
      where: { status: 'DONE', createdAt: { gte: start, lt: end } },
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
    const { target, start, end } = this.resolveYesterday(date);

    const studios = await this.prisma.studio.findMany({ select: { id: true } });

    for (const studio of studios) {
      const [doneOrders, companions, timeLogs] = await Promise.all([
        this.prisma.order.aggregate({
          where: { studioId: studio.id, status: 'DONE', createdAt: { gte: start, lt: end } },
          _sum: { amount: true }, _count: true,
        }),
        this.prisma.companion.count({
          where: { studioId: studio.id, status: { in: ['AVAILABLE', 'BUSY', 'ENTERTAINMENT'] } },
        }),
        this.prisma.companionTimeLog.aggregate({
          where: { companion: { studioId: studio.id }, startedAt: { gte: start, lt: end }, mode: 'ENTERTAINMENT' },
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

  /** 解析要聚合的「昨天」营业日，返回该营业日 00:00 标签和 12:00 起止区间 */
  private resolveYesterday(date?: string): { target: Date; start: Date; end: Date } {
    let key: string;
    if (date) {
      key = date;
    } else {
      const y = businessDayOf(new Date());
      y.setDate(y.getDate() - 1);
      key = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    }
    const [yy, mm, dd] = key.split('-').map(Number);
    const target = new Date(yy, mm - 1, dd, 0, 0, 0, 0);
    const { start, end } = businessDayRange(key);
    return { target, start, end };
  }
}
