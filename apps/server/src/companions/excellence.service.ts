// craftsman-ignore: TS001,TS003
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { settlementMonthRange } from '../common/business-day';
import { resolveConfigsRaw } from '../common/studio-config';
import { logger } from '../common/logger';

export interface ExcellenceResult {
  isExcellent: boolean;
  tier: string;
  rankScore: number;
  revenueScore: number;
  bonusScore: number;
  /** 另外三项的得分：以前不返回，客户端只能自己瞎猜（乘 0.2 / 0.1），跟真分对不上。 */
  renewScore: number;
  repurchaseScore: number;
  firstSuccessScore: number;
  /** 上等马线 / 中等马线：给「评分说明」页面显示用，和算段位用的是同一份配置。 */
  excellentThreshold: number;
  middleTierThreshold: number;
  renewRate: number;
  repurchaseRate: number;
  newRate: number;
  orderCount: number;
  /** 本月流水（元）：陪玩端「还差多少到下一档」要用。 */
  revenueYuan: number;
  /** 每一项「达到 X 得 Y 分」的完整档位表 + 战绩图每组加分：陪玩端「评分说明」显示规则用。 */
  revenueTiers: Array<{ min: number; score: number }>;
  renewTiers: Array<{ min: number; score: number }>;
  repurchaseTiers: Array<{ min: number; score: number }>;
  firstSuccessTiers: Array<{ min: number; score: number }>;
  battleScreenshotBonus: number;
}

/**
 * 陪玩段位综合分统一计算：
 * 综合分 = 月流水 + 续单率 + 复购率 + 首单成功率（每一项**取达到的最高一档**的分，不叠加）+ 战绩图加分。
 * 四项各自满分之和不超过 100（设置页与 `PUT /api/config` 两侧都拦）。
 * 该口径同时用于管理端「上等马/中等马/下等马」标记与订单池「上等马立刻看到」的延迟判断。
 */
