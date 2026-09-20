// craftsman-ignore: TS001,TS003
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { settlementMonthRange } from '../common/business-day';
import { resolveConfigsRaw } from '../common/studio-config';

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
export class ExcellenceService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    // 下等马末位淘汰：每天检查一次（启动后 1 分钟先跑一次，之后每 24 小时）
    setTimeout(() => this.runLowTierResignCheck().catch(() => {}), 60 * 1000);
    setInterval(() => this.runLowTierResignCheck().catch(() => {}), 24 * 60 * 60 * 1000);
  }

  /**
   * 下等马末位淘汰：连续 N 天是下等马（可配置 excellence.low_tier_auto_resign_days），
   * 自动离职。默认 0 表示不自动离职（只由管理端手动处理）。
   */
  async runLowTierResignCheck(): Promise<number> {
    // `excellence.low_tier_streak` 是服务端自己累加的全局状态（不是给人填的），保持全局一份。
    const streakCfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'excellence.low_tier_streak' },
    });
    const streak: Record<string, number> = (streakCfg?.value as Record<string, number>) || {};

    const companions = await this.prisma.companion.findMany({
      where: { isResigned: false },
      select: { id: true, studioId: true },
    });

    let resigned = 0;
    // 淘汰天数按店解析：每家店可以不一样，没配的店直接跳过（等于不自动离职）
    const resignDaysCache = new Map<string, number>();
    for (const c of companions) {
      const cacheKey = c.studioId ?? '__global__';
      if (!resignDaysCache.has(cacheKey)) {
        const scoped = await resolveConfigsRaw(this.prisma, c.studioId, [
          'excellence.low_tier_auto_resign_days',
        ]);
        resignDaysCache.set(cacheKey, Number(scoped['excellence.low_tier_auto_resign_days'] ?? 0));
      }
      const threshold = resignDaysCache.get(cacheKey) ?? 0;
      if (!Number.isFinite(threshold) || threshold <= 0) continue;
      const ex = await this.computeOne(c.id, c.studioId);
      if (ex.tier === 'LOW') {
        streak[c.id] = (streak[c.id] || 0) + 1;
        if (streak[c.id] >= threshold) {
          await this.prisma.companion.update({
            where: { id: c.id },
            data: {
              status: 'OFFLINE',
              balance: 0,
              deposit: 0,
              frozen: 0,
              monthlyRevenue: 0,
              isResigned: true,
            },
          }).catch(() => {});
          delete streak[c.id];
          resigned += 1;
        }
      } else if (streak[c.id]) {
        delete streak[c.id];
      }
    }

    await this.prisma.systemConfig.upsert({
      where: { key: 'excellence.low_tier_streak' },
      update: { value: streak },
      create: { key: 'excellence.low_tier_streak', value: streak },
    }).catch(() => {});

    return resigned;
  }

  async computeForCompanions(
    companionIds: string[],
    opts?: { studioId?: string | null },
  ): Promise<Map<string, ExcellenceResult>> {
    const result = new Map<string, ExcellenceResult>();
    if (companionIds.length === 0) return result;

    const scoreByTiers = (value: number, tiers: Array<{ min: number; score: number }>) => {
      let score = 0;
      for (const t of tiers) {
        if (value >= t.min) score = t.score;
      }
      return score;
    };

    // 评分口径按店解析（本店店长填的 → 老板全局默认），每家店的上等马线可以不一样。
    const SCORE_KEYS = [
      'excellence.revenue_tiers',
      'excellence.renew_tiers',
      'excellence.repurchase_tiers',
      'excellence.first_success_tiers',
      'excellence.excellent_threshold',
      'excellence.middle_tier_threshold',
    ];
    const scoreCfgCache = new Map<string, Record<string, any>>();
    const loadScoreCfg = async (studioId: string | null) => {
      const cacheKey = studioId ?? '__global__';
      if (!scoreCfgCache.has(cacheKey)) {
        scoreCfgCache.set(
          cacheKey,
          await resolveConfigsRaw(this.prisma, studioId, SCORE_KEYS),
        );
      }
      return scoreCfgCache.get(cacheKey)!;
    };
    const metricsFor = (cfg: Record<string, any>) => {
      const num = (v: any, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
      const parseTiers = (v: any, def: Array<{ min: number; score: number }>) => {
        if (Array.isArray(v) && v.length > 0) {
          return v
            .map((t: any) => ({ min: Number(t?.min) || 0, score: Number(t?.score) || 0 }))
            .sort((a, b) => a.min - b.min);
        }
        return def;
      };
      return {
        revenueTiers: parseTiers(cfg['excellence.revenue_tiers'], [
          { min: 0, score: 0 },
          { min: 3000, score: 20 },
          { min: 6000, score: 40 },
          { min: 10000, score: 50 },
        ]),
        renewTiers: parseTiers(cfg['excellence.renew_tiers'], [
          { min: 0, score: 0 },
          { min: 30, score: 10 },
          { min: 60, score: 20 },
        ]),
        repurchaseTiers: parseTiers(cfg['excellence.repurchase_tiers'], [
          { min: 0, score: 0 },
          { min: 30, score: 10 },
          { min: 60, score: 20 },
        ]),
        firstSuccessTiers: parseTiers(cfg['excellence.first_success_tiers'], [
          { min: 0, score: 0 },
          { min: 40, score: 5 },
          { min: 70, score: 10 },
        ]),
        excellentThreshold: num(cfg['excellence.excellent_threshold'], 50),
        middleTierThreshold: num(cfg['excellence.middle_tier_threshold'], 25),
      };
    };

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
      select: { id: true, bonusScore: true, studioId: true },
    });
    const bonusMap = new Map(bonusRows.map((b) => [b.id, b.bonusScore || 0]));
    const studioIdOfCompanion = new Map(bonusRows.map((b) => [b.id, b.studioId as string | null]));

    for (const [cid, s] of m) {
      const renewRate = s.count > 0 ? (s.renew / s.count) * 100 : 0;
      const repurchaseRate = s.count > 0 ? (s.repurchase / s.count) * 100 : 0;
      const grabCount = grabMap.get(cid) || 0;
      const customerCount = customerMap.get(cid) || 0;
      const firstSuccessRate = grabCount > 0 ? (customerCount / grabCount) * 100 : 0;
      const cfg = await loadScoreCfg(studioIdOfCompanion.get(cid) ?? opts?.studioId ?? null);
      const metrics = metricsFor(cfg);
      const revenue = monthlyRevenueMap.get(cid) || 0;
      const revenueScore = scoreByTiers(revenue, metrics.revenueTiers);
      const renewScore = scoreByTiers(renewRate, metrics.renewTiers);
      const repurchaseScore = scoreByTiers(repurchaseRate, metrics.repurchaseTiers);
      const firstSuccessScore = scoreByTiers(firstSuccessRate, metrics.firstSuccessTiers);
      const bonus = bonusMap.get(cid) || 0;
      const rankScore = Math.round(revenueScore + renewScore + repurchaseScore + firstSuccessScore + bonus);
      const tier = rankScore >= metrics.excellentThreshold
        ? 'TOP'
        : rankScore >= metrics.middleTierThreshold
          ? 'MIDDLE'
          : 'LOW';
      result.set(cid, {
        isExcellent: rankScore >= metrics.excellentThreshold,
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

  async computeOne(companionId: string, studioId?: string | null): Promise<ExcellenceResult> {
    const map = await this.computeForCompanions([companionId], { studioId });
    return map.get(companionId) ?? {
      isExcellent: false,
      tier: 'MIDDLE',
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
