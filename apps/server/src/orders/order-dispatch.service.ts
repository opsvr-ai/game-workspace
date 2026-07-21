// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { OrderStatus } from '@chunlv/shared';

@Injectable()
export class OrderDispatchService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
  ) {}

  async assign(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status === OrderStatus.DONE || order.status === OrderStatus.CANCELLED) {
      throw new ForbiddenException('已完成或已取消的订单不可重新分配');
    }
    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { dispatchType: 'DIRECT', companionId },
    });
    // Auto-assign customer (C6 fix)
    try {
      await this.prisma.customer.updateMany({
        where: { id: order.customerId, companionId: null },
        data: { companionId },
      });
    } catch { /* non-blocking */ }
    this.wsGateway.pushOrder(companionId, updatedOrder);
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
    } catch { /* non-blocking */ }
    return this.prisma.order.findUnique({ where: { id: orderId } });
  }

  async declineAssignment(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.companionId !== companionId) throw new ForbiddenException('该订单未指派给你');
    return this.prisma.order.update({ where: { id: orderId }, data: { companionId: null, dispatchType: 'POOL' } });
  }

  async quickGrab(orderId: string, companionId: string) {
    // Atomic grab with status guard (C1 fix)
    const result = await this.prisma.order.updateMany({
      where: { id: orderId, companionId: null, status: OrderStatus.PENDING },
      data: { status: OrderStatus.GRABBED, companionId, grabbedAt: new Date() },
    });
    if (result.count === 0) throw new ForbiddenException('已被其他陪玩抢先或订单状态已变更');

    // Auto-assign customer (C6 fix)
    try {
      await this.prisma.customer.updateMany({
        where: { id: orderId, companionId: null },
        data: { companionId },
      });
    } catch { /* non-blocking */ }

    return this.prisma.order.findUnique({ where: { id: orderId } });
  }
}
