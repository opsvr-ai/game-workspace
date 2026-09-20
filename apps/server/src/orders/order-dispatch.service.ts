// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { OrderStatus } from '@chunlv/shared';
import { logger } from '../common/logger';
import { CompanionQuotaService } from './companion-quota.service';

@Injectable()
export class OrderDispatchService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
    private bridgeService: BridgeService,
    private readonly quota: CompanionQuotaService,
  ) {}

  private async refreshCompanionAvailable(companionId: string) {
    await this.prisma.companion
      .update({ where: { id: companionId }, data: { status: 'AVAILABLE' } })
      .catch(() => {});
    await this.wsGateway.refreshCompanionBlacklist(companionId);
  }

  /** 客户只跟工作微信有关：当前工作微信已「添加成功」该客户则拦截（添加失败不算），换新微信后可再接。 */
  private async assertCustomerNotAddedByCurrentWechat(companionId: string, customerId: string) {
    const currentWorkWechat = await this.prisma.workWechat.findUnique({
      where: { companionId },
      select: { wechatId: true },
    });
    if (!currentWorkWechat?.wechatId) return;
    const addedOrders = await this.prisma.order.findMany({
      where: { customerId, contactStatus: 'added' },
      select: { customFields: true },
    });
    const currentWx = currentWorkWechat.wechatId.trim();
    const alreadyAdded = addedOrders.some((o) => {
      const wx = ((o.customFields as any)?.workWechatName || '').trim();
      return currentWx && wx === currentWx;
    });
    if (alreadyAdded) {
      throw new ForbiddenException(`你的工作微信「${currentWx}」已添加过这个客户，更换新微信后可再接`);
    }
  }

  async assign(orderId: string, companionId: string, userStudioId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    const orderCf = (order.customFields as any) || {};
    if (orderCf.poolExpired) throw new ForbiddenException('该订单已超时，仅客服可处理');
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
    await this.assertCustomerNotAddedByCurrentWechat(companionId, order.customerId);
    // Atomic update: guards against order deletion between fetch and update
    const result = await this.prisma.order.updateMany({
      where: { id: orderId, status: { notIn: [OrderStatus.DONE, OrderStatus.CANCELLED] }, companionId: null },
      data: { dispatchType: 'DIRECT', companionId },
    });
    if (result.count === 0) throw new ForbiddenException('订单状态已变更或已被删除');
    const updatedOrder = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!updatedOrder) throw new NotFoundException('订单不存在');

    // Auto-bind companion's work wechat to the order
    try {
      const boundWx = await this.prisma.workWechat.findUnique({ where: { companionId } });
      if (boundWx) {
        const cf = (updatedOrder.customFields as any) || {};
        await this.prisma.order.update({
          where: { id: orderId },
          data: { customFields: { ...cf, workWechatId: boundWx.id, workWechatName: boundWx.wechatId } },
        });
      }
    } catch (err) {
      logger.warn('Dispatch operation failed', { error: (err as Error).message });
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
    await this.assertCustomerNotAddedByCurrentWechat(companionId, order.customerId);

    // Atomic update with status guard (C1 fix)
    const result = await this.prisma.order.updateMany({
      where: { id: orderId, companionId, status: OrderStatus.PENDING },
      data: { status: OrderStatus.GRABBED, grabbedAt: new Date() },
    });
    if (result.count === 0) throw new ForbiddenException('订单状态已变更');

    // Auto-bind companion's work wechat to the order
    try {
      const boundWx = await this.prisma.workWechat.findUnique({ where: { companionId } });
      if (boundWx) {
        const existing = await this.prisma.order.findUnique({ where: { id: orderId }, select: { customFields: true } });
        const cf = (existing?.customFields as any) || {};
        await this.prisma.order.update({
          where: { id: orderId },
          data: { customFields: { ...cf, workWechatId: boundWx.id, workWechatName: boundWx.wechatId } },
        });
      }
    } catch (err) {
      logger.warn('Dispatch operation failed', { error: (err as Error).message });
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
    await this.refreshCompanionAvailable(companionId);
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async quickGrab(orderId: string, companionId: string) {
    // First fetch order to get customerId and validate
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customerId: true, studioId: true, dispatchType: true, csUserId: true, type: true, source: true, amount: true, customFields: true, gameName: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.dispatchType !== 'POOL') throw new ForbiddenException('该订单不在抢单池中');
    const orderCf = (order.customFields as any) || {};
    if (orderCf.poolExpired) throw new ForbiddenException('该订单已超时，仅客服可处理');

    // Prevent self-grabbing
    const comp = await this.prisma.companion.findUnique({ where: { id: companionId }, select: { userId: true, studioId: true } });
    if (comp && comp.userId === order.csUserId) throw new ForbiddenException('不能抢自己发布的订单');
    await this.assertCustomerNotAddedByCurrentWechat(companionId, order.customerId);

    // 每日「立即打」名额（取代原来的流水门槛，见 companion-quota.service.ts）
    const creator = await this.prisma.user.findUnique({ where: { id: order.csUserId }, select: { role: true } });
    const isPeerOrder = creator?.role === 'COMPANION';
    const isImmediate = (order.customFields as any)?.urgency !== 'later';
    const countsQuota = isImmediate && !isPeerOrder;
    // 先扣名额，抢单失败再退回去（并发安全）
    const reserved = countsQuota ? await this.quota.reserve(companionId) : null;
    if (reserved && !reserved.ok) {
      throw new ForbiddenException(
        `今天的「立即打」名额用完了（${reserved.tier} 每天 ${reserved.dailyLimit} 个），可以抢预约单或等明天`,
      );
    }

    // Atomic grab with status guard (C1 fix)
    const result = await this.prisma.order.updateMany({
      where: { id: orderId, companionId: null, status: OrderStatus.PENDING },
      data: { status: OrderStatus.GRABBED, companionId, grabbedAt: new Date() },
    });
    if (result.count === 0) {
      if (reserved) await this.quota.refund(companionId);
      throw new ForbiddenException('已被其他陪玩抢先或订单状态已变更');
    }

    // Auto-bind companion's work wechat to the order
    try {
      const boundWx = await this.prisma.workWechat.findUnique({ where: { companionId } });
      if (boundWx) {
        const existing = await this.prisma.order.findUnique({ where: { id: orderId }, select: { customFields: true } });
        const cf = (existing?.customFields as any) || {};
        await this.prisma.order.update({
          where: { id: orderId },
          data: { customFields: { ...cf, workWechatId: boundWx.id, workWechatName: boundWx.wechatId } },
        });
      }
    } catch (err) {
      logger.warn('Dispatch operation failed', { error: (err as Error).message });
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
