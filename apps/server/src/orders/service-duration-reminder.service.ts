// craftsman-ignore: TS001,TS003
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';

/**
 * 服务时长到点提醒：由服务端定时检查进行中的会话，到达约定时长后推送给主陪客户端
 * （Electron 主进程弹 Windows 通知），不依赖陪玩端页面是否在前台。
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

  async tick() {
    const now = Date.now();
    const sessions = await this.prisma.orderSession.findMany({
      where: {
        status: 'ACTIVE',
        startedAt: { not: null },
        durationRemindedAt: null,
      },
      select: {
        id: true,
        companionId: true,
        duration: true,
        startedAt: true,
        parentOrder: { select: { id: true, gameName: true } },
      },
    });

    for (const s of sessions) {
      if (!s.startedAt) continue;
      const durationH = Number(s.duration) || 1;
      const dueAt = new Date(s.startedAt).getTime() + durationH * 3600 * 1000;
      if (now < dueAt) continue;

      const message = `已服务 ${durationH} 小时，时间到了，请引导客户续单`;
      if (s.companionId) {
        this.wsGateway.pushToCompanion(s.companionId, 'service:duration_reminder', {
          sessionId: s.id,
          orderId: s.parentOrder.id,
          gameName: s.parentOrder.gameName || '',
          durationH,
          message,
        });
      }
      await this.prisma.orderSession
        .update({ where: { id: s.id }, data: { durationRemindedAt: new Date() } })
        .catch(() => {});
    }
  }
}
