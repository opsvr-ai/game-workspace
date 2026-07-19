// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { OrderStatus } from '@chunlv/shared';
import { logger } from '../common/logger';

export const VALID_TRANSITIONS: Record<string, string[]> = {
  [OrderStatus.PENDING]: [OrderStatus.GRABBED, OrderStatus.CANCELLED],
  [OrderStatus.GRABBED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.DONE, OrderStatus.CANCELLED],
};

@Injectable()
export class OrderWorkflowService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
  ) {}

  validateTransition(order: { id: string; status: string }, targetStatus: string) {
    const allowed = VALID_TRANSITIONS[order.status];
    if (!allowed || !allowed.includes(targetStatus)) {
      throw new ForbiddenException(`不允许从 ${order.status} 转换到 ${targetStatus}`);
    }
  }

  async grab(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.GRABBED);
    if (order.dispatchType !== 'POOL' || order.companionId !== null) {
      throw new ForbiddenException('该订单不可抢');
    }

    // Revenue threshold check — skip for peer orders (created by companions)
    const creator = await this.prisma.user.findUnique({ where: { id: order.csUserId }, select: { role: true } });
    const isPeerOrder = creator?.role === 'COMPANION';

    if (!isPeerOrder) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todayOrders = await this.prisma.order.findMany({
        where: { companionId, status: 'DONE', createdAt: { gte: today, lt: tomorrow } },
      });
      const todayRevenue = todayOrders.reduce((s, o) => s + o.amount, 0);

      const config = await this.prisma.systemConfig.findUnique({
        where: { key: 'revenue.unlock_threshold' },
      });
      const threshold = (config?.value as number) ?? 100;

      if (todayRevenue < threshold) {
        throw new ForbiddenException(
          `今日流水 ¥${todayRevenue}，未达到解锁门槛 ¥${threshold}，还差 ¥${threshold - todayRevenue}`,
        );
      }
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.GRABBED, companionId, grabbedAt: new Date() },
      include: {
        csUser: { select: { username: true, avatar: true, displayName: true } },
        companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } },
        coCompanion: { include: { user: { select: { username: true } } } },
      },
    });
    this.wsGateway.broadcastToStudio(updatedOrder.studioId, 'order:pool_updated', updatedOrder);

    // Notify the CS who created this order about the grab
    if (updatedOrder.csUserId) {
      const companionName = updatedOrder.companion?.user?.username ?? '未知';
      this.wsGateway.notifyUser(updatedOrder.csUserId, 'order:grabbed', {
        orderId: updatedOrder.id,
        companionName,
        message: `${companionName} 抢了你的订单`,
      });
    }

    // Auto-assign customer to companion if not yet assigned
    try {
      await this.prisma.customer.updateMany({
        where: { id: order.customerId, companionId: null },
        data: { companionId },
      });
    } catch (err) {
      logger.error('Customer assignment failed during grab', { error: (err as Error).message });
    }

    return updatedOrder;
  }

  async confirm(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.CONFIRMED);
    if (order.companionId !== companionId) throw new ForbiddenException('无权确认此订单');
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CONFIRMED },
    });
  }

  async complete(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.DONE);

    // Auto-assign customer to companion if not yet assigned
    if (order.companionId) {
      try {
        await this.prisma.customer.updateMany({
          where: { id: order.customerId, companionId: null },
          data: { companionId: order.companionId },
        });
      } catch (err) {
        logger.error('Customer assignment failed during complete', { error: (err as Error).message });
      }
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DONE },
    });
  }

  async completeWithBilling(
    orderId: string,
    companionId: string,
    dto: {
      customerCode?: string;
      firstOrder: { duration: number; price: number };
      hasRenew?: boolean;
      renewOrder?: { duration: number; price: number };
      gameName: string;
      type: string; // 'COMPANION' | 'ESCORT'
      screenshotUrl?: string;
      wechatId?: string;
    },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.DONE);

    // Detect customer type
    const customer = dto.customerCode
      ? await this.prisma.customer.findUnique({ where: { customerCode: dto.customerCode } })
      : await this.prisma.customer.findUnique({ where: { id: order.customerId } });

    if (!customer) throw new NotFoundException('客户不存在');

    const orderCount = await this.prisma.order.count({
      where: { customerId: customer.id, status: 'DONE' },
    });

    const customerType = orderCount === 0 ? 'NEW' : 'REPURCHASE';

    // Calculate totals
    const firstAmount = dto.firstOrder.duration * dto.firstOrder.price;
    const renewAmount = dto.hasRenew && dto.renewOrder ? dto.renewOrder.duration * dto.renewOrder.price : 0;
    const totalAmount = firstAmount + renewAmount;
    const totalDuration = dto.firstOrder.duration + (dto.renewOrder?.duration || 0);

    // Update the main order as DONE
    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.DONE,
        type: customerType,
        amount: totalAmount,
        duration: totalDuration,
        gameName: dto.gameName,
        customFields: {
          ...((order.customFields as any) || {}),
          firstOrder: dto.firstOrder,
          renewOrder: dto.renewOrder || null,
          hasRenew: dto.hasRenew || false,
          customerType,
          settlementType: dto.type,
          screenshotUrl: dto.screenshotUrl,
          wechatId: dto.wechatId,
        },
      },
    });

    // If hasRenew, create a separate RENEW order
    if (dto.hasRenew && dto.renewOrder) {
      await this.prisma.order.create({
        data: {
          type: 'RENEW',
          studioId: order.studioId,
          csUserId: order.csUserId,
          companionId,
          customerId: order.customerId,
          dispatchType: 'DIRECT',
          status: OrderStatus.DONE,
          amount: renewAmount,
          gameName: dto.gameName,
          duration: dto.renewOrder.duration,
          customFields: { parentOrderId: orderId },
        },
      });
    }

    // Update customer total spent
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { totalSpent: { increment: totalAmount } },
    });

    // Update companion revenue
    await this.prisma.companion.update({
      where: { id: companionId },
      data: { monthlyRevenue: { increment: totalAmount } },
    });

    // Auto-assign customer to companion if not yet assigned
    try {
      await this.prisma.customer.updateMany({
        where: { id: customer.id, companionId: null },
        data: { companionId },
      });
    } catch (err) {
      logger.error('Customer assignment failed during completeWithBilling', { error: (err as Error).message });
    }

    // Update customer status
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { status: 'ACTIVE' },
    });

    return updatedOrder;
  }

  async cancel(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.CANCELLED);
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED },
    });
  }
}
