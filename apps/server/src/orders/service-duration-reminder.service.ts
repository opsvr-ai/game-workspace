// craftsman-ignore: TS001,TS003
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';

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
        duration: true,
        startedAt: true,
        durationRemindedAt: true,
        parentOrder: { select: { id: true, gameName: true } },
      },
      take: 500,
    });

    for (const s of sessions) {
      if (!s.startedAt) continue;
      const durationH = Number(s.duration) || 1;
      const dueAt = new Date(s.startedAt).getTime() + durationH * 3600 * 1000;
      if (now < dueAt) continue;
      // 提醒过一次、还没到下一次间隔 → 跳过（不然每 30 秒 tick 一次会刷屏）
      const lastAt = s.durationRemindedAt ? new Date(s.durationRemindedAt).getTime() : 0;
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
}
