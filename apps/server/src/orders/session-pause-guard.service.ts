// craftsman-ignore: TS001,TS003
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';

/**
 * 服务暂停保护（老板 2026-10-23 定稿）：
 *  - 单次暂停最多 10 分钟，到点自动恢复计时；
 *  - 累计暂停最多 20 分钟，超过后不再允许暂停；
 *  - 暂停期间不把整单结束、不释放陪玩，游戏可以继续开着。
 *
 * 这里只处理「服务端自动恢复」；客户端页面仍可以手动继续。
 */
@Injectable()
export class SessionPauseGuardService implements OnModuleInit {
  /** 单次暂停上限 */
  static readonly MAX_SINGLE_PAUSE_SEC = 10 * 60;
  /** 累计暂停上限 */
  static readonly MAX_TOTAL_PAUSE_SEC = 20 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: WsGateway,
  ) {}

  onModuleInit() {
    setInterval(() => this.tick().catch(() => {}), 30 * 1000);
    setTimeout(() => this.tick().catch(() => {}), 8 * 1000);
  }

  async tick(): Promise<void> {
    const now = Date.now();
    const sessions = await this.prisma.orderSession.findMany({
      where: { status: 'ACTIVE', startedAt: { not: null }, pausedAt: { not: null } },
      select: {
        id: true,
        companionId: true,
        coCompanionId: true,
        pausedAt: true,
        totalPausedSec: true,
        parentOrderId: true,
      },
      take: 300,
    });

    for (const s of sessions) {
      if (!s.pausedAt) continue;
      const singleSec = Math.max(0, Math.floor((now - new Date(s.pausedAt).getTime()) / 1000));
      const totalSec = (s.totalPausedSec || 0) + singleSec;
      if (
        singleSec < SessionPauseGuardService.MAX_SINGLE_PAUSE_SEC &&
        totalSec < SessionPauseGuardService.MAX_TOTAL_PAUSE_SEC
      ) {
        continue;
      }
      const added = Math.min(singleSec, SessionPauseGuardService.MAX_TOTAL_PAUSE_SEC - (s.totalPausedSec || 0));
      const nextTotal = Math.max(0, (s.totalPausedSec || 0) + added);
      await this.prisma.orderSession.update({
        where: { id: s.id },
        data: { pausedAt: null, totalPausedSec: nextTotal },
      });
      for (const id of [s.companionId, s.coCompanionId].filter(Boolean) as string[]) {
        this.wsGateway.pushToCompanion(id, 'service:pause_auto_resumed', {
          sessionId: s.id,
          orderId: s.parentOrderId,
          message: '暂停已到上限，已自动继续计时',
        });
      }
    }
  }
}
