// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExcellenceService } from '../companions/excellence.service';
import { businessDayKey, currentBusinessDayRange } from '../common/business-day';
import { logger } from '../common/logger';
import { resolveConfigsRaw } from '../common/studio-config';

/**
 * 陪玩「每日抢单名额」（按下等马 / 中等马 / 上等马发放，没用完的自动累计）。
 *
 * 老板 2026-09-20 拍板：不再用「业绩门槛」卡抢单，改成「每天按段位发几个客户名额」。
 * 老板 2026-10-04 补充（本次）：
 * - 名额**在抢单那一刻就扣**，不是「添加成功 / 转账了才算一单」——防止有人一直不点添加成功就一直抢；
 * - **线下工作室（Studio.type = DIRECT）的预约单也占名额**；
 *   客服指定单、陪玩自己发布的单不占（没消耗工作室资源）；没绑工作微信的点不了抢单（另有拦截）。
 *   线上俱乐部（RENTAL）维持原样：只有「立即打」占名额。
 * - 补单：陪玩点「添加失败」→ 管理端同意补单 → 他的次数 **+1**（写一笔 SUPPLEMENT）。
 * - 每一次名额变动都写一行 `CompanionQuotaLog`，陪玩端点开「今日名额」就能看到每天加了多少、用了多少。
 * - 名额惰性发放：谁打开订单池 / 抢单时才结算，避免空转定时任务。
 */
const DEFAULT_LIMITS: Record<string, number> = { TOP: 3, MIDDLE: 2, LOW: 1 };

const LIMIT_KEYS: Record<string, string> = {
  TOP: 'dispatch.top_tier_daily_new_limit',
  MIDDLE: 'dispatch.middle_tier_daily_new_limit',
  LOW: 'dispatch.low_tier_daily_new_limit',
};

const DAY_MS = 24 * 3600 * 1000;

/** 名额变动原因（写进 CompanionQuotaLog.reason；前端按这个写人话）。 */
export const QUOTA_REASON = {
  GRANT: 'GRANT', // 每日发放
  GRAB: 'GRAB', // 抢单扣减
  REFUND: 'REFUND', // 抢单失败 / 订单被取消，退回
  SUPPLEMENT: 'SUPPLEMENT', // 管理端同意补单，返还
  ADJUST: 'ADJUST', // 人工调整
} as const;

/** 「昨天 / 前天 / 明天」那套按营业日算；键都是本地日期 YYYY-MM-DD。 */
function keyToLocalDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function localDateToKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 读出「上次发放到哪个营业日」。
 * 老数据存的是「营业日 0 点」这种纯日期值（本身已经是日期键，不能再往前挪一天），
 * 新数据存的是发放那一刻的时间戳（要按 12 点规则归到所属营业日）。
 */
function grantedDayKey(value: Date): string {
  const d = new Date(value.getTime());
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
    return localDateToKey(d);
  }
  return businessDayKey(d);
}

/** fromKey（不含）到 toKey（含）之间的营业日键，最多回看 180 天（防脏数据刷爆台账）。 */
function dayKeysBetween(fromKey: string | null, toKey: string): string[] {
  const end = keyToLocalDate(toKey);
  const keys: string[] = [];
  let cur = fromKey ? keyToLocalDate(fromKey) : new Date(end.getTime() - DAY_MS);
  for (let i = 0; i < 180; i += 1) {
    cur = new Date(cur.getTime() + DAY_MS);
    if (cur.getTime() > end.getTime()) break;
    keys.push(localDateToKey(cur));
  }
  return keys;
}

