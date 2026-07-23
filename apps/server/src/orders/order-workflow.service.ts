// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { OrderStatus } from '@chunlv/shared';
import { logger } from '../common/logger';

export const VALID_TRANSITIONS: Record<string, string[]> = {
  [OrderStatus.PENDING]: [OrderStatus.GRABBED, OrderStatus.CANCELLED],
  [OrderStatus.GRABBED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED, OrderStatus.PENDING], // H2: allow re-pool
  [OrderStatus.CONFIRMED]: [OrderStatus.DONE, OrderStatus.CANCELLED],
};

@Injectable()
export class OrderWorkflowService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
    private bridgeService: BridgeService,
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

    // Cross-studio scope: companion can only grab from own or bridged studios
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { studioId: true },
    });
    if (!companion) throw new NotFoundException('陪玩不存在');
    if (companion.studioId && companion.studioId !== order.studioId) {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(companion.studioId);
      if (!bridgedIds.includes(order.studioId)) {
        throw new ForbiddenException('无权抢其他工作室的订单');
      }
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

    // Atomic grab: WHERE includes companionId:null + status:PENDING to prevent race
    const updatedOrder = await this.prisma.order.updateMany({
      where: { id: orderId, companionId: null, status: OrderStatus.PENDING },
      data: { status: OrderStatus.GRABBED, companionId, grabbedAt: new Date() },
    });

    if (updatedOrder.count === 0) {
      throw new ForbiddenException('该订单已被其他陪玩抢先抢走');
    }

    // Re-fetch with includes for broadcasting
    const grabbedOrder = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        csUser: { select: { username: true, avatar: true, displayName: true } },
        companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } },
        coCompanion: { include: { user: { select: { username: true } } } },
      },
    });
    if (!grabbedOrder) throw new NotFoundException('订单不存在');
    this.wsGateway.broadcastToBridgedStudios(grabbedOrder.studioId, 'order:pool_updated', grabbedOrder);

    // Notify the CS who created this order about the grab
    if (grabbedOrder.csUserId) {
      const companionName = grabbedOrder.companion?.user?.username ?? '未知';
      this.wsGateway.notifyUser(grabbedOrder.csUserId, 'order:grabbed', {
        orderId: grabbedOrder.id,
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

    return grabbedOrder;
  }

  async confirm(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.CONFIRMED);
    if (order.companionId !== companionId) throw new ForbiddenException('无权确认此订单');
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CONFIRMED },
    });
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async complete(orderId: string, _userId?: string, userStudioId?: string, companionId?: string, role?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    // COMPANION can only complete their own orders
    if (role === 'COMPANION') {
      if (order.companionId !== companionId) throw new ForbiddenException('只能完成自己的订单');
    } else if (userStudioId) {
      // Studio boundary: CS/ADMIN can only complete orders in their own or bridged studios
      const visibleIds = await this.bridgeService.getVisibleStudioIds(userStudioId);
      if (!visibleIds.includes(order.studioId)) throw new ForbiddenException('无权操作其他工作室的订单');
    }
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

    // H4: Update companion monthlyRevenue + customer totalSpent (unify with completeWithBilling)
    if (order.companionId && order.amount) {
      try {
        await this.prisma.companion.update({
          where: { id: order.companionId },
          data: { monthlyRevenue: { increment: order.amount } },
        });
        await this.prisma.customer.update({
          where: { id: order.customerId },
          data: { totalSpent: { increment: order.amount } },
        });
      } catch (err) {
        logger.error('Revenue update failed during complete', { error: (err as Error).message });
      }
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DONE },
    });
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
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
      splitTo?: Array<{ companionId: string; amount: number }>;
    },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    // Ownership check: only the assigned companion can complete with billing
    if (order.companionId !== companionId) throw new ForbiddenException('无权操作此订单');
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
          splits: (dto.splitTo || []).length > 0 ? dto.splitTo : undefined,
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

    // Update revenue (C2 fix: unified entry — only complete paths record revenue)
    try {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { totalSpent: { increment: totalAmount } },
      });
      // Calculate split amounts
      const splitTotal = (dto.splitTo || []).reduce((s, e) => s + e.amount, 0);
      const primaryAmount = totalAmount - splitTotal;
      await this.prisma.companion.update({
        where: { id: companionId },
        data: { monthlyRevenue: { increment: primaryAmount } },
      });
      // Record revenue for split companions (cross-studio billing)
      for (const split of dto.splitTo || []) {
        try {
          await this.prisma.companion.update({
            where: { id: split.companionId },
            data: { monthlyRevenue: { increment: split.amount } },
          });
        } catch (err) {
          logger.error('Split revenue update failed', {
            error: (err as Error).message,
            splitCompanionId: split.companionId,
          });
        }
      }
    } catch (err) {
      logger.error('Revenue update failed', { error: (err as Error).message });
    }

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

    this.wsGateway.broadcastToBridgedStudios(updatedOrder.studioId, 'order:pool_updated', updatedOrder);
    return updatedOrder;
  }

  async cancel(orderId: string, userStudioId?: string, companionId?: string, role?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    // COMPANION can only cancel their own orders
    if (role === 'COMPANION') {
      if (order.companionId !== companionId) throw new ForbiddenException('只能取消自己的订单');
    } else if (userStudioId) {
      // CS/ADMIN can only cancel orders in their own studio or bridged studios
      const visibleIds = await this.bridgeService.getVisibleStudioIds(userStudioId);
      if (!visibleIds.includes(order.studioId)) throw new ForbiddenException('无权操作其他工作室的订单');
    }
    this.validateTransition(order, OrderStatus.CANCELLED);
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED },
    });
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    if (updated.companionId) {
      this.wsGateway.pushOrder(updated.companionId, updated);
    }
    return updated;
  }
}
