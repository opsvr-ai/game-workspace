import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
    // 立即打和预约分别按各自「消失时间」计算，超时后标记为待客服处理
    const [immediateCfg, scheduledCfg] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'pool.immediate_disappear_minutes' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'pool.scheduled_disappear_minutes' } }),
    ]);
    const immediateMin = Number(immediateCfg?.value ?? 10);
    const scheduledMin = Number(scheduledCfg?.value ?? 60);
    const immediateBefore = new Date(Date.now() - immediateMin * 60 * 1000);
    const scheduledBefore = new Date(Date.now() - scheduledMin * 60 * 1000);

    const candidates = await this.prisma.order.findMany({
      where: { status: 'PENDING', dispatchType: 'POOL' },
      select: { id: true, createdAt: true, customFields: true },
    });

    for (const o of candidates) {
      const cf = (o.customFields as any) || {};
      if (cf.poolExpired) continue;
      const before = cf.urgency === 'now' ? immediateBefore : cf.urgency === 'later' ? scheduledBefore : null;
      if (!before || o.createdAt.getTime() > before.getTime()) continue;
      await this.prisma.order.update({
        where: { id: o.id },
        data: { customFields: { ...cf, poolExpired: true, poolExpiredAt: new Date().toISOString() } },
      });
    }
  }
}
