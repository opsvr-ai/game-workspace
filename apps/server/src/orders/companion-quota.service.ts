import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExcellenceService } from '../companions/excellence.service';
import { businessDayOf, currentBusinessDayRange } from '../common/business-day';
import { logger } from '../common/logger';

/**
 * 每日「立即打」抢单名额。
 *
 * 老板 2026-09-20 拍板：不再用「流水门槛」卡抢单，改成
 * 「每天按段位发 1~3 个现在就打的客户名额，没用完的自动累计」。
 * - 上等马 / 中等马 / 下等马 分别由 dispatch.*_tier_daily_new_limit 配置（线上 3 / 2 / 1）
 * - 只对「立即打」的抢单扣名额；预约单、客服指定单、陪玩自己发的单都不扣
 * - 名额惰性发放：谁打开订单池 / 抢单时才结算，避免空转定时任务
 */
const DEFAULT_LIMITS: Record<string, number> = { TOP: 3, MIDDLE: 2, LOW: 1 };

const LIMIT_KEYS: Record<string, string> = {
  TOP: 'dispatch.top_tier_daily_new_limit',
  MIDDLE: 'dispatch.middle_tier_daily_new_limit',
  LOW: 'dispatch.low_tier_daily_new_limit',
};

const DAY_MS = 24 * 3600 * 1000;

@Injectable()
export class CompanionQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excellence: ExcellenceService,
  ) {}

  /** 当前段位对应的每日名额 */
  async limitFor(companionId: string): Promise<{ tier: string; limit: number }> {
    const ex = await this.excellence.computeOne(companionId).catch(() => null);
    const tier = ex?.tier || 'MIDDLE';
    const key = LIMIT_KEYS[tier] || LIMIT_KEYS.MIDDLE;
    const cfg = await this.prisma.systemConfig
      .findUnique({ where: { key } })
      .catch(() => null);
    const raw = Number(cfg?.value);
    const limit = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_LIMITS[tier] ?? 2;
    return { tier, limit };
  }

  /**
   * 惰性发放：把「上次发放日 → 今天」这段时间每个营业日的名额补进余额。
   * 首次遇到某个人只发今天的（不追溯历史，否则老账号会一次拿到几百个）。
   */
  async ensure(companionId: string): Promise<{ balance: number; granted: number } | null> {
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { quotaBalance: true, quotaGrantedThrough: true },
    });
    if (!companion) return null;

    const today = businessDayOf(new Date());
    const through = companion.quotaGrantedThrough ? businessDayOf(companion.quotaGrantedThrough) : null;
    const { limit } = await this.limitFor(companionId);

    if (through && through.getTime() === today.getTime()) {
      return { balance: companion.quotaBalance, granted: 0 };
    }

    const days = through ? Math.max(0, Math.round((today.getTime() - through.getTime()) / DAY_MS)) : 1;
    const grant = days * limit;
    const updated = await this.prisma.companion.update({
      where: { id: companionId },
      data: { quotaBalance: { increment: grant }, quotaGrantedThrough: today },
      select: { quotaBalance: true },
    });
    if (grant > 0) {
      logger.info('Companion quota granted', { companionId, days, limit, grant, balance: updated.quotaBalance });
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
   */
  async reserve(
    companionId: string,
    amount = 1,
  ): Promise<{ ok: boolean; tier: string; dailyLimit: number; balance: number }> {
    const { tier, limit } = await this.limitFor(companionId);
    await this.ensure(companionId);
    const ok = await this.consume(companionId, amount);
    if (!ok) {
      const after = await this.ensure(companionId);
      return { ok: false, tier, dailyLimit: limit, balance: after?.balance ?? 0 };
    }
    return { ok: true, tier, dailyLimit: limit, balance: 1 };
  }

  /** 归还名额（抢单失败/订单被取消等场景） */
  async refund(companionId: string, amount = 1): Promise<void> {
    await this.prisma.companion
      .update({ where: { id: companionId }, data: { quotaBalance: { increment: amount } } })
      .catch(() => {});
  }

  /** 抢单池页面用的状态：还剩几个名额 + 今天已经抢了几个立即打 */
  async status(companionId: string) {
    const ensured = await this.ensure(companionId);
    const { tier, limit } = await this.limitFor(companionId);
    const { start, end } = currentBusinessDayRange();
    const grabbed = await this.prisma.order
      .findMany({
        where: {
          companionId,
          grabbedAt: { gte: start, lt: end },
          status: { not: 'CANCELLED' },
        },
        select: { customFields: true, csUser: { select: { role: true } } },
      })
      .catch(() => [] as any[]);
    const usedToday = grabbed.filter((o: any) => (o.customFields as any)?.urgency !== 'later').length;
    return {
      tier,
      dailyLimit: limit,
      balance: ensured?.balance ?? 0,
      usedToday,
      // 今天还能抢几个「立即打」
      remaining: ensured?.balance ?? 0,
    };
  }
}
