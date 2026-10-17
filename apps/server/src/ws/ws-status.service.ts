// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { logger } from '../common/logger';
import { WsEmitterService } from './ws-emitter.service';
import { WsBlacklistService } from './ws-blacklist.service';
import type { ConnectedUser } from './ws-connection.service';

/**
 * 「陪玩自助切状态」语义层 —— 原 ws.gateway.ts 的 `companion:status` 整段。
 *
 * 这里装的是**权限与业务判断**，一个字节都没改：
 *  - 接单中（BUSY）不能手点，只能由开始服务自动进入；
 *  - 有已开始的会话时不允许被切走，防止把状态误刷成空闲绕过黑名单/抢单；
 *  - 切完要同步 companionPC.currentMode、封口/新开计时日志、按新状态重推黑名单、广播给工作室。
 *
 * emitter / blacklist 是网关已经装配好的实例（构造期直接传入，不需要 server 取址回调）。
 */
@Injectable()
export class WsStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: WsEmitterService,
    private readonly blacklist: WsBlacklistService,
  ) {}

  async handleStatusChange(
    user: ConnectedUser | undefined,
    data: { status: string; mode?: string },
  ): Promise<void> {
    if (!user?.companionId) return;

    logger.info('WS companion:status received', {
      companionId: user.companionId,
      username: user.username,
      status: data.status,
      mode: data.mode,
    });

    // Compat: map old client status values to new enum
    const STATUS_COMPAT: Record<string, string> = { ONLINE: 'AVAILABLE', IDLE: 'ENTERTAINMENT' };
    const mappedStatus = STATUS_COMPAT[data.status] || data.status;

    // 接单状态只能由开始服务自动进入，不能手动点，防止借“接单”状态玩黑名单游戏。
    if (mappedStatus === 'BUSY') {
      logger.warn('Ignored manual BUSY status', {
        companionId: user.companionId,
        username: user.username,
      });
      return;
    }

    // 服务进行中（有已开始的会话）不允许被客户端切成空闲/娱乐/休息等状态，防止状态被误刷成空闲。
    if (mappedStatus !== 'BUSY') {
      const activeSession = await this.prisma.orderSession.findFirst({
        where: {
          OR: [{ companionId: user.companionId }, { coCompanionId: user.companionId }],
          status: 'ACTIVE',
          startedAt: { not: null },
        },
        select: { id: true },
      }).catch(() => null);
      if (activeSession) {
        logger.warn('Ignored companion:status while in service', {
          companionId: user.companionId,
          username: user.username,
          requestedStatus: mappedStatus,
        });
        return;
      }
    }

    // Get previous status for time tracking
    const prev = await this.prisma.companion
      .findUnique({
        where: { id: user.companionId },
        select: { status: true },
      })
      .catch(() => null);
    const prevStatus = prev?.status;

    await this.prisma.companion
      .update({
        where: { id: user.companionId },
        data: { status: mappedStatus },
      })
      .then(() => {
        logger.debug('DB status updated', { companionId: user.companionId, status: data.status });
      })
      .catch((err) => {
        logger.error('DB status update failed', { companionId: user.companionId, error: (err as any).message });
      });

    // 同步「当前模式」与状态，避免出现状态是空闲、模式还显示娱乐
    await this.prisma.companionPC.update({
      where: { companionId: user.companionId },
      data: { currentMode: mappedStatus },
    }).catch(() => {});

    // 状态变化后推送新状态对应的黑名单，避免客户端停留在旧状态的黑名单列表。
    // 这是陪玩本人开的状态，属于权威状态，可以下发。
    await this.blacklist.pushCurrentBlacklist(user.companionId, user.studioId, true);

    // ── Time tracking: start/stop CompanionTimeLog on status change ──
    if (mappedStatus !== prevStatus) {
      const now = new Date();
      // Close any open time log for the previous status
      if (prevStatus) {
        await this.prisma.companionTimeLog.updateMany({
          where: { companionId: user.companionId, mode: prevStatus, endedAt: null },
          data: { endedAt: now },
        });
        logger.info('TimeLog closed', { companionId: user.companionId, mode: prevStatus });
      }
      // Open new time log for the new status (ENTERTAINMENT = billing)
      await this.prisma.companionTimeLog.create({
        data: {
          companionId: user.companionId,
          mode: mappedStatus,
          startedAt: now,
          endedAt: null,
          durationSeconds: 0,
        },
      });
      logger.info('TimeLog started', { companionId: user.companionId, mode: mappedStatus });
    }

    if (user.studioId) {
      this.emitter.broadcastToBridgedStudios(user.studioId, 'status:broadcast', {
        companionId: user.companionId,
        status: mappedStatus,
        mode: data.mode,
      });
      logger.debug('Broadcast to studio', { studioId: user.studioId });
    }
  }
}
