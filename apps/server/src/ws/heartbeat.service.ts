// craftsman-ignore: TS001,TS003
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { checkEntertainmentEligibility, computeEntertainmentFee, entertainmentMinutesLeft, loadEntertainmentStanding } from '../common/entertainment-fee';
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
        currentMode: data.currentMode ?? 'AVAILABLE',
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

    // 有有效心跳说明客户端在线：如果被「离线扫描」误判成 OFFLINE，这里恢复为空闲，避免人员列表凭空消失。
    await this.prisma.companion.updateMany({
      where: { id: user.companionId, status: 'OFFLINE' },
      data: { status: 'AVAILABLE' },
    }).catch(() => {});

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

      // 娱乐余额检查：数从 loadEntertainmentStanding 一次取齐（跟「能不能进娱乐」同一处口径，
      // 见 common/entertainment-fee.ts）—— 以前切状态和心跳各查各的，才会出现「能进、进去又被踢」。
      if (openLog.mode === 'ENTERTAINMENT') {
        const standing = await loadEntertainmentStanding(this.prisma as any, user.companionId, now);
        if (standing) {
          const { availableFunds, hourlyRate, freeThreshold, basisRevenue, freeToday } = standing;
          const feeMinutes = Math.floor(elapsed / 60);
          const fee = computeEntertainmentFee({
            minutes: feeMinutes,
            todayRevenue: basisRevenue,
            hourlyRate,
            freeThreshold,
          });
          const remainingMinutes = entertainmentMinutesLeft(availableFunds, hourlyRate);

          // 能不能继续留在娱乐：唯一口径（免单线到了随便玩；否则余额 + 押金够不够玩满 1 分钟），
          // 且刚进娱乐的宽限期内不踢 —— 见 checkEntertainmentEligibility 的注释。
          const verdict = checkEntertainmentEligibility({
            availableFunds,
            hourlyRate,
            freeThreshold,
            freeToday,
            context: 'stay',
            elapsedSeconds: elapsed,
          });

          // 30 minute warning
          if (!freeToday && remainingMinutes <= 30 && remainingMinutes > 0) {
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
          if (!verdict.ok && standing.status === 'ENTERTAINMENT') {
            await this.prisma.companion.update({
              where: { id: user.companionId },
              data: { status: 'AVAILABLE' },
            });
            // 同步「当前模式」，避免出现状态是空闲、模式还显示娱乐
            await this.prisma.companionPC.update({
              where: { companionId: user.companionId },
              data: { currentMode: 'AVAILABLE' },
            }).catch(() => {});
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
              message: `余额不足，已自动切换到空闲状态（娱乐 ${feeMinutes} 分钟，按 ¥${hourlyRate}/小时 该收 ¥${fee}）。${verdict.reason}`,
            });
            if (user.studioId) {
              this.wsGateway.server.to(`studio:${user.studioId}`).emit('status:broadcast', {
                companionId: user.companionId,
                status: 'AVAILABLE',
              });
            }
            // 重推空闲状态黑名单，让客户端恢复杀进程（否则客户端停留在娱乐的 lastStatus，该杀不杀）
            if (user.studioId) {
              await this.wsGateway.pushCurrentBlacklist(user.companionId, user.studioId, true);
            }
            logger.warn('Force idle due to insufficient balance', {
              companionId: user.companionId,
              fee,
              availableFunds,
              elapsedSeconds: elapsed,
              reason: verdict.reason,
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
