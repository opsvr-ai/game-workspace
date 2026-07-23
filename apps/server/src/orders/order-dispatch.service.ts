// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { OrderStatus } from '@chunlv/shared';

@Injectable()
export class OrderDispatchService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
    private bridgeService: BridgeService,
  ) {}

  async assign(orderId: string, companionId: string, userStudioId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    // CS3: CS/ADMIN can assign orders in their own studio or bridged studios
    if (userStudioId) {
      const visibleIds = await this.bridgeService.getVisibleStudioIds(userStudioId);
      if (!visibleIds.includes(order.studioId)) throw new ForbiddenException('无权操作其他工作室的订单');
    }
    // Guard: cannot reassign orders that are already grabbed/confirmed
    if (order.status === OrderStatus.GRABBED || order.status === OrderStatus.CONFIRMED) {
      throw new ForbiddenException('该订单已被抢走，不可重新分配');
    }
    if (order.status === OrderStatus.DONE || order.status === OrderStatus.CANCELLED) {
      throw new ForbiddenException('已完成或已取消的订单不可重新分配');
    }
    // Atomic update: guards against order deletion between fetch and update
    const result = await this.prisma.order.updateMany({
      where: { id: orderId, status: { notIn: [OrderStatus.DONE, OrderStatus.CANCELLED] }, companionId: null },
      data: { dispatchType: 'DIRECT', companionId },
    });
    if (result.count === 0) throw new ForbiddenException('订单状态已变更或已被删除');
    const updatedOrder = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!updatedOrder) throw new NotFoundException('订单不存在');
    // Auto-assign customer (C6 fix)
    try {
      await this.prisma.customer.updateMany({
        where: { id: order.customerId, companionId: null },
        data: { companionId },
      });
    } catch {
      /* non-blocking */
    }
    this.wsGateway.pushOrder(companionId, updatedOrder);
    this.wsGateway.broadcastToBridgedStudios(updatedOrder.studioId, 'order:pool_updated', updatedOrder);
    return updatedOrder;
  }

  async acceptAssignment(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.companionId !== companionId) throw new ForbiddenException('该订单未指派给你');
    if (order.status !== OrderStatus.PENDING) throw new ForbiddenException('订单状态不正确');

    // Atomic update with status guard (C1 fix)
    const result = await this.prisma.order.updateMany({
      where: { id: orderId, companionId, status: OrderStatus.PENDING },
      data: { status: OrderStatus.GRABBED, grabbedAt: new Date() },
    });
    if (result.count === 0) throw new ForbiddenException('订单状态已变更');
    // Auto-assign customer (C6 fix)
    try {
      await this.prisma.customer.updateMany({
        where: { id: order.customerId, companionId: null },
        data: { companionId },
      });
    } catch {
      /* non-blocking */
    }
    const updated = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (updated) this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async declineAssignment(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.companionId !== companionId) throw new ForbiddenException('该订单未指派给你');
    // Atomic update: guards against order deletion between fetch and update
    const result = await this.prisma.order.updateMany({
      where: { id: orderId, companionId },
      data: { companionId: null, dispatchType: 'POOL', status: OrderStatus.PENDING },
    });
    if (result.count === 0) throw new ForbiddenException('订单状态已变更或已被删除');
    const updated = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!updated) throw new NotFoundException('订单不存在');
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async quickGrab(orderId: string, companionId: string) {
    // First fetch order to get customerId and validate
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customerId: true, studioId: true, dispatchType: true, csUserId: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.dispatchType !== 'POOL') throw new ForbiddenException('该订单不在抢单池中');

    // Revenue threshold check (same as grab)
    const creator = await this.prisma.user.findUnique({ where: { id: order.csUserId }, select: { role: true } });
    if (creator?.role !== 'COMPANION') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const todayOrders = await this.prisma.order.findMany({
        where: { companionId, status: 'DONE', createdAt: { gte: today, lt: tomorrow } },
      });
      const todayRevenue = todayOrders.reduce((s, o) => s + o.amount, 0);
      const config = await this.prisma.systemConfig.findUnique({ where: { key: 'revenue.unlock_threshold' } });
      const threshold = (config?.value as number) ?? 100;
      if (todayRevenue < threshold) {
        throw new ForbiddenException(
          `今日流水 ¥${todayRevenue}，未达到解锁门槛 ¥${threshold}，还差 ¥${threshold - todayRevenue}`,
        );
      }
    }

    // Atomic grab with status guard (C1 fix)
    const result = await this.prisma.order.updateMany({
      where: { id: orderId, companionId: null, status: OrderStatus.PENDING },
      data: { status: OrderStatus.GRABBED, companionId, grabbedAt: new Date() },
    });
    if (result.count === 0) throw new ForbiddenException('已被其他陪玩抢先或订单状态已变更');

    // Auto-assign customer (C6 fix) — use order.customerId, not orderId
    try {
      await this.prisma.customer.updateMany({
        where: { id: order.customerId, companionId: null },
        data: { companionId },
      });
    } catch {
      /* non-blocking */
    }

    // Notify CS
    if (order.csUserId) {
      const companionInfo = await this.prisma.companion.findUnique({
        where: { id: companionId },
        include: { user: { select: { username: true } } },
      });
      this.wsGateway.notifyUser(order.csUserId, 'order:grabbed', {
        orderId: order.id,
        companionName: companionInfo?.user?.username ?? '未知',
        message: `${companionInfo?.user?.username ?? '未知'} 抢了你的订单`,
      });
    }

    const updated = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (updated) this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
  }
}
