// craftsman-ignore: TS001,TS003
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeCustomerRates } from '../common/customer-rates';
import { resolveConfigsRaw } from '../common/studio-config';
import { logger } from '../common/logger';

export interface ExcellenceResult {
  isExcellent: boolean;
  tier: string;
  rankScore: number;
  /** 段位分 = 四项 KPI 之和（最近 30 天业绩 + 续单率 + 复购率 + 首单成功率），**不含战绩图加分**；段位按它判。 */
  tierScore: number;
  revenueScore: number;
  bonusScore: number;
  /** 另外三项的得分：以前不返回，客户端只能自己瞎猜（乘 0.2 / 0.1），跟真分对不上。 */
  renewScore: number;
  repurchaseScore: number;
  firstSuccessScore: number;
  /** 上等马线 / 中等马线：给「评分说明」页面显示用，和算段位用的是同一份配置。 */
  excellentThreshold: number;
  middleTierThreshold: number;
  /** 最近 30 天业绩硬门槛（元）：没到这条线的人一律下等马，其他分再高也不算（老板 2026-10-04）。 */
  revenueFloor: number;
  renewRate: number;
  repurchaseRate: number;
  newRate: number;
  orderCount: number;
  /** 最近 30 天业绩（元）：陪玩端「还差多少到下一档」要用。 */
  revenueYuan: number;
  /** 每一项「达到 X 得 Y 分」的完整档位表 + 战绩图每组加分：陪玩端「评分说明」显示规则用。 */
  revenueTiers: Array<{ min: number; score: number }>;
  renewTiers: Array<{ min: number; score: number }>;
  repurchaseTiers: Array<{ min: number; score: number }>;
  firstSuccessTiers: Array<{ min: number; score: number }>;
  battleScreenshotBonus: number;
  /** 战绩图加分上限（分）：超过按上限算；只影响综合分 / 排行榜，不参与段位判定。 */
  battleScreenshotBonusCap: number;
}

