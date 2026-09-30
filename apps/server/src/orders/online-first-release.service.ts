import { Injectable, OnModuleInit } from '@nestjs/common';
import { PoolScope } from '@chunlv/shared';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';
import { resolveConfigsRaw } from '../common/studio-config';
import { logger } from '../common/logger';

/**
 * 「线上→线下流转」的单到点自动放给本店线下时，给本店每个陪玩弹一次（老板 2026-10-01）。
 *
 * 为什么需要这个扫描：以前这种单「到点自动放行」是**纯读时计算**的
 * （findPool 里拿 visibleToOwnOffline 现算），没有任何后台动作，所以也没有一个「到点」的时刻
 * 可以发弹窗。这里每 30 秒扫一次，发现到点了就把它标成「已放给线下」并弹窗。
 *
 * 只把 releasedToOfflineAt 写成 **createdAt + 分钟数**（而不是 now），
 * 这样「什么时候对本店线下可见」跟原来一模一样（不会因为扫描延迟而晚几十秒），
 * 而写了这个字段本身就是去重：下一次扫描不会再弹一次。
 */
@Injectable()
export class OnlineFirstReleaseService implements OnModuleInit {
  /** studioId -> 自动放行分钟数（短缓存，避免每条单都查一次配置） */
  private readonly minutesCache = new Map<string, { minutes: number; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit(): void {
    setInterval(() => this.sweep().catch(() => {}), 30 * 1000);
    setTimeout(() => this.sweep().catch(() => {}), 15 * 1000);
  }

  private async releaseMinutes(studioId: string): Promise<number> {
    const hit = this.minutesCache.get(studioId);
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.minutes;
    const cfg = await resolveConfigsRaw(this.prisma, studioId, [
      'pool.online_first_release_minutes',
    ]).catch(() => ({}) as Record<string, unknown>);
    const raw = Number((cfg as Record<string, unknown>)['pool.online_first_release_minutes']);
    const minutes = Number.isFinite(raw) ? Math.max(0, raw) : 5;
    this.minutesCache.set(studioId, { minutes, at: Date.now() });
    return minutes;
  }

  /** 返回这一轮真正弹了几单（方便测试 / 排查）。 */
  async sweep(): Promise<number> {
    const now = Date.now();
    const candidates = await this.prisma.order.findMany({
      where: {
        poolScope: PoolScope.ONLINE_FIRST,
        status: 'PENDING',
        companionId: null,
        releasedToOfflineAt: null,
      },
      select: { id: true, studioId: true, createdAt: true, customFields: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    let fired = 0;
    for (const c of candidates) {
      const cf = (c.customFields as any) || {};
      if (cf.poolExpired || cf.poolHandled) continue;
      const minutes = await this.releaseMinutes(c.studioId);
      const at = new Date(c.createdAt).getTime() + minutes * 60 * 1000;
      if (now < at) continue;

      // 条件写成跟查询一致：万一这中间被抢走 / 被客服处理了，count 会是 0，就不弹。
      const res = await this.prisma.order
        .updateMany({
          where: { id: c.id, status: 'PENDING', releasedToOfflineAt: null },
          data: { releasedToOfflineAt: new Date(at) },
        })
        .catch(() => ({ count: 0 }));
      if (res.count !== 1) continue;

      const fresh = await this.prisma.order
        .findUnique({ where: { id: c.id } })
        .catch(() => null);
      if (!fresh) continue;
      await this.orders.broadcastReleasedToOffline(fresh).catch(() => null);
      fired += 1;
      logger.info('Online-first order auto-released to own offline', {
        orderId: fresh.id,
        orderCode: fresh.orderCode,
        studioId: fresh.studioId,
        minutes,
      });
    }
    return fired;
  }
}
