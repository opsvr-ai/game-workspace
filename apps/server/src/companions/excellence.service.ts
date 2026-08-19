// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { settlementMonthRange } from '../common/business-day';

export interface ExcellenceResult {
  isExcellent: boolean;
  rankScore: number;
  renewRate: number;
  repurchaseRate: number;
  newRate: number;
  orderCount: number;
}

/**
 * 陪玩优秀综合分统一计算：
 * 综合分 = 月流水(50%) + 续单率(20%) + 复购率(20%) + 首单成功率(10%)。
 * 该口径同时用于管理端「⭐优秀」标记与订单池「优秀陪玩立刻看到」的延迟判断。
 */
@Injectable()
export class ExcellenceService {
  constructor(private prisma: PrismaService) {}

  async computeForCompanions(companionIds: string[]): Promise<Map<string, ExcellenceResult>> {
    const result = new Map<string, ExcellenceResult>();
    if (companionIds.length === 0) return result;

    const orderStats = await this.prisma.order.groupBy({
      by: ['companionId', 'type'],
      where: { companionId: { in: companionIds }, status: 'DONE' },
      _count: { id: true },
    });

    const m = new Map<string, { count: number; renew: number; repurchase: number }>();
    for (const row of orderStats) {
      const cid = row.companionId!;
      if (!m.has(cid)) m.set(cid, { count: 0, renew: 0, repurchase: 0 });
      const s = m.get(cid)!;
      s.count += row._count.id;
      if (row.type === 'RENEW') s.renew = row._count.id;
      if (row.type === 'REPURCHASE') s.repurchase = row._count.id;
    }

    // 月流水：按营业月统计（当月 1 日 12:00 至次月 1 日 12:00，不含）
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const { start: monthStart, end: monthEnd } = settlementMonthRange(monthKey);
    const monthlyRevenue = await this.prisma.order.groupBy({
      by: ['companionId'],
      where: {
        companionId: { in: companionIds },
        status: 'DONE',
        type: { in: ['NEW', 'RENEW', 'REPURCHASE'] },
        createdAt: { gte: monthStart, lt: monthEnd },
      },
      _sum: { amount: true },
    });
    const monthlyRevenueMap = new Map(
      monthlyRevenue.map((r) => [r.companionId!, r._sum.amount || 0]),
    );

    // 总抢单数：该陪玩抢到的所有首单（type=NEW，任意状态）
    const newGrabs = await this.prisma.order.groupBy({
      by: ['companionId'],
      where: { companionId: { in: companionIds }, type: 'NEW' },
      _count: { id: true },
    });
    const grabMap = new Map(newGrabs.map((g) => [g.companionId!, g._count.id]));

    // 首单消费客户数：DONE 首单的去重客户数
    const doneNewCustomers = await this.prisma.order.findMany({
      where: { companionId: { in: companionIds }, type: 'NEW', status: 'DONE' },
      select: { companionId: true, customerId: true },
      distinct: ['companionId', 'customerId'],
    });
    const customerMap = new Map<string, number>();
    for (const r of doneNewCustomers) {
      customerMap.set(r.companionId!, (customerMap.get(r.companionId!) || 0) + 1);
    }

    for (const [cid, s] of m) {
      const renewRate = s.count > 0 ? (s.renew / s.count) * 100 : 0;
      const repurchaseRate = s.count > 0 ? (s.repurchase / s.count) * 100 : 0;
      const grabCount = grabMap.get(cid) || 0;
      const customerCount = customerMap.get(cid) || 0;
      const firstSuccessRate = grabCount > 0 ? (customerCount / grabCount) * 100 : 0;
      // 月流水 10000 元封顶 50 分；续单/复购率各占 20%，首单成功率占 10%
      const revenue = monthlyRevenueMap.get(cid) || 0;
      const revenueScore = Math.min(50, revenue / 200);
      const rankScore = Math.round(revenueScore + renewRate * 0.2 + repurchaseRate * 0.2 + firstSuccessRate * 0.1);
      result.set(cid, {
        isExcellent: rankScore >= 50,
        rankScore,
        renewRate: Math.round(renewRate),
        repurchaseRate: Math.round(repurchaseRate),
        newRate: Math.round(firstSuccessRate),
        orderCount: s.count,
      });
    }
    return result;
  }

  async isExcellent(companionId: string): Promise<boolean> {
    const map = await this.computeForCompanions([companionId]);
    return map.get(companionId)?.isExcellent ?? false;
  }
}
