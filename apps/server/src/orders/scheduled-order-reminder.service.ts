import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';

/**
 * 预约单跟进提醒：预约单发布 1 小时后仍处于待派单状态时，通知发单客服去对接客户。
 */
@Injectable()
export class ScheduledOrderReminderService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: WsGateway,
  ) {}

  onModuleInit() {
    setInterval(() => this.tick().catch(() => {}), 60 * 1000);
    setTimeout(() => this.tick().catch(() => {}), 30 * 1000);
  }

  async tick() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const orders = await this.prisma.order.findMany({
      where: { status: 'PENDING', dispatchType: 'POOL', createdAt: { lte: oneHourAgo } },
      select: { id: true, csUserId: true, gameName: true, customFields: true },
    });

    for (const order of orders) {
      const cf = (order.customFields as any) || {};
      if (cf.urgency !== 'later' || cf.scheduledReminderSent || !order.csUserId) continue;

      this.wsGateway.notifyUser(order.csUserId, 'order:scheduled_reminder', {
        orderId: order.id,
        message: `你发布的预约单「${order.gameName}」已发布 1 小时还未被接，请把客户加到你的工作微信上，并上传添加截图凭证`,
      });

      await this.prisma.order.update({
        where: { id: order.id },
        data: { customFields: { ...cf, scheduledReminderSent: true } },
      });
    }
  }
}
