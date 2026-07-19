// craftsman-ignore: TS001,TS003
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { logger } from '../common/logger';
import { WsGateway } from './ws.gateway';

export interface HeartbeatUser {
  id: string;
  username: string;
  role: string;
  studioId: string | null;
  companionId?: string;
}

export interface HeartbeatData {
  agentVersion?: string;
  currentMode?: string;
  workSec?: number;
  isThrottled?: boolean;
  throttleLimitKB?: number;
}

@Injectable()
export class HeartbeatService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => WsGateway)) private readonly wsGateway: WsGateway,
  ) {}

  async process(data: HeartbeatData, user: HeartbeatUser): Promise<void> {
    if (!user.companionId) return;

    logger.debug('WS heartbeat', {
      companionId: user.companionId,
      username: user.username,
      mode: data.currentMode,
      workSec: data.workSec,
    });

    await this.prisma.companionPC.upsert({
      where: { companionId: user.companionId },
      create: {
        companionId: user.companionId,
        agentVersion: data.agentVersion ?? '0.0.0',
        lastHeartbeat: new Date(),
        currentMode: data.currentMode ?? 'ENTERTAINMENT',
        isThrottled: data.isThrottled ?? false,
        throttleLimitKB: data.throttleLimitKB ?? null,
      },
      update: {
        agentVersion: data.agentVersion ?? undefined,
        lastHeartbeat: new Date(),
        currentMode: data.currentMode ?? undefined,
        isThrottled: data.isThrottled ?? undefined,
        throttleLimitKB: data.throttleLimitKB ?? undefined,
      },
    });

    // Update duration on open time logs (status-based tracking)
    const now = new Date();
    const openLog = await this.prisma.companionTimeLog.findFirst({
      where: { companionId: user.companionId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (openLog) {
      const elapsed = Math.round((now.getTime() - openLog.startedAt.getTime()) / 1000);
      await this.prisma.companionTimeLog.update({
        where: { id: openLog.id },
        data: { durationSeconds: elapsed },
      });

      // Balance check: if in ENTERTAINMENT mode and running out of funds
      if (openLog.mode === 'ENTERTAINMENT') {
        const companion = await this.prisma.companion.findUnique({
          where: { id: user.companionId },
          select: { balance: true, deposit: true, status: true },
        });
        if (companion) {
          const availableFunds = (companion.balance || 0) + (companion.deposit || 0);
          const rateCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'entertainment.hourly_rate' } });
          const hourlyRate = (rateCfg?.value as number) ?? 60;
          const feeMinutes = Math.floor(elapsed / 60);
          const fee = Number((feeMinutes * (hourlyRate / 60)).toFixed(2));
          const remainingMinutes = Math.floor(availableFunds / (hourlyRate / 60));

          // 30 minute warning
          if (remainingMinutes <= 30 && remainingMinutes > 0) {
            this.wsGateway.server.to(`user:${user.id}`).emit('entertainment:warning', {
              message: `娱乐已 ${feeMinutes} 分钟（¥${fee}），费率 ¥${hourlyRate}/小时，余额 ¥${availableFunds} 仅够再玩 ${remainingMinutes} 分钟`,
              elapsedMinutes: feeMinutes,
              fee,
              hourlyRate,
              availableFunds,
              remainingMinutes,
              autoSwitchIn: 30 * 60,
            });
            logger.warn('Entertainment balance warning', { companionId: user.companionId, fee, remainingMinutes });
          }

          // Balance exhausted — force switch to AVAILABLE
          if (remainingMinutes <= 0 && companion.status === 'ENTERTAINMENT') {
            await this.prisma.companion.update({
              where: { id: user.companionId },
              data: { status: 'AVAILABLE' },
            });
            // Close current entertainment log
            await this.prisma.companionTimeLog.updateMany({
              where: { companionId: user.companionId, mode: 'ENTERTAINMENT', endedAt: null },
              data: { endedAt: now },
            });
            // Open AVAILABLE log
            await this.prisma.companionTimeLog.create({
              data: {
                companionId: user.companionId,
                mode: 'AVAILABLE',
                startedAt: now,
                endedAt: null,
                durationSeconds: 0,
              },
            });
            this.wsGateway.server.to(`user:${user.id}`).emit('entertainment:forceIdle', {
              message: `余额不足，已自动切换到空闲状态。娱乐 ${feeMinutes} 分钟，费用 ¥${fee}（费率 ¥${hourlyRate}/小时）`,
            });
            if (user.studioId) {
              this.wsGateway.server.to(`studio:${user.studioId}`).emit('status:broadcast', {
                companionId: user.companionId,
                status: 'AVAILABLE',
              });
            }
            logger.warn('Force idle due to insufficient balance', {
              companionId: user.companionId,
              fee,
              availableFunds,
            });
          }
        }
      }
    }

    // Legacy: Go Agent accumulated workSec
    if (data.workSec && data.workSec > 0) {
      await this.prisma.companionTimeLog.create({
        data: {
          companionId: user.companionId,
          mode: data.currentMode ?? 'ENTERTAINMENT',
          startedAt: new Date(now.getTime() - data.workSec * 1000),
          endedAt: now,
          durationSeconds: data.workSec,
        },
      });
    }
  }
}
