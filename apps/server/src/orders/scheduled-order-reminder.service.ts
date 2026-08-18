import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';

/**
 * 预约单跟进提醒：预约单发布 1 小时后仍处于待派单状态时，通知发单客服去对接客户。
 */
@Injectable()
export class ScheduledOrderReminderService implements OnModuleInit {
  private readonly logger = new Logger(ScheduledOrderReminderService.name);

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
      select: { id: true, csUserId: true, customFields: true },
    });

    for (const order of orders) {
      const cf = (order.customFields as any) || {};
      if (cf.urgency !== 'later' || cf.scheduledReminderSent || !order.csUserId) continue;

      this.wsGateway.notifyUser(order.csUserId, 'order:scheduled_reminder', {
        orderId: order.id,
        message: '你发布的预约单已发布 1 小时还未被接，请跟进对接客户',
      });

      await this.prisma.order.update({
        where: { id: order.id },
        data: { customFields: { ...cf, scheduledReminderSent: true } },
      });
    }
  }
}
