// craftsman-ignore: TS001,TS003
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { logger } from '../common/logger';

/**
 * 清理长期挂着的 ACTIVE 服务会话。
 * 例如陪玩结束服务时客户端异常、断网、忘记点结束，导致状态一直 BUSY，
 * 后续急单只推送给 AVAILABLE，这些人就永远看不到新订单。
 */
@Injectable()
export class StaleSessionSweepService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: WsGateway,
  ) {}

  onModuleInit(): void {
    setInterval(() => this.tick().catch(() => {}), 5 * 60 * 1000);
    setTimeout(() => this.tick().catch(() => {}), 30 * 1000);
  }

  async tick(): Promise<void> {
    const cfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'service.stale_session_hours' },
    });
    const maxHours = Number(cfg?.value ?? 24);
    if (!Number.isFinite(maxHours) || maxHours <= 0) return;
    const cutoff = new Date(Date.now() - maxHours * 3600 * 1000);

    const sessions = await this.prisma.orderSession.findMany({
      where: {
        status: 'ACTIVE',
        startedAt: { not: null, lt: cutoff },
      },
      select: {
        id: true,
        companionId: true,
        coCompanionId: true,
        startedAt: true,
        totalPausedSec: true,
        parentOrder: { select: { studioId: true, orderCode: true } },
      },
    });

    for (const s of sessions) {
      await this.prisma.orderSession
        .update({
          where: { id: s.id },
          data: { status: 'DONE', endedAt: new Date() },
        })
        .catch(() => {});

      const ids = [s.companionId, s.coCompanionId].filter(Boolean) as string[];
      for (const companionId of ids) {
        await this.releaseCompanion(companionId, s.id, s.parentOrder?.studioId || '');
      }

      logger.warn('Stale active session auto-ended', {
        sessionId: s.id,
        orderCode: s.parentOrder?.orderCode || '',
        startedAt: s.startedAt,
        pausedSec: s.totalPausedSec,
        companionId: s.companionId,
        coCompanionId: s.coCompanionId,
      });
    }
  }

  private async releaseCompanion(companionId: string, endedSessionId: string, studioId: string): Promise<void> {
    const stillActive = await this.prisma.orderSession.count({
      where: {
        id: { not: endedSessionId },
        status: 'ACTIVE',
        startedAt: { not: null },
        OR: [{ companionId }, { coCompanionId: companionId }],
      },
    });
    if (stillActive > 0) return;

    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { id: true, status: true, pc: { select: { lastHeartbeat: true } } },
    });
    if (!companion || companion.status !== 'BUSY') return;

    const stale = new Date(Date.now() - 3 * 60 * 1000);
    const recent = companion.pc?.lastHeartbeat && companion.pc.lastHeartbeat >= stale;
    const nextStatus = recent ? 'AVAILABLE' : 'OFFLINE';
    await this.prisma.companion.update({
      where: { id: companionId },
      data: { status: nextStatus },
    }).catch(() => {});

    if (studioId) {
      this.wsGateway.broadcastToStudio(studioId, 'status:broadcast', {
        companionId,
        status: nextStatus,
      });
    }
  }
}