@Injectable()
export class CompanionQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excellence: ExcellenceService,
  ) {}

  /**
   * 这张单要不要占名额（老板 2026-10-04 口径）。
   * - 陪玩自己发布的单：不占（没消耗工作室资源）
   * - 客服指定单：走不到抢单这条路（DIRECT 单不经过池子），也就不占
   * - 「立即打」：占
   * - 预约单：线下工作室占；线上俱乐部不占
   */
  countsOrder(input: { isPeerOrder?: boolean; isImmediate?: boolean; studioType?: string | null }): boolean {
    if (input.isPeerOrder) return false;
    if (input.isImmediate) return true;
    return input.studioType === 'DIRECT';
  }

  /** 某张单所在工作室的类型（线下 DIRECT / 线上俱乐部 RENTAL）；查不到按线下算。 */
  async studioTypeOf(studioId?: string | null): Promise<string> {
    if (!studioId) return 'DIRECT';
    const studio = await this.prisma.studio
      .findUnique({ where: { id: studioId }, select: { type: true } })
      .catch(() => null);
    return studio?.type || 'DIRECT';
  }

  /** 当前段位对应的每日名额 + 他所在工作室的类型（线下 DIRECT / 线上俱乐部 RENTAL）。 */
  async limitFor(companionId: string): Promise<{ tier: string; limit: number; studioType: string }> {
    const [ex, companion] = await Promise.all([
      this.excellence.computeOne(companionId).catch(() => null),
      this.prisma.companion
        .findUnique({
          where: { id: companionId },
          select: { studioId: true, studio: { select: { type: true } } },
        })
        .catch(() => null),
    ]);
    const tier = ex?.tier || 'MIDDLE';
    const key = LIMIT_KEYS[tier] || LIMIT_KEYS.MIDDLE;
    // 每日名额按店解析：本店店长填的优先，没填才用老板全局默认
    const cfg = await resolveConfigsRaw(this.prisma, companion?.studioId, [key]);
    const raw = Number(cfg[key]);
    const limit = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_LIMITS[tier] ?? 2;
    return { tier, limit, studioType: companion?.studio?.type || 'DIRECT' };
  }

  /** 记一笔名额业绩（失败不影响主流程）。 */
  private async log(
    companionId: string,
    delta: number,
    reason: string,
    ref?: { refId?: string | null; note?: string | null; studioId?: string | null; dayKey?: string },
  ): Promise<void> {
    if (!delta) return;
    await this.prisma.companionQuotaLog
      .create({
        data: {
          companionId,
          studioId: ref?.studioId ?? null,
          delta,
          reason,
          refId: ref?.refId ?? null,
          note: ref?.note ?? null,
          dayKey: ref?.dayKey || businessDayKey(new Date()),
        },
      })
      .catch((err) => {
        logger.warn('Quota log write failed', { companionId, reason, delta, error: (err as Error).message });
      });
  }

  /**
   * 惰性发放：把「上次发放日 → 今天」这段时间每个营业日的名额补进余额。
   * 首次遇到某个人只发今天的（不追溯历史，否则老账号会一次拿到几百个）。
   *
   * 注意（2026-09-20 踩过的坑）：比较必须用**营业日日期键**，不能把存进去的时间戳
   * 再喂给 businessDayOf 一次——存的是「营业日 0 点」，0 点 < 12 点又会被算成前一天，
   * 结果是每次调用都重新发一天的名额，名额永远用不完。
   */
  async ensure(companionId: string): Promise<{ balance: number; granted: number } | null> {
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { studioId: true, quotaBalance: true, quotaGrantedThrough: true },
    });
    if (!companion) return null;

    const todayKey = businessDayKey(new Date());
    const throughKey = companion.quotaGrantedThrough ? grantedDayKey(companion.quotaGrantedThrough) : null;
    const { limit } = await this.limitFor(companionId);

    if (throughKey && throughKey === todayKey) {
      return { balance: companion.quotaBalance, granted: 0 };
    }

    const dayKeys = dayKeysBetween(throughKey, todayKey);
    const days = dayKeys.length || 1;
    const grant = days * limit;
    const updated = await this.prisma.companion.update({
      where: { id: companionId },
      data: { quotaBalance: { increment: grant }, quotaGrantedThrough: new Date() },
      select: { quotaBalance: true },
    });
    if (grant > 0) {
      logger.info('Companion quota granted', { companionId, days, limit, grant, balance: updated.quotaBalance });
      // 台账：一天一行（太多时压成一行汇总，避免补发上百天刷出上百行）
      if (dayKeys.length > 1 && dayKeys.length <= 31) {
        for (const key of dayKeys) {
          await this.log(companionId, limit, QUOTA_REASON.GRANT, {
            studioId: companion.studioId,
            dayKey: key,
            note: '每日名额',
          });
        }
      } else {
        await this.log(companionId, grant, QUOTA_REASON.GRANT, {
          studioId: companion.studioId,
          dayKey: todayKey,
          note: dayKeys.length > 31 ? `补发 ${days} 天名额（合并）` : '每日名额',
        });
      }
    }
    return { balance: updated.quotaBalance, granted: grant };
  }

  /** 扣名额（并发安全：余额不足时扣不动） */
  async consume(companionId: string, amount = 1): Promise<boolean> {
    const res = await this.prisma.companion.updateMany({
      where: { id: companionId, quotaBalance: { gte: amount } },
      data: { quotaBalance: { decrement: amount } },
    });
    return res.count > 0;
  }

  /**
   * 先扣名额再抢单：抢单动作与名额扣除的顺序反过来，
   * 避免并发下「两个人都通过了余额检查」导致抢到单的人没扣到名额。
   * 扣成了就写一笔 GRAB 台账（带订单号，方便陪玩端/管理端对账）。
   */
  async reserve(
    companionId: string,
    amount = 1,
    ref?: { refId?: string | null; note?: string | null },
  ): Promise<{ ok: boolean; tier: string; dailyLimit: number; balance: number }> {
    const { tier, limit } = await this.limitFor(companionId);
    await this.ensure(companionId);
    const ok = await this.consume(companionId, amount);
    if (!ok) {
      const after = await this.ensure(companionId);
      return { ok: false, tier, dailyLimit: limit, balance: after?.balance ?? 0 };
    }
    const companion = await this.prisma.companion
      .findUnique({ where: { id: companionId }, select: { studioId: true, quotaBalance: true } })
      .catch(() => null);
    await this.log(companionId, -amount, QUOTA_REASON.GRAB, {
      refId: ref?.refId ?? null,
      note: ref?.note ?? '抢单扣名额',
      studioId: companion?.studioId ?? null,
    });
    return { ok: true, tier, dailyLimit: limit, balance: companion?.quotaBalance ?? 0 };
  }

  /** 归还名额（抢单失败 / 订单被取消等场景） */
  async refund(companionId: string, amount = 1, ref?: { refId?: string | null; note?: string | null }): Promise<void> {
    const updated = await this.prisma.companion
      .update({
        where: { id: companionId },
        data: { quotaBalance: { increment: amount } },
        select: { studioId: true },
      })
      .catch(() => null);
    await this.log(companionId, amount, QUOTA_REASON.REFUND, {
      refId: ref?.refId ?? null,
      note: ref?.note ?? '抢单失败退回',
      studioId: updated?.studioId ?? null,
    });
  }

  /** 加名额（管理端同意补单 / 人工调整），带台账。 */
  async credit(
    companionId: string,
    amount: number,
    reason: string = QUOTA_REASON.SUPPLEMENT,
    ref?: { refId?: string | null; note?: string | null },
  ): Promise<number> {
    if (!amount) {
      const cur = await this.prisma.companion
        .findUnique({ where: { id: companionId }, select: { quotaBalance: true } })
        .catch(() => null);
      return cur?.quotaBalance ?? 0;
    }
    const updated = await this.prisma.companion
      .update({
        where: { id: companionId },
        data: { quotaBalance: { increment: amount } },
        select: { studioId: true, quotaBalance: true },
      })
      .catch(() => null);
    await this.log(companionId, amount, reason, {
      refId: ref?.refId ?? null,
      note: ref?.note ?? null,
      studioId: updated?.studioId ?? null,
    });
    return updated?.quotaBalance ?? 0;
  }

  /**
   * 抢单池页面用的状态：还剩几个名额 + 今天用了几个 + 最近 14 天每天加/用了多少 + 最近 20 笔明细。
   */
  async status(companionId: string) {
    const ensured = await this.ensure(companionId);
    const { tier, limit } = await this.limitFor(companionId);

    const since = new Date(keyToLocalDate(businessDayKey(new Date())).getTime() - 13 * DAY_MS);
    const logs = await this.prisma.companionQuotaLog
      .findMany({
        where: { companionId, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 400,
        select: { id: true, delta: true, reason: true, refId: true, note: true, dayKey: true, createdAt: true },
      })
      .catch(() => [] as any[]);

    const todayKey = businessDayKey(new Date());
    const byDay = new Map<string, { dayKey: string; granted: number; used: number; net: number }>();
    for (const row of logs) {
      const key = row.dayKey || businessDayKey(new Date(row.createdAt));
      const item = byDay.get(key) || { dayKey: key, granted: 0, used: 0, net: 0 };
      item.net += row.delta;
      if (row.delta > 0) item.granted += row.delta;
      else item.used += -row.delta;
      byDay.set(key, item);
    }
    const days = [...byDay.values()].sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1));

    const todayFromLogs = byDay.get(todayKey)?.used ?? 0;
    // 台账是今天才开始记的：当天还没有 GRAB 业绩时，退回按「今天抢到的单」估一个数，
    // 免得刚上线那半天「今日已用」一直是 0。有业绩就一律以业绩为准。
    const rolledToday = logs.some((r) => r.reason === QUOTA_REASON.GRAB && (r.dayKey || '') === todayKey);
    let usedToday = todayFromLogs;
    if (!rolledToday) {
      const { start, end } = currentBusinessDayRange();
      const grabbed = await this.prisma.order
        .findMany({
          where: {
            companionId,
            grabbedAt: { gte: start, lt: end },
            status: { not: 'CANCELLED' },
          },
          select: { customFields: true },
        })
        .catch(() => [] as any[]);
      usedToday = grabbed.filter((o: any) => (o.customFields as any)?.urgency !== 'later').length;
    }

    return {
      tier,
      dailyLimit: limit,
      balance: ensured?.balance ?? 0,
      usedToday,
      // 今天还能抢几个
      remaining: ensured?.balance ?? 0,
      todayGranted: byDay.get(todayKey)?.granted ?? 0,
      days,
      recentLogs: logs.slice(0, 20),
    };
  }
}