@Injectable()
export class ExcellenceService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    // 下等马末位淘汰：每天检查一次（启动后 1 分钟先跑一次，之后每 24 小时）
    setTimeout(() => this.runLowTierResignCheck().catch(() => {}), 60 * 1000);
    setInterval(() => this.runLowTierResignCheck().catch(() => {}), 24 * 60 * 60 * 1000);

    // 每日段位复核（老板 2026-10-04）：「每天都重新检查他的各项指标重新扣分或者加分，
    // 然后进行等级的变换」。段位本来就是按当前指标实时算的（指标掉分就掉段，即降级），
    // 这里补的是「每天定点复核一次 + 把谁升了谁降了留档」，让老板第二天打开就看得到。
    setTimeout(() => this.runDailyTierCheck().catch(() => {}), 2 * 60 * 1000);
    this.scheduleDailyTierCheck();
  }

  /** 每天 12:05（营业日刚切完）复核一次全员段位。 */
  private scheduleDailyTierCheck() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(12, 5, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    setTimeout(() => {
      this.runDailyTierCheck().catch(() => {});
      setInterval(() => this.runDailyTierCheck().catch(() => {}), 24 * 60 * 60 * 1000);
    }, delay);
  }

  /**
   * 每日段位复核：全员按当前指标重算一次，和上一次快照比对，把**换了段位**的人记下来。
   *
   * 说明（老板 2026-10-04 定）：不做「额外扣分」那一套 —— 分数本来就是
   * 「月流水 + 续单率 + 复购率 + 首单成功率（每项取达到的最高一档）」实时算出来的，
   * 指标掉了那一项的分自然掉回去，段位跟着变，这就是降级。
   * 这里只负责「每天看一眼 + 留档」，不改任何算分口径。
   *
   * 快照存在 SystemConfig（服务端自己维护的状态，不是给人填的）：
   *  - `excellence.tier_snapshot`：companionId → 当前段位，用来跟下次比对；
   *  - `excellence.tier_changes` ：最近 200 条升降级记录（含时间、从哪段到哪段、当时多少分）。
   */
  async runDailyTierCheck(): Promise<number> {
    const companions = await this.prisma.companion.findMany({
      where: { isResigned: false },
      select: {
        id: true,
        studioId: true,
        user: { select: { username: true, displayName: true } },
      },
    });
    if (companions.length === 0) return 0;

    const results = await this.computeForCompanions(companions.map((c) => c.id));

    const snapCfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'excellence.tier_snapshot' },
    });
    const prev: Record<string, string> =
      snapCfg?.value && typeof snapCfg.value === 'object' && !Array.isArray(snapCfg.value)
        ? (snapCfg.value as Record<string, string>)
        : {};

    const now: Record<string, string> = {};
    const changes: Array<Record<string, unknown>> = [];
    const at = new Date().toISOString();
    for (const c of companions) {
      const r = results.get(c.id);
      if (!r) continue;
      now[c.id] = r.tier;
      const before = prev[c.id];
      // 第一次跑没有历史快照：只建档，不刷一屏"变动"。
      if (!before || before === r.tier) continue;
      changes.push({
        companionId: c.id,
        name: c.user?.displayName || c.user?.username || '',
        studioId: c.studioId,
        from: before,
        to: r.tier,
        score: r.rankScore,
        at,
      });
    }

    await this.prisma.systemConfig
      .upsert({
        where: { key: 'excellence.tier_snapshot' },
        update: { value: now },
        create: { key: 'excellence.tier_snapshot', value: now },
      })
      .catch(() => {});

    // 每日积分明细快照：给「陪玩端 今天加/扣了多少分」当基准。
    // 换天时把上一份挪到 prev，同一天重复跑只刷新当天这份。
    try {
      const snapKey = ExcellenceService.SCORE_SNAPSHOT_KEY;
      const prevKey = ExcellenceService.SCORE_SNAPSHOT_PREV_KEY;
      const todayKey = this.scoreDayKey();
      const items: Record<string, any> = {};
      for (const c of companions) {
        const r = results.get(c.id);
        if (r) items[c.id] = this.breakdownOf(r);
      }
      const scoreRow = await this.prisma.systemConfig.findUnique({ where: { key: snapKey } });
      const stored: any = scoreRow?.value || null;
      if (stored?.date && stored.date !== todayKey) {
        await this.prisma.systemConfig
          .upsert({
            where: { key: prevKey },
            update: { value: stored },
            create: { key: prevKey, value: stored },
          })
          .catch(() => {});
      }
      await this.prisma.systemConfig
        .upsert({
          where: { key: snapKey },
          update: { value: { date: todayKey, items } },
          create: { key: snapKey, value: { date: todayKey, items } },
        })
        .catch(() => {});
    } catch {
      // 快照写失败不影响段位复核本身
    }

    if (changes.length > 0) {
      const logCfg = await this.prisma.systemConfig.findUnique({
        where: { key: 'excellence.tier_changes' },
      });
      const oldLog = Array.isArray(logCfg?.value) ? (logCfg!.value as any[]) : [];
      const merged = [...changes, ...oldLog].slice(0, 200);
      await this.prisma.systemConfig
        .upsert({
          where: { key: 'excellence.tier_changes' },
          update: { value: merged },
          create: { key: 'excellence.tier_changes', value: merged },
        })
        .catch(() => {});
      logger.info('Daily tier check: tier changes recorded', {
        changed: changes.length,
        total: companions.length,
      });
    }

    return changes.length;
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

    // 打分口径（老板 2026-10-04 二次澄清）：「到了什么档次就给他重新统计为多少分，别叠加」。
    // 每一项是若干条「达到 X 得 Y 分」的档位，只取**达到的最高那一档**的 Y，不把几档加起来。
    // 例：流水填了「达到 6000 得 20 分」「达到 10000 得 40 分」，流水 10000 的人这一项就是 40 分。
    // 四项各自满分之和不能超过 100（设置页会实时提醒，`PUT /api/config` 也会拦）。
    const scoreOfHighestTier = (value: number, tiers: Array<{ min: number; score: number }>) => {
      let best: { min: number; score: number } | null = null;
      for (const t of tiers) {
        if (value >= t.min && (best === null || t.min >= best.min)) best = t;
      }
      return best ? best.score : 0;
    };

    // 评分口径按店解析（本店店长填的 → 老板全局默认），每家店的上等马线可以不一样。
    const SCORE_KEYS = [
      'excellence.revenue_tiers',
      'excellence.renew_tiers',
      'excellence.repurchase_tiers',
      'excellence.first_success_tiers',
      'excellence.excellent_threshold',
      'excellence.middle_tier_threshold',
      'excellence.battle_screenshot_bonus',
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
        battleScreenshotBonus: num(cfg['excellence.battle_screenshot_bonus'], 1),
      };
    };

    // ── 回头客口径（老板 2026-10-04 定稿）────────────────────────────────────
    // 老板原话：「假设这个陪玩一直跟某 2 个客户玩，流水达到 10000 了，也才 50 分，复购率百分百也才 20 分，
    //   这种陪玩没消耗工作室几个首单，但是也才 70 分，还没达到 90 分上等马，是不是不合理」。
    // 根因两个，一起改掉：
    //   ① 老口径「续单率 / 复购率」= 续单数 / 总单数、复购数 / 总单数 —— 两栏在分同一块蛋糕，
    //      全是复购的人续单率必然是 0，只吃老客的陪玩天花板被焊死在 70 分；
    //   ② 分母是「订单类型」，而线上几乎没人点「续单 / 复购」按钮（全库 0 条续单、1 条复购），
    //      这两栏实际上永远 0 分。
    // 新口径：**按客户算 + 只看最近 30 天**。同一个客户买第 2 单 = 回头（续单），买第 3 单起 = 常来（复购）；
    // 系统自己数订单，跟按钮怎么点没关系。两栏不再互斥，只吃老客的陪玩也能拿满，凑得上 90 分上等马。
    // 防刷：成交客户不足 3 人时，分母按 3 人算（只有 1 个客户时刷不出满分；2 个老客户的情况要达到
    //   60% 那一档正好需要 2/3=67%，所以「只跟 2 个老客玩」的陪玩照样能拿满两栏）。
    const RATE_WINDOW_DAYS = 30;
    const RATE_MIN_CUSTOMERS = 3;
    const rateWindowStart = new Date(Date.now() - RATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const m = new Map<string, { count: number; renew: number; repurchase: number }>();
    // 一单都没成交过的人也要有一份结果（哪怕全是 0）：否则调用方只能 ?? 兜底，
    // 「评分说明」里连上等马线都拿不到真实配置（老板 2026-10-04 顺手修）。
    for (const cid of companionIds) m.set(cid, { count: 0, renew: 0, repurchase: 0 });

    const windowOrders = await this.prisma.order.findMany({
      where: {
        companionId: { in: companionIds },
        status: 'DONE',
        createdAt: { gte: rateWindowStart },
      },
      select: { companionId: true, customerId: true },
    });
    // companionId -> (customerId -> 成单数)
    const perCustomer = new Map<string, Map<string, number>>();
    for (const o of windowOrders) {
      const s = m.get(o.companionId!);
      if (!s) continue;
      s.count += 1;
      let byCust = perCustomer.get(o.companionId!);
      if (!byCust) {
        byCust = new Map<string, number>();
        perCustomer.set(o.companionId!, byCust);
      }
      byCust.set(o.customerId, (byCust.get(o.customerId) || 0) + 1);
    }
    const customerCountByCompanion = new Map<string, number>();
    for (const [cid, byCust] of perCustomer) {
      const s = m.get(cid)!;
      customerCountByCompanion.set(cid, byCust.size);
      for (const n of byCust.values()) {
        if (n >= 2) s.renew += 1; // 回头客：同一个客户买过 ≥2 单
        if (n >= 3) s.repurchase += 1; // 常客：同一个客户买过 ≥3 单
      }
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
    // 首单成功率同样看最近 30 天（老板 2026-10-04：「比率改成最近 30 天」）。
    const newGrabs = await this.prisma.order.groupBy({
      by: ['companionId'],
      where: {
        companionId: { in: companionIds },
        type: 'NEW',
        createdAt: { gte: rateWindowStart },
      },
      _count: { id: true },
    });
    const grabMap = new Map(newGrabs.map((g) => [g.companionId!, g._count.id]));

    // 首单消费客户数：DONE 首单的去重客户数
    const doneNewCustomers = await this.prisma.order.findMany({
      where: {
        companionId: { in: companionIds },
        type: 'NEW',
        status: 'DONE',
        createdAt: { gte: rateWindowStart },
      },
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
      // 分母 = 最近 30 天的成交客户数（不足 RATE_MIN_CUSTOMERS 人按它算，防小样本刷满分）
      const rateDenom = Math.max(customerCountByCompanion.get(cid) ?? 0, RATE_MIN_CUSTOMERS);
      const renewRate = (s.renew / rateDenom) * 100;
      const repurchaseRate = (s.repurchase / rateDenom) * 100;
      const grabCount = grabMap.get(cid) || 0;
      const customerCount = customerMap.get(cid) || 0;
      const firstSuccessRate = grabCount > 0 ? (customerCount / grabCount) * 100 : 0;
      const cfg = await loadScoreCfg(studioIdOfCompanion.get(cid) ?? opts?.studioId ?? null);
      const metrics = metricsFor(cfg);
      const revenue = monthlyRevenueMap.get(cid) || 0;
      const revenueScore = scoreOfHighestTier(revenue, metrics.revenueTiers);
      const renewScore = scoreOfHighestTier(renewRate, metrics.renewTiers);
      const repurchaseScore = scoreOfHighestTier(repurchaseRate, metrics.repurchaseTiers);
      const firstSuccessScore = scoreOfHighestTier(firstSuccessRate, metrics.firstSuccessTiers);
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
        renewScore: Math.round(renewScore),
        repurchaseScore: Math.round(repurchaseScore),
        firstSuccessScore: Math.round(firstSuccessScore),
        excellentThreshold: metrics.excellentThreshold,
        middleTierThreshold: metrics.middleTierThreshold,
        renewRate: Math.round(renewRate),
        repurchaseRate: Math.round(repurchaseRate),
        newRate: Math.round(firstSuccessRate),
        orderCount: s.count,
        revenueYuan: Math.round(revenue),
        revenueTiers: metrics.revenueTiers,
        renewTiers: metrics.renewTiers,
        repurchaseTiers: metrics.repurchaseTiers,
        firstSuccessTiers: metrics.firstSuccessTiers,
        battleScreenshotBonus: metrics.battleScreenshotBonus,
      });
    }
    return result;
  }

  /** 每日积分快照的键（服务端自己维护的状态，不是给人填的配置）。 */
  private static readonly SCORE_SNAPSHOT_KEY = 'excellence.score_snapshot';
  private static readonly SCORE_SNAPSHOT_PREV_KEY = 'excellence.score_snapshot_prev';

  /** 本地日期键（YYYY-MM-DD），只用来判断「这份快照是不是今天的」。 */
  private scoreDayKey(d = new Date()): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** 一个人的四项明细 + 总分：存快照、算每日增减都用这一份。 */
  private breakdownOf(r: ExcellenceResult) {
    return {
      rankScore: r.rankScore,
      tier: r.tier,
      revenueScore: r.revenueScore,
      renewScore: r.renewScore,
      repurchaseScore: r.repurchaseScore,
      firstSuccessScore: r.firstSuccessScore,
      bonusScore: r.bonusScore,
      revenueYuan: r.revenueYuan,
      renewRate: r.renewRate,
      repurchaseRate: r.repurchaseRate,
      newRate: r.newRate,
    };
  }

  /**
   * 今日加减分（老板 2026-10-04）：「各种属于陪玩的 KPI 都让陪玩能看得到，
   * 每天的增减，让他扣或者加的心知肚明」。
   *
   * 跟「昨天定点那一刻的快照」比：总分差多少、哪一项加/扣了多少、指标值本身变了多少。
   * 还没攒到前一天快照（刚上线 / 新账号）就返回 hasBaseline=false，前端提示明天再看。
   */
  async getScoreDelta(companionId: string, current?: ExcellenceResult) {
    const [prevRow, cur] = await Promise.all([
      this.prisma.systemConfig.findUnique({
        where: { key: ExcellenceService.SCORE_SNAPSHOT_PREV_KEY },
      }),
      current ? Promise.resolve(current) : this.computeOne(companionId),
    ]);
    const prev: any = prevRow?.value || null;
    const base: any = prev?.items?.[companionId] || null;
    const now = this.breakdownOf(cur);

    const items = [
      { key: 'revenue', label: '月流水', unit: '元', now: now.revenueScore, before: base?.revenueScore ?? 0, value: now.revenueYuan, prevValue: base?.revenueYuan ?? 0 },
      { key: 'renew', label: '续单率', unit: '%', now: now.renewScore, before: base?.renewScore ?? 0, value: now.renewRate, prevValue: base?.renewRate ?? 0 },
      { key: 'repurchase', label: '复购率', unit: '%', now: now.repurchaseScore, before: base?.repurchaseScore ?? 0, value: now.repurchaseRate, prevValue: base?.repurchaseRate ?? 0 },
      { key: 'firstSuccess', label: '首单成功率', unit: '%', now: now.firstSuccessScore, before: base?.firstSuccessScore ?? 0, value: now.newRate, prevValue: base?.newRate ?? 0 },
      { key: 'bonus', label: '战绩图加分', unit: '分', now: now.bonusScore, before: base?.bonusScore ?? 0, value: now.bonusScore, prevValue: base?.bonusScore ?? 0 },
    ].map((d) => ({ ...d, delta: base ? d.now - d.before : 0 }));

    return {
      hasBaseline: !!base,
      baselineDate: prev?.date || null,
      total: now.rankScore,
      prevTotal: base?.rankScore ?? null,
      delta: base ? now.rankScore - base.rankScore : 0,
      tier: now.tier,
      prevTier: base?.tier ?? null,
      tierChanged: !!base && base.tier !== now.tier,
      items,
    };
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
      renewScore: 0,
      repurchaseScore: 0,
      firstSuccessScore: 0,
      // 兜底值只求不崩；正常路径（上面已经给每个人补了结果）拿到的都是真实配置。
      excellentThreshold: 50,
      middleTierThreshold: 25,
      renewRate: 0,
      repurchaseRate: 0,
      newRate: 0,
      orderCount: 0,
      revenueYuan: 0,
      revenueTiers: [],
      renewTiers: [],
      repurchaseTiers: [],
      firstSuccessTiers: [],
      battleScreenshotBonus: 0,
    };
  }
}
