// craftsman-ignore: TS001,TS003
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { logger } from '../common/logger';
import { resolveConfigsRaw } from '../common/studio-config';

/**
 * 抢单超时回收。
 *
 * 老板 2026-09-20 指出：抢单没有上限、也没有超时回收，
 * 结果好单烂在个别人手里（线上 56 单卡在「已抢单」，其中一人囤了 20 单），
 * 别人没单可抢。
 *
 * 规则（两项都可配置）：
 * 1. 抢单后 `pool.grab_return_minutes`（默认 180 分钟）没点「开始服务」，
 *    且这笔单没有任何服务记录 → 自动退回订单池，别人可以再抢；
 *    名额不退（囤单要付代价）。
 * 2. 退回时如果这笔单从发布到现在已经超过 `pool.stale_cancel_hours`（默认 24 小时），
 *    说明客户早就凉了，再回池子只会变成幽灵单 → 直接作废并通知客服。
 *
 * 已有服务记录（哪怕只是开始过）的单一律不动，避免把服务过的单重新放出去。
 */
@Injectable()
export class StaleGrabSweepService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: WsGateway,
  ) {}

  onModuleInit(): void {
    setInterval(() => this.tick().catch(() => {}), 5 * 60 * 1000);
    setTimeout(() => this.tick().catch(() => {}), 60 * 1000);
  }

  async tick(): Promise<void> {
    // 回收时间按店解析（本店店长填的 → 老板全局默认），各店可以不一样。
    // 先用「所有店里面最激进的回收时间」做初筛，再逐单按本店自己的配置判定，避免漏单。
    const studioRows = await this.prisma.order.findMany({
      where: { status: 'GRABBED', companionId: { not: null }, grabbedAt: { not: null } },
      select: { studioId: true },
      distinct: ['studioId'],
    });
    const cfgByStudio = new Map<string, { returnMinutes: number; cancelHours: number }>();
    let earliestMicros: number | null = null;
    for (const row of studioRows) {
      const scoped = await resolveConfigsRaw(this.prisma, row.studioId, [
        'pool.grab_return_minutes',
        'pool.stale_cancel_hours',
      ]);
      const returnMinutes = Number(scoped['pool.grab_return_minutes'] ?? 180);
      const cancelHours = Number(scoped['pool.stale_cancel_hours'] ?? 24);
      cfgByStudio.set(row.studioId ?? '__global__', { returnMinutes, cancelHours });
      if (Number.isFinite(returnMinutes) && returnMinutes > 0) {
        earliestMicros =
          earliestMicros === null ? returnMinutes : Math.min(earliestMicros, returnMinutes);
      }
    }
    if (earliestMicros === null) return;
    const cutoff = new Date(Date.now() - earliestMicros * 60 * 1000);

    const candidates = await this.prisma.order.findMany({
      where: { status: 'GRABBED', companionId: { not: null }, grabbedAt: { not: null, lt: cutoff } },
      select: {
        id: true,
        orderCode: true,
        createdAt: true,
        grabbedAt: true,
        studioId: true,
        csUserId: true,
        customFields: true,
        companionId: true,
        companion: { select: { userId: true, user: { select: { username: true } } } },
      },
      take: 200,
    });
    if (candidates.length === 0) return;

    for (const order of candidates) {
      const storeCfg = cfgByStudio.get(order.studioId ?? '__global__');
      if (!storeCfg) continue;
      const { returnMinutes, cancelHours } = storeCfg;
      if (!Number.isFinite(returnMinutes) || returnMinutes <= 0) continue;
      // 这家店自己配的回收时间还没到，下一轮再看
      const grabbedMs = order.grabbedAt ? new Date(order.grabbedAt).getTime() : Date.now();
      if (Date.now() - grabbedMs < returnMinutes * 60 * 1000) continue;

      // 有服务记录的单不回收（可能只是一直没点结束，交给 stale-session-sweep 处理）
      const sessionCount = await this.prisma.orderSession
        .count({ where: { parentOrderId: order.id } })
        .catch(() => 0);
      if (sessionCount > 0) continue;

      const cf = (order.customFields as any) || {};
      const ageHours = (Date.now() - new Date(order.createdAt).getTime()) / 3600000;
      const shouldCancel = Number.isFinite(cancelHours) && cancelHours > 0 && ageHours > cancelHours;

      if (shouldCancel) {
        const updated = await this.prisma.order
          .updateMany({
            where: { id: order.id, status: 'GRABBED' },
            data: {
              status: 'CANCELLED',
              customFields: {
                ...cf,
                autoCancelled: true,
                autoCancelledAt: new Date().toISOString(),
                autoCancelReason: `抢单后 ${returnMinutes} 分钟未开始服务，且发布已超过 ${cancelHours} 小时`,
                returnedFromCompanion: order.companionId,
              } as any,
            },
          })
          .catch(() => ({ count: 0 }));
        if (updated.count === 0) continue;

        logger.warn('Stale grabbed order auto-cancelled', {
          orderCode: order.orderCode,
          companionId: order.companionId,
          grabbedAt: order.grabbedAt,
        });
        this.notify(order, 'order:auto_cancelled',
          `订单 ${order.orderCode || ''} 因抢单后长时间未开始服务已自动作废，如果客户还要，请重新发布。`);
      } else {
        const updated = await this.prisma.order
          .updateMany({
            where: { id: order.id, status: 'GRABBED', companionId: order.companionId },
            data: {
              status: 'PENDING',
              companionId: null,
              grabbedAt: null,
              customFields: {
                ...cf,
                returnedToPool: true,
                returnedAt: new Date().toISOString(),
                returnCount: Number(cf.returnCount || 0) + 1,
                lastReturnedFrom: order.companionId,
              } as any,
            },
          })
          .catch(() => ({ count: 0 }));
        if (updated.count === 0) continue;

        logger.warn('Stale grabbed order returned to pool', {
          orderCode: order.orderCode,
          companionId: order.companionId,
          grabbedAt: order.grabbedAt,
        });
        this.notify(order, 'order:returned_to_pool',
          `订单 ${order.orderCode || ''} 抢单后 ${returnMinutes} 分钟没有开始服务，已自动退回订单池。`);
        this.wsGateway.broadcastToStudio(order.studioId, 'order:pool_updated', { id: order.id });
      }
    }
  }

  private notify(
    order: { orderCode?: string | null; csUserId: string; studioId: string; companion?: { userId: string } | null },
    event: string,
    message: string,
  ): void {
    try {
      if (order.companion?.userId) {
        this.wsGateway.notifyUser(order.companion.userId, event, { message });
      }
      if (order.csUserId) {
        this.wsGateway.notifyUser(order.csUserId, event, { message });
      }
    } catch {
      /* 通知失败不影响回收 */
    }
  }
}
