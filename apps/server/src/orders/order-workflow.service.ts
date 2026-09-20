// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { OrderStatus } from '@chunlv/shared';
import { logger } from '../common/logger';
import { CompanionQuotaService } from './companion-quota.service';
import { companionOrderRevenue } from '../common/order-revenue';

export const VALID_TRANSITIONS: Record<string, string[]> = {
  [OrderStatus.PENDING]: [OrderStatus.GRABBED, OrderStatus.CLAIMED, OrderStatus.CANCELLED],
  [OrderStatus.CLAIMED]: [OrderStatus.PENDING, OrderStatus.CANCELLED],
  [OrderStatus.GRABBED]: [OrderStatus.CONFIRMED, OrderStatus.DONE, OrderStatus.CANCELLED, OrderStatus.PENDING], // H2: allow re-pool; allow direct complete (unified flow)
  [OrderStatus.CONFIRMED]: [OrderStatus.DONE, OrderStatus.CANCELLED],
};

@Injectable()
export class OrderWorkflowService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
    private bridgeService: BridgeService,
    private readonly quota: CompanionQuotaService,
  ) {}

  validateTransition(order: { id: string; status: string }, targetStatus: string) {
    const allowed = VALID_TRANSITIONS[order.status];
    if (!allowed || !allowed.includes(targetStatus)) {
      throw new ForbiddenException(`不允许从 ${order.status} 转换到 ${targetStatus}`);
    }
  }

  private async refreshCompanionAvailable(companionId: string) {
    await this.prisma.companion
      .update({ where: { id: companionId }, data: { status: 'AVAILABLE' } })
      .catch(() => {});
    await this.wsGateway.refreshCompanionBlacklist(companionId);
  }

  async grab(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.GRABBED);
    if (order.dispatchType !== 'POOL' || order.companionId !== null) {
      throw new ForbiddenException('该订单不可抢');
    }
    const orderCf = (order.customFields as any) || {};
    if (orderCf.poolExpired) {
      throw new ForbiddenException('该订单已超时，仅客服可处理');
    }

    // 客户只跟工作微信有关：当前工作微信只要「添加成功」过该客户（添加失败不算），就拦截；
    // 不管张三李四，谁绑了同一个微信都一样；换了新微信后可以再接。
    const currentWorkWechat = await this.prisma.workWechat.findUnique({
      where: { companionId },
      select: { wechatId: true },
    });
    if (currentWorkWechat?.wechatId) {
      const addedOrders = await this.prisma.order.findMany({
        where: { customerId: order.customerId, contactStatus: 'added' },
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

    // Prevent self-grabbing: companion can't grab their own created order
    const comp = await this.prisma.companion.findUnique({ where: { id: companionId }, select: { userId: true } });
    if (comp && comp.userId === order.csUserId) {
      throw new ForbiddenException('不能抢自己发布的订单');
    }

    // 每日「立即打」名额：老板 2026-09-20 拍板，用名额取代原来的「流水门槛」。
    // 预约单、客服指定单、陪玩自己发的单都不占名额。
    const creator = await this.prisma.user.findUnique({
      where: { id: order.csUserId },
      select: { role: true },
    });
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

    // Atomic grab: WHERE includes companionId:null + status:PENDING to prevent race
    const updatedOrder = await this.prisma.order.updateMany({
      where: { id: orderId, companionId: null, status: OrderStatus.PENDING },
      data: { status: OrderStatus.GRABBED, companionId, grabbedAt: new Date() },
    });

    if (updatedOrder.count === 0) {
      if (reserved) await this.quota.refund(companionId);
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

    // Auto-bind companion's work wechat to the order
    try {
      const boundWx = await this.prisma.workWechat.findUnique({ where: { companionId } });
      if (boundWx) {
        const cf = (grabbedOrder.customFields as any) || {};
        await this.prisma.order.update({
          where: { id: orderId },
          data: { customFields: { ...cf, workWechatId: boundWx.id, workWechatName: boundWx.wechatId } },
        });
      }
    } catch (err) {
      logger.error('WorkWechat auto-bind failed during grab', { error: (err as Error).message });
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
    // 客户归属在「确认开始服务（打了首单）」时才绑定，抢单/指定阶段不绑。
    if (order.customerId && order.companionId) {
      await this.prisma.customer
        .updateMany({ where: { id: order.customerId }, data: { companionId: order.companionId } })
        .catch(() => {});
    }
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

    // Step 1: Atomic status update first — prevents double-complete race
    const statusUpdated = await this.prisma.order.updateMany({
      where: { id: orderId, status: { in: ['CONFIRMED', 'GRABBED'] } },
      data: { status: OrderStatus.DONE },
    });
    if (statusUpdated.count === 0) throw new ForbiddenException('订单状态已变更，请刷新');

    // Step 2: Revenue updates (only after status is safely set)
    if (order.companionId && order.amount) {
      try {
        const primaryRevenue = companionOrderRevenue(order, order.companionId);
        await this.prisma.companion.update({
          where: { id: order.companionId },
          data: { monthlyRevenue: { increment: primaryRevenue } },
        });
        if (order.coCompanionId) {
          const coRevenue = companionOrderRevenue(order, order.coCompanionId);
          if (coRevenue > 0) {
            await this.prisma.companion
              .update({ where: { id: order.coCompanionId }, data: { monthlyRevenue: { increment: coRevenue } } })
              .catch(() => {});
          }
        }
      } catch (err) {
        logger.error('Revenue update failed during complete', { error: (err as Error).message });
      }
    }

    // 客户归属跟随最新接单的陪玩（谁接的单就归谁）
    if (order.companionId) {
      try {
        await this.prisma.customer.updateMany({
          where: { id: order.customerId },
          data: { companionId: order.companionId },
        });
      } catch (err) {
        logger.error('Customer assignment failed during complete', { error: (err as Error).message });
      }
    }

    const updated = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (order.companionId) await this.refreshCompanionAvailable(order.companionId);
    if (order.coCompanionId) await this.refreshCompanionAvailable(order.coCompanionId);
    if (updated) this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async cancel(orderId: string, userStudioId?: string, companionId?: string, role?: string, reason?: string) {
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
      data: {
        status: OrderStatus.CANCELLED,
        notes: reason ? (order.notes ? `${order.notes}\n[取消] ${reason}` : `[取消] ${reason}`) : order.notes,
      },
    });
    if (updated.companionId) await this.refreshCompanionAvailable(updated.companionId);
    if (updated.coCompanionId) await this.refreshCompanionAvailable(updated.coCompanionId);
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    if (updated.companionId) {
      this.wsGateway.pushOrder(updated.companionId, updated);
    }
    return updated;
  }
}
