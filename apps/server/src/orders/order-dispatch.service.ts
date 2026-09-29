// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { OrderStatus } from '@chunlv/shared';
import { logger } from '../common/logger';
import { CompanionQuotaService } from './companion-quota.service';
import { assertCustomerNotTakenByCurrentWechat } from './customer-wechat-rule';
import { PoolScope } from '@chunlv/shared';
import { visibleToOwnOffline } from '../common/order-outcome';
import { resolveConfigsRaw } from '../common/studio-config';

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
    // 客服指定派单不算「抢」：客服是主动挑人的，老客户回头要能派回给原来那个陪玩，
    // 所以这里**故意不做**「同一个微信不能抢同一个客户」的判重（老板 2026-09-29：要堵一句话就堵）。
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
    // 陪玩接受「客服指定给他的单」同样不算抢：客服点了名就让他接，否则这张单会卡在这
    // （companionId 已写、状态还是 PENDING，谁都接不走）。判重只管陪玩自己在池子里抢。

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
      select: {
        id: true,
        customerId: true,
        studioId: true,
        dispatchType: true,
        csUserId: true,
        type: true,
        source: true,
        amount: true,
        customFields: true,
        gameName: true,
        poolScope: true,
        createdAt: true,
        releasedToOfflineAt: true,
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.dispatchType !== 'POOL') throw new ForbiddenException('该订单不在抢单池中');
    const orderCf = (order.customFields as any) || {};
    if (orderCf.poolExpired) throw new ForbiddenException('该订单已超时，仅客服可处理');

    // Prevent self-grabbing
    const comp = await this.prisma.companion.findUnique({ where: { id: companionId }, select: { userId: true, studioId: true } });
    if (comp && comp.userId === order.csUserId) throw new ForbiddenException('不能抢自己发布的订单');
    // 「先线上」的单：本店线下陪玩在放行之前抢不了（服务端兜底，池子里本来就不显示）
    if (order.poolScope === PoolScope.ONLINE_FIRST && comp?.studioId === order.studioId) {
      const cfg = await resolveConfigsRaw(this.prisma, order.studioId, ['pool.online_first_release_minutes']);
      const minutes = Number((cfg as Record<string, unknown>)['pool.online_first_release_minutes'] ?? 5);
      if (!visibleToOwnOffline(order, minutes)) {
        throw new ForbiddenException('这张单先给桥接工作室 / 线上俱乐部，暂时还抢不了；客服放给线下后就能抢');
      }
    }
    // 同一个工作微信不能抢同一个客户：这个微信号接过这个客户就拦，换了新微信可以再接。
    await assertCustomerNotTakenByCurrentWechat(this.prisma, companionId, order.customerId);

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
