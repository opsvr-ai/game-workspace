import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveConfigsRaw } from '../common/studio-config';

/**
 * 抢单池订单超时流转：立即打/预约订单超过各自「消失时间」后，标记为待客服处理并从抢单池移除。
 */
@Injectable()
export class ScheduledOrderReminderService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    setInterval(() => this.tick().catch(() => {}), 60 * 1000);
    setTimeout(() => this.tick().catch(() => {}), 30 * 1000);
  }

  async tick() {
    const candidates = await this.prisma.order.findMany({
      where: { status: 'PENDING', dispatchType: 'POOL' },
      select: { id: true, createdAt: true, customFields: true, studioId: true },
    });
    if (candidates.length === 0) return;

    // 立即打 / 预约的「消失时间」按店解析（本店店长填的 → 老板全局默认），各店互不影响
    const minutesByStudio = new Map<string, { now: number; later: number }>();
    for (const o of candidates) {
      const key = o.studioId ?? '__global__';
      if (minutesByStudio.has(key)) continue;
      const scoped = await resolveConfigsRaw(this.prisma, o.studioId, [
        'pool.immediate_disappear_minutes',
        'pool.scheduled_disappear_minutes',
      ]);
      minutesByStudio.set(key, {
        now: Number(scoped['pool.immediate_disappear_minutes'] ?? 10),
        later: Number(scoped['pool.scheduled_disappear_minutes'] ?? 60),
      });
    }

    const nowMs = Date.now();
    for (const o of candidates) {
      const cf = (o.customFields as any) || {};
      if (cf.poolExpired) continue;
      const minutes = minutesByStudio.get(o.studioId ?? '__global__') ?? { now: 10, later: 60 };
      const limitMin = cf.urgency === 'now' ? minutes.now : cf.urgency === 'later' ? minutes.later : null;
      const before = limitMin == null ? null : new Date(nowMs - limitMin * 60 * 1000);
      if (!before || o.createdAt.getTime() > before.getTime()) continue;
      await this.prisma.order.update({
        where: { id: o.id },
        data: { customFields: { ...cf, poolExpired: true, poolExpiredAt: new Date().toISOString() } },
      });
    }
  }
}
