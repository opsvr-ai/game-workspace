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
        coCompanionId: true,
        duration: true,
        startedAt: true,
        pausedAt: true,
        totalPausedSec: true,
        durationRemindedAt: true,
        parentOrder: { select: { id: true, gameName: true, studioId: true } },
      },
      take: 500,
    });

    for (const s of sessions) {
      if (!s.startedAt) continue;
      const durationH = Number(s.duration) || 1;
      // 到点按「实际服务时长」算，暂停的时间不算；到点就是到点，不再额外多送 10 分钟。
      const pausedSec = Number(s.totalPausedSec || 0)
        + (s.pausedAt ? Math.max(0, (now - new Date(s.pausedAt).getTime()) / 1000) : 0);
      const activeMs = Math.max(0, now - new Date(s.startedAt).getTime() - pausedSec * 1000);
      const dueMs = durationH * 3600 * 1000;
      if (activeMs < dueMs) continue;
      const timing = await getServiceTiming(this.prisma, s.parentOrder.studioId);
      // 到点 + 店长设置的分钟数，必须结束；基准是实际服务时长，不再依赖上一次提醒是否落库，
      // 服务重启/漏 tick 也不会把自动结束无限往后拖。
      if (activeMs - dueMs >= timing.autoEndMs) {
        await this.autoEnd(s.id, timing.bufferMs);
        continue;
      }
      const lastAt = s.durationRemindedAt ? new Date(s.durationRemindedAt).getTime() : 0;
      // 提醒过一次、还没到下一次间隔 → 跳过（不然每 30 秒 tick 一次会刷屏）
      if (lastAt && now - lastAt < ServiceDurationReminderService.REPEAT_MS) continue;

      const overdueMin = Math.floor((activeMs - dueMs) / 60000);
      const overdueText = overdueMin >= 60
        ? `已经超时 ${Math.floor(overdueMin / 60)} 小时 ${overdueMin % 60} 分钟`
        : overdueMin >= 5
          ? `已经超时 ${overdueMin} 分钟`
          : '时间到了';
      const message =
        `已服务 ${durationH} 小时，${overdueText}。` +
        '打完请立刻点「结束服务」；客户还要接着打就先点「续单」—— ' +
        '不点的话这一单不计业绩，也不算首单成交 / 续单 / 复购（评分和抢单名额都会少）';
      // 双陪主陪先结束后，会话只剩 coCompanionId（主陪被置空），
      // 到点提醒必须也推给还在打的副陪，否则钱鸿鸣这种接手的永远收不到。
      for (const id of [s.companionId, s.coCompanionId].filter(Boolean) as string[]) {
        this.wsGateway.pushToCompanion(id, 'service:duration_reminder', {
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
    // 原子抢结束权：tick 并发 / 普通结束同时发生时，只有第一条 updateMany 能成功，
    // 避免重复发自动结束通知、重复改订单状态。
    let claimedCount = 0;
    if (typeof (this.prisma as any).orderSession?.updateMany === 'function') {
      const claimed = await (this.prisma as any).orderSession.updateMany({
        where: { id: sessionId, status: 'ACTIVE' },
        data: {
          status: 'DONE',
          endedAt,
          pausedAt: null,
          totalPausedSec: totalPaused,
          duration: Math.max(0.1, Math.round((activeSec / 3600) * 10) / 10),
        },
      }).catch(() => ({ count: 0 }));
      claimedCount = claimed?.count || 0;
    } else {
      // 单测的 prisma mock 没有 updateMany：退回普通 update，不影响生产逻辑。
      await (this.prisma as any).orderSession.update({
        where: { id: sessionId },
        data: {
          status: 'DONE',
          endedAt,
          pausedAt: null,
          totalPausedSec: totalPaused,
          duration: Math.max(0.1, Math.round((activeSec / 3600) * 10) / 10),
        },
      }).catch(() => {});
      claimedCount = 1;
    }
    if (!claimedCount) return;
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
