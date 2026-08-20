// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { settlementMonthRange } from '../common/business-day';

export interface ExcellenceResult {
  isExcellent: boolean;
  tier: string;
  rankScore: number;
  revenueScore: number;
  bonusScore: number;
  renewRate: number;
  repurchaseRate: number;
  newRate: number;
  orderCount: number;
}

/**
 * 陪玩段位综合分统一计算：
 * 综合分 = 月流水(50%) + 续单率(20%) + 复购率(20%) + 首单成功率(10%)。
 * 该口径同时用于管理端「上等马/中等马/下等马」标记与订单池「上等马立刻看到」的延迟判断。
 */
@Injectable()
export class ExcellenceService {
  constructor(private prisma: PrismaService) {}

  async computeForCompanions(companionIds: string[]): Promise<Map<string, ExcellenceResult>> {
    const result = new Map<string, ExcellenceResult>();
    if (companionIds.length === 0) return result;

    // 评分权重可后台配置（默认：月流水50 + 续单20 + 复购20 + 首单10，上等马线50）
    const [rwCfg, rcCfg, renewCfg, repurchaseCfg, firstCfg, thresholdCfg, middleCfg] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'excellence.revenue_weight' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'excellence.revenue_cap_yuan' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'excellence.renew_weight' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'excellence.repurchase_weight' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'excellence.first_success_weight' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'excellence.excellent_threshold' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'excellence.middle_tier_threshold' } }),
    ]);
    const num = (v: any, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
    const revenueWeight = num(rwCfg?.value, 50);
    const revenueCapYuan = Math.max(1, num(rcCfg?.value, 10000));
    const renewWeight = num(renewCfg?.value, 20);
    const repurchaseWeight = num(repurchaseCfg?.value, 20);
    const firstSuccessWeight = num(firstCfg?.value, 10);
    const excellentThreshold = num(thresholdCfg?.value, 50);
    const middleTierThreshold = num(middleCfg?.value, 25);

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

    // 战绩图采纳加分：直接叠加到综合分。
    const bonusRows = await this.prisma.companion.findMany({
      where: { id: { in: companionIds } },
      select: { id: true, bonusScore: true },
    });
    const bonusMap = new Map(bonusRows.map((b) => [b.id, b.bonusScore || 0]));

    for (const [cid, s] of m) {
      const renewRate = s.count > 0 ? (s.renew / s.count) * 100 : 0;
      const repurchaseRate = s.count > 0 ? (s.repurchase / s.count) * 100 : 0;
      const grabCount = grabMap.get(cid) || 0;
      const customerCount = customerMap.get(cid) || 0;
      const firstSuccessRate = grabCount > 0 ? (customerCount / grabCount) * 100 : 0;
      const revenue = monthlyRevenueMap.get(cid) || 0;
      const revenueScore = Math.min(revenueWeight, (revenue * revenueWeight) / revenueCapYuan);
      const renewScore = (renewRate * renewWeight) / 100;
      const repurchaseScore = (repurchaseRate * repurchaseWeight) / 100;
      const firstSuccessScore = (firstSuccessRate * firstSuccessWeight) / 100;
      const bonus = bonusMap.get(cid) || 0;
      const rankScore = Math.round(revenueScore + renewScore + repurchaseScore + firstSuccessScore + bonus);
      const tier = rankScore >= excellentThreshold
        ? 'TOP'
        : rankScore >= middleTierThreshold
          ? 'MIDDLE'
          : 'LOW';
      result.set(cid, {
        isExcellent: rankScore >= excellentThreshold,
        tier,
        rankScore,
        revenueScore: Math.round(revenueScore),
        bonusScore: bonus,
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

  async computeOne(companionId: string): Promise<ExcellenceResult> {
    const map = await this.computeForCompanions([companionId]);
    return map.get(companionId) ?? {
      isExcellent: false,
      tier: 'LOW',
      rankScore: 0,
      revenueScore: 0,
      bonusScore: 0,
      renewRate: 0,
      repurchaseRate: 0,
      newRate: 0,
      orderCount: 0,
    };
  }
}
