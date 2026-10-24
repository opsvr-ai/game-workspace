// craftsman-ignore: TS001,TS003
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { scheduleReleaseCompanionIfIdle } from '../common/companion-presence';
import { getServiceTiming } from '../common/service-timing';

/**
 * 服务时长到点提醒：由服务端定时检查进行中的会话，到达约定时长后推送给主陪客户端
 * （Electron 主进程弹 Windows 通知），不依赖陪玩端页面是否在前台。
 *
 * 老板 2026-10-05：「你也给陪玩提示一下，不点结束不会计入影响评分增加，让他们主动点」——
 * 所以这条提醒现在做两件事：
 *   ① 文案直接说清「不点结束 = 不计业绩、不算分」，逼着人去点；
 *   ② **不再只提醒一次**：只要这段还挂着（ACTIVE），每 30 分钟再提醒一次，直到他点「结束服务」。
 *      （以前是 `durationRemindedAt = null` 才提醒，提醒过一次就再也不吭声了。）
 */
@Injectable()
export class ServiceDurationReminderService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: WsGateway,
  ) {}

  onModuleInit() {
    setInterval(() => this.tick().catch(() => {}), 30 * 1000);
    setTimeout(() => this.tick().catch(() => {}), 5 * 1000);
  }

  /** 到点之后每隔这么久再提醒一次（直到这段被点「结束服务」） */
  private static readonly REPEAT_MS = 30 * 60 * 1000;
  /** 填写 2h 就 2h 后再多给 10 分钟，再提醒结束 */
  private static readonly REMIND_GRACE_MS = 10 * 60 * 1000;
  /** 提醒后达到店长设置的分钟数仍不处理：强制结束，避免无限挂着不计业绩 */

  async tick() {
    const now = Date.now();
    const sessions = await this.prisma.orderSession.findMany({
      where: {
        status: 'ACTIVE',
        startedAt: { not: null },
      },
      select: {
        id: true,
        companionId: true,
        duration: true,
        startedAt: true,
        durationRemindedAt: true,
        parentOrder: { select: { id: true, gameName: true, studioId: true } },
      },
      take: 500,
    });

    for (const s of sessions) {
      if (!s.startedAt) continue;
      const durationH = Number(s.duration) || 1;
      const dueAt = new Date(s.startedAt).getTime() + durationH * 3600 * 1000 + ServiceDurationReminderService.REMIND_GRACE_MS;
      if (now < dueAt) continue;
      const lastAt = s.durationRemindedAt ? new Date(s.durationRemindedAt).getTime() : 0;
      const timing = await getServiceTiming(this.prisma, s.parentOrder.studioId);
      // 提醒后达到店长设置的分钟数仍没处理 → 强制结束，3 分钟缓冲后回空闲。
      if (lastAt && now - lastAt >= timing.autoEndMs) {
        await this.autoEnd(s.id, timing.bufferMs);
        continue;
      }
      // 提醒过一次、还没到下一次间隔 → 跳过（不然每 30 秒 tick 一次会刷屏）
      if (lastAt && now - lastAt < ServiceDurationReminderService.REPEAT_MS) continue;

      const overdueMin = Math.floor((now - dueAt) / 60000);
      const overdueText = overdueMin >= 60
        ? `已经超时 ${Math.floor(overdueMin / 60)} 小时 ${overdueMin % 60} 分钟`
        : overdueMin >= 5
          ? `已经超时 ${overdueMin} 分钟`
          : '时间到了';
      const message =
        `已服务 ${durationH} 小时，${overdueText}。` +
        '打完请立刻点「结束服务」；客户还要接着打就先点「续单」—— ' +
        '不点的话这一单不计业绩，也不算首单成交 / 续单 / 复购（评分和抢单名额都会少）';
      if (s.companionId) {
        this.wsGateway.pushToCompanion(s.companionId, 'service:duration_reminder', {
          sessionId: s.id,
          orderId: s.parentOrder.id,
          gameName: s.parentOrder.gameName || '',
          durationH,
          overdueMin,
          message,
        });
      }
      await this.prisma.orderSession
        .update({ where: { id: s.id }, data: { durationRemindedAt: new Date() } })
        .catch(() => {});
    }
  }

  /** 到点提醒后 10 分钟仍不处理：强制结束这一单，按实际时长计入业绩，陪玩回空闲。 */
  private async autoEnd(sessionId: string, bufferMs = 3 * 60 * 1000): Promise<void> {
    const s = await this.prisma.orderSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        companionId: true,
        coCompanionId: true,
        status: true,
        startedAt: true,
        pausedAt: true,
        totalPausedSec: true,
        parentOrderId: true,
      },
    });
    if (!s || s.status !== 'ACTIVE' || !s.startedAt) return;
    const endedAt = new Date();
    let totalPaused = s.totalPausedSec || 0;
    if (s.pausedAt) totalPaused += Math.floor((endedAt.getTime() - new Date(s.pausedAt).getTime()) / 1000);
    const activeSec = Math.max(0, (endedAt.getTime() - new Date(s.startedAt).getTime()) / 1000 - totalPaused);
    await this.prisma.orderSession.update({
      where: { id: sessionId },
      data: {
        status: 'DONE',
        endedAt,
        pausedAt: null,
        totalPausedSec: totalPaused,
        duration: Math.max(0.1, Math.round((activeSec / 3600) * 10) / 10),
      },
    }).catch(() => {});
    await this.prisma.order.updateMany({
      where: { id: s.parentOrderId, sessions: { none: { status: 'ACTIVE' } } },
      data: { status: 'DONE' },
    }).catch(() => {});
    for (const id of [s.companionId, s.coCompanionId].filter(Boolean) as string[]) {
      // 自动结束同样给 3 分钟缓冲：先保持 BUSY、不杀游戏，3 分钟后没有新服务才回空闲。
      scheduleReleaseCompanionIfIdle(this.prisma, id, sessionId, bufferMs);
      this.wsGateway.pushToCompanion(id, 'service:auto_ended', {
        sessionId,
        orderId: s.parentOrderId,
        message: '服务到点提醒后仍未处理，已自动结束并计入业绩；缓冲结束后切回空闲',
      });
    }
  }
}