/**
 * 陪玩段位统一计算（老板 2026-10-04 两次定稿）：
 *   · **段位分** = 最近 30 天业绩 + 续单率 + 复购率 + 首单成功率（每一项**取达到的最高一档**的分，
 *     不叠加）；四项满分之和不超过 100（设置页与 `PUT /api/config` 两侧都拦）。**段位只按段位分判**。
 *   · **综合分 / 排行榜分** = 段位分 + 战绩图加分（封顶 `excellence.battle_screenshot_bonus_cap`，默认 10）。
 *     战绩图加分**不参与段位判定** —— 否则「业绩、三率都不够，靠堆截图也能维持上等马」，
 *     老板原话：「全员都是上等马，岂不是就丧失评分系统的意义了」。
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
   * 「最近 30 天业绩 + 续单率 + 复购率 + 首单成功率（每项取达到的最高一档）」实时算出来的，
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
    // 过滤掉空值再判空：以前只判 `length === 0`，令牌里没有 companionId 时
    // 会带着 `undefined` 进 Prisma 的 `in: [...]`，直接抛 500（2026-10-04 线上探测时踩到）。
    const ids = companionIds.filter((id): id is string => !!id);
    if (ids.length === 0) return result;

    // 打分口径（老板 2026-10-04 二次澄清）：「到了什么档次就给他重新统计为多少分，别叠加」。
    // 每一项是若干条「达到 X 得 Y 分」的档位，只取**达到的最高那一档**的 Y，不把几档加起来。
    // 例：业绩填了「达到 6000 得 20 分」「达到 10000 得 40 分」，业绩 10000 的人这一项就是 40 分。
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
      'excellence.revenue_floor',
      'excellence.excellent_threshold',
      'excellence.middle_tier_threshold',
      'excellence.battle_screenshot_bonus',
      'excellence.battle_screenshot_bonus_cap',
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
        // 老板 2026-10-04 定稿、2026-10-05 选 B 微调的四个档位表（满分 45 + 20 + 20 + 10 = 95）：
        //   · 最近 30 天业绩：0 / 3000 / 6000 / 8000 / 10000 → 0 / 20 / 30 / 45 / 50；
        //   · 续单率、复购率：过 30% 得 10 分、过 50% 得 20 分；
        //   · 首单成功率：过 30% 得 5 分、过 50% 得 10 分。
        // 校验过的例子（上等马线 85）：
        //   业绩 8000 + 三率都过半 = 45+20+20+10 = 95 → 上等马（留 10 分缓冲）；
        //   业绩 10000 只吃老客（首单 0）= 50+20+20 = 90 → 上等马；
        //   业绩 6000 + 三率都过半 = 30+50 = 80 → 中等马。
        // **纯新客到不了高业绩**（老板 2026-10-04 指出）：抢单名额最多 3 单/天、每单约 1 小时、
        //   单价最高 45 元 → 打满 30 天也只有 3×45×30 ≈ 4050 元，够不到业绩硬门槛 → 必然下等马。
        //   换句话说，业绩要过 5200 / 8000 只能靠老客（续单 + 复购不占每日名额）——
        //   「业绩高」天然绑定「老客多」，正是老板要的「老客为王」。
        revenueTiers: parseTiers(cfg['excellence.revenue_tiers'], [
          { min: 0, score: 0 },
          { min: 3000, score: 20 },
          { min: 6000, score: 30 },
          { min: 8000, score: 45 },
          { min: 10000, score: 50 },
        ]),
        renewTiers: parseTiers(cfg['excellence.renew_tiers'], [
          { min: 0, score: 0 },
          { min: 30, score: 10 },
          { min: 50, score: 20 },
        ]),
        repurchaseTiers: parseTiers(cfg['excellence.repurchase_tiers'], [
          { min: 0, score: 0 },
          { min: 30, score: 10 },
          { min: 50, score: 20 },
        ]),
        firstSuccessTiers: parseTiers(cfg['excellence.first_success_tiers'], [
          { min: 0, score: 0 },
          { min: 30, score: 5 },
          { min: 50, score: 10 },
        ]),
        excellentThreshold: num(cfg['excellence.excellent_threshold'], 85),
        middleTierThreshold: num(cfg['excellence.middle_tier_threshold'], 60),
        // 最近 30 天业绩硬门槛（老板 2026-10-04）：「最近 30 天业绩没过 5200 在我眼里就是下等马，
        // 就算他各种 KPI 都高」。填 0 = 关掉这条硬线，退回纯分数判段位。
        revenueFloor: num(cfg['excellence.revenue_floor'], 5200),
        battleScreenshotBonus: num(cfg['excellence.battle_screenshot_bonus'], 1),
        // 战绩图加分封顶（老板 2026-10-04）：传图不能无限刷「综合分 / 排行榜」。
        // 填 0 或负数 = 不封顶。注意它只影响排行榜 —— 段位只认四项 KPI（见下面 compute）。
        battleScreenshotBonusCap: num(cfg['excellence.battle_screenshot_bonus_cap'], 10),
      };
    };

    // ── 回头客口径（老板 2026-10-04 定稿）────────────────────────────────────
    // 老板原话：「假设这个陪玩一直跟某 2 个客户玩，业绩达到 10000 了，也才 50 分，复购率百分百也才 20 分，
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
    // 第三版（老板 2026-10-04 再次定稿，替换上面的「第 2 单算续单 / 第 3 单算复购」）：
    //   · 续单 = 该客户在你这有**第 2 段及以后会话**（点「续单」加出来的那段），或有一张 RENEW / REPURCHASE 成交单；
    //   · 复购 = 打完首单 / 续单后，**隔了一个营业日**客户又来打（另有一张成交单）；
    //   · 首单成功率 = 成交首单客户数 / 「添加成功」数；
    //   · 续单率 / 复购率分母统一 = **打了首单的客户数**；窗口 = 最近 30 天；营业日以 **12:00** 为界。
    // 「12:00 前接着打」走的是同一张单里的第 2 段会话（续单），「过了中午 12 点」会另开一张复购单；
    // 两栏**不互斥**：隔天回头的客户两边都算，只吃老客的陪玩也能拿满。
    // 第四版（老板 2026-10-05）：「只有真有 DONE 单才计入续单率 / 复购率 —— 不结束、还没打完你怎么计算？」
    //   → 父单必须 DONE（本来已是），**段也必须打完（会话 DONE）**：点了续单、还在打的不算。
    // 第五版（老板 2026-10-05 又一句）：「（首单成功率）我什么时候说过，不打完怎么算？」
    //   → 首单成功率也统一到「打完才算」：分子从「点过『开始首单』（开过会话）」改成
    //     「这张首单**打完了**（父单 DONE）」的客户数。三率现在同一个口径：都要 DONE。
    // 第六版（老板 2026-10-07）：「钱鸿鸣虽然被邀请，但是事实是没续单，应该被统计进去」——
    //   **双陪单里当搭档（被主陪邀请）打的，也算他服务过这个客户**：
    //   分母（打过首单的客户）把他算进去；分子（续单 / 复购）只认**他参与过的那次**。
    //   事实是没续单 → 分母照加、分子不给：既不白捡（别人跟这个客户续单不算他的），
    //   也不当没打过（他自己那一栏看得见这个客户）。一句话：**这张单我出力了（主陪或搭档），就记在我头上**。
    //   边界（不动老口径）：一个客户只在「他当搭档的续单 / 复购单」里出现过、没有他参与的首单 →
    //   不进分母也不进分子（分子永远只在「打过首单的客户」里数，防止比率 >100%）。
    const RATE_WINDOW_DAYS = 30;
    const rateWindowStart = new Date(Date.now() - RATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // 一单都没成交过的人也要有一份结果（哪怕全是 0）：helper 会给名单里每个人都建一行。

    // 老板 2026-10-07：「双陪单里被邀请（当搭档）打的，也算他服务过这个客户」——
    // 所以取「他参与过的单」而不是「他当主陪的单」：一张双陪单同时记在主陪和搭档两个人头上。
    const windowOrders = await this.prisma.order.findMany({
      where: {
        OR: [{ companionId: { in: ids } }, { coCompanionId: { in: ids } }],
        status: 'DONE',
        createdAt: { gte: rateWindowStart },
      },
      select: {
        companionId: true,
        coCompanionId: true,
        customerId: true,
        type: true,
        createdAt: true,
      },
    });
    // 老板 2026-10-05：「不结束、还没打完你怎么计算？」——除了父单要是 DONE（上面已卡），
    // **段**也要打完才算数：陪玩点了「续单」开了第 2 段、但那段还在打（会话 ACTIVE）的先不算。
    // 修前读的是父单的 `_count.sessions`（不分段状态），点了续单即刻就计 —— 正是这个洞。
    // 段按**实际打这一段的人**归户（会话上的主陪 + 搭档，缺了退回父单上的），
    // 这样搭档也拿得到「他参与过的那次续单」。
    const windowDoneSessions = await this.prisma.orderSession.findMany({
      where: {
        status: 'DONE',
        parentOrder: {
          OR: [{ companionId: { in: ids } }, { coCompanionId: { in: ids } }],
          status: 'DONE',
          createdAt: { gte: rateWindowStart },
        },
      },
      select: {
        companionId: true,
        coCompanionId: true,
        parentOrder: { select: { companionId: true, coCompanionId: true, customerId: true } },
      },
    });
    // 算法本体在 `common/customer-rates.ts`（**全站唯一一份**）：同一段判定同时喂给
    // 优秀度 / 陪玩 KPI 和每日数据，保证「同一个单里加打一段」这种续单两边都算（老板 2026-10-08）。
    const rates = computeCustomerRates(
      ids,
      windowOrders.map((o) => ({
        type: o.type,
        customerId: o.customerId,
        companionId: o.companionId,
        coCompanionId: (o as any).coCompanionId,
        createdAt: o.createdAt,
      })),
      windowDoneSessions.map((seg: any) => ({
        customerId: seg.parentOrder?.customerId ?? null,
        companionId: seg.companionId ?? null,
        coCompanionId: seg.coCompanionId ?? null,
        parentCompanionId: seg.parentOrder?.companionId ?? null,
        parentCoCompanionId: seg.parentOrder?.coCompanionId ?? null,
      })),
    );
    // 最近 30 天业绩（老板 2026-10-04：「所有指标都按照最近 30 天统计」）：
    //   原来按「营业月」（当月 1 日 12:00 至次月 1 日 12:00）取，月初几天全员业绩从 0 起算，
    //   连最厉害的陪玩也会暂时掉成下等马；改成滚动 30 天，跟续单率 / 复购率 / 首单成功率同窗口，
    //   月初不再清零。变量名仍叫 monthlyRevenue*（避免牵动前端与快照结构），语义已是「最近 30 天」。
    // 口径（老板 2026-10-07「口径 A：谁的钱算谁的」）：主陪算 amount、搭档算 coAmount，
    // 两条一起进「最近 30 天业绩」。以前只按 companionId 汇总 amount，常当搭档的人这一段被少算，
    // 跟首页「本月业绩」对不上（同一页两个业绩不是一回事）。
    const [mainRevenue, coRevenue] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['companionId'],
        where: {
          companionId: { in: ids },
          status: 'DONE',
          type: { in: ['NEW', 'RENEW', 'REPURCHASE'] },
          createdAt: { gte: rateWindowStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.order.groupBy({
        by: ['coCompanionId'],
        where: {
          coCompanionId: { in: ids },
          status: 'DONE',
          type: { in: ['NEW', 'RENEW', 'REPURCHASE'] },
          createdAt: { gte: rateWindowStart },
        },
        _sum: { coAmount: true },
      }),
    ]);
    const monthlyRevenueMap = new Map<string, number>();
    for (const r of mainRevenue) {
      if (!r.companionId) continue;
      monthlyRevenueMap.set(r.companionId, (monthlyRevenueMap.get(r.companionId) || 0) + (r._sum.amount || 0));
    }
    for (const r of coRevenue) {
      if (!r.coCompanionId) continue;
      monthlyRevenueMap.set(r.coCompanionId, (monthlyRevenueMap.get(r.coCompanionId) || 0) + (r._sum.coAmount || 0));
    }

    // 首单成功率（老板 2026-10-04 分母口径 + 2026-10-05 分子口径）：
    //   分子 = 「成交首单」的客户数 —— **这张首单打完了（父单 DONE）才算成交**
    //          （老板 2026-10-05：「我什么时候说过，不打完怎么算？」）；
    //   分母 = 「添加成功」的**客户数** —— 同一个客户重复抢单只算一个，免得分母被重复单抬高；
    //          加了微信却没打成的也一样进分母（这才是成功率的意义）。
    // 退款单（陪玩「申请补单」批下来的单）**不参与 KPI**（老板 2026-10-11）：
    // 这张单官方作废了，就不该再拉低他的首单成功率 —— 跟「续单率 / 复购率 / 业绩」只认 DONE 一个道理。
    const addedOrders = await this.prisma.order.findMany({
      where: {
        companionId: { in: ids },
        type: 'NEW',
        contactStatus: 'added',
        refundedAt: null,
        createdAt: { gte: rateWindowStart },
      },
      select: { companionId: true, customerId: true },
    });
    const addedCustomers = new Map<string, Set<string>>();
    for (const o of addedOrders) {
      if (!o.companionId || !o.customerId) continue;
      let set = addedCustomers.get(o.companionId);
      if (!set) {
        set = new Set<string>();
        addedCustomers.set(o.companionId, set);
      }
      set.add(o.customerId);
    }
    // 成交首单的客户：这张首单**打完了**才算 —— 上面那份 windowOrders 本来就是「DONE + 窗口内」，
    // 直接拿来数首单，不再另查一份「开过会话就算」的（那个口径把还在打的单也算成交，已作废）。
    const firstSuccessCustomers = new Map<string, Set<string>>();
    for (const o of windowOrders) {
      if (!o.companionId || !o.customerId) continue;
      if (o.type !== 'NEW') continue;
      let set = firstSuccessCustomers.get(o.companionId);
      if (!set) {
        set = new Set<string>();
        firstSuccessCustomers.set(o.companionId, set);
      }
      set.add(o.customerId);
    }

    // 战绩图采纳加分：直接叠加到综合分。
    const bonusRows = await this.prisma.companion.findMany({
      where: { id: { in: ids } },
      select: { id: true, bonusScore: true, studioId: true },
    });
    const bonusMap = new Map(bonusRows.map((b) => [b.id, b.bonusScore || 0]));
    const studioIdOfCompanion = new Map(bonusRows.map((b) => [b.id, b.studioId as string | null]));

    for (const [cid, s] of rates) {
      // 分母统一 = 打了首单的客户数（老板 2026-10-04）
      const rateDenom = s.firstCustomers;
      const renewRate = rateDenom > 0 ? (s.renew / rateDenom) * 100 : 0;
      const repurchaseRate = rateDenom > 0 ? (s.repurchase / rateDenom) * 100 : 0;
      const addedCount = addedCustomers.get(cid)?.size || 0;
      // 成交首单客户数 = **打完的**首单客户数（老板 2026-10-05：「不打完怎么算？」）；
      // 理论上不会超过分母，超了就按 100% 封顶。
      const customerCount = firstSuccessCustomers.get(cid)?.size || 0;
      const firstSuccessRate = addedCount > 0 ? Math.min(100, (customerCount / addedCount) * 100) : 0;
      const cfg = await loadScoreCfg(studioIdOfCompanion.get(cid) ?? opts?.studioId ?? null);
      const metrics = metricsFor(cfg);
      const revenue = monthlyRevenueMap.get(cid) || 0;
      const revenueScore = scoreOfHighestTier(revenue, metrics.revenueTiers);
      const renewScore = scoreOfHighestTier(renewRate, metrics.renewTiers);
      const repurchaseScore = scoreOfHighestTier(repurchaseRate, metrics.repurchaseTiers);
      const firstSuccessScore = scoreOfHighestTier(firstSuccessRate, metrics.firstSuccessTiers);
      const rawBonus = bonusMap.get(cid) || 0;
      // 战绩图加分封顶（老板 2026-10-04：不能靠堆截图刷分）。填 0 或负数 = 不封顶。
      const bonus = metrics.battleScreenshotBonusCap > 0
        ? Math.min(rawBonus, metrics.battleScreenshotBonusCap)
        : rawBonus;
      // **段位分** = 四项 KPI（不含战绩图）；**综合分** = 段位分 + 战绩图加分（只用于排行榜 / 展示）。
      // 老板 2026-10-04 原话：「如果陪玩 80 分……他去上传几十张战绩图，这分岂不是一直维持在上等马上？
      // 全员都是上等马，岂不是就丧失评分系统的意义了」—— 所以段位必须只看 KPI。
      const tierScore = Math.round(revenueScore + renewScore + repurchaseScore + firstSuccessScore);
      const rankScore = Math.round(tierScore + bonus);
      // 段位（老板 2026-10-04 定稿，比分数更硬的一条线）：
      //   ① 先按**段位分**分档：够上等马线 → 上等马，够中等马线 → 中等马，其余下等马；
      //   ② **最近 30 天业绩没到硬门槛**（默认 5200 元）的人，一律下等马 —— KPI 再高也不算。
      //      老板原话：「最近 30 天业绩没过 5200 在我眼里就是下等马，就算他各种 KPI 都高……
      //      那就只有一个原因，他工作时间短、来得晚走得早，给工作室创造不了多少价值」；
      //   ③ 反过来，**业绩达标的人最低也是中等马**（「要的少、挣得少可以理解，
      //      留着他也妨」，除了浪费点电费没有别的损失）。
      let tier: 'TOP' | 'MIDDLE' | 'LOW' = tierScore >= metrics.excellentThreshold
        ? 'TOP'
        : tierScore >= metrics.middleTierThreshold
          ? 'MIDDLE'
          : 'LOW';
      if (metrics.revenueFloor > 0) {
        if (revenue < metrics.revenueFloor) tier = 'LOW';
        else if (tier === 'LOW') tier = 'MIDDLE';
      }
      result.set(cid, {
        isExcellent: tier === 'TOP',
        tier,
        rankScore,
        tierScore,
        revenueScore: Math.round(revenueScore),
        bonusScore: bonus,
        renewScore: Math.round(renewScore),
        repurchaseScore: Math.round(repurchaseScore),
        firstSuccessScore: Math.round(firstSuccessScore),
        excellentThreshold: metrics.excellentThreshold,
        middleTierThreshold: metrics.middleTierThreshold,
        revenueFloor: metrics.revenueFloor,
        renewRate: Math.round(renewRate),
        repurchaseRate: Math.round(repurchaseRate),
        newRate: Math.round(firstSuccessRate),
        orderCount: s.orderCount,
        revenueYuan: Math.round(revenue),
        revenueTiers: metrics.revenueTiers,
        renewTiers: metrics.renewTiers,
        repurchaseTiers: metrics.repurchaseTiers,
        firstSuccessTiers: metrics.firstSuccessTiers,
        battleScreenshotBonus: metrics.battleScreenshotBonus,
        battleScreenshotBonusCap: metrics.battleScreenshotBonusCap,
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
      tierScore: r.tierScore,
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
      { key: 'revenue', label: '最近 30 天业绩', unit: '元', now: now.revenueScore, before: base?.revenueScore ?? 0, value: now.revenueYuan, prevValue: base?.revenueYuan ?? 0 },
      { key: 'renew', label: '续单率', unit: '%', now: now.renewScore, before: base?.renewScore ?? 0, value: now.renewRate, prevValue: base?.renewRate ?? 0 },
      { key: 'repurchase', label: '复购率', unit: '%', now: now.repurchaseScore, before: base?.repurchaseScore ?? 0, value: now.repurchaseRate, prevValue: base?.repurchaseRate ?? 0 },
      { key: 'firstSuccess', label: '首单成功率', unit: '%', now: now.firstSuccessScore, before: base?.firstSuccessScore ?? 0, value: now.newRate, prevValue: base?.newRate ?? 0 },
      // 战绩图加分不参与段位，就不放进这份清单（免得各行加起来跟总分对不上，老板 2026-10-04）。
    ].map((d) => ({ ...d, delta: base ? d.now - d.before : 0 }));

    // 段位分：老快照里没有这个字段（本次新增），退回用当时的综合分当基准
    // （绝大多数人战绩图加分是 0，两者相等）。
    const prevTierScore = base
      ? (typeof base.tierScore === 'number' ? base.tierScore : (base.rankScore ?? 0))
      : 0;

    return {
      hasBaseline: !!base,
      baselineDate: prev?.date || null,
      total: now.tierScore,
      prevTotal: base ? prevTierScore : null,
      delta: base ? now.tierScore - prevTierScore : 0,
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
      tierScore: 0,
      revenueScore: 0,
      bonusScore: 0,
      renewScore: 0,
      repurchaseScore: 0,
      firstSuccessScore: 0,
      // 兜底值只求不崩；正常路径（上面已经给每个人补了结果）拿到的都是真实配置。
      excellentThreshold: 90,
      middleTierThreshold: 60,
      revenueFloor: 5200,
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
      battleScreenshotBonusCap: 0,
    };
  }
}
