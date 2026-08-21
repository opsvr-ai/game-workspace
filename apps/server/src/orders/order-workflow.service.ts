// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { OrderStatus } from '@chunlv/shared';
import { logger } from '../common/logger';
import { currentBusinessDayRange } from '../common/business-day';
import { ExcellenceService } from '../companions/excellence.service';
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
    private readonly excellence: ExcellenceService,
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
  }

  async grab(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.GRABBED);
    if (order.dispatchType !== 'POOL' || order.companionId !== null) {
      throw new ForbiddenException('该订单不可抢');
    }

    // 跨小红书账号去重：只有“同一陪玩 + 同一当前工作微信 + 已服务过该客户微信”才拦截。
    const orderCustomer = await this.prisma.customer.findUnique({
      where: { id: order.customerId },
      select: { wechatId: true },
    });
    const customerWechat = ((order.customFields as any)?.customerWechat || orderCustomer?.wechatId || '').trim();
    if (customerWechat) {
      const currentWorkWechat = await this.prisma.workWechat.findUnique({
        where: { companionId },
        select: { wechatId: true },
      });
      const servedOrders = await this.prisma.order.findMany({
        where: {
          companionId,
          status: 'DONE',
          customer: { wechatId: customerWechat },
        },
        select: { customFields: true },
      });
      const currentWx = currentWorkWechat?.wechatId || '';
      const alreadyServedWithCurrentWx = servedOrders.some((o) => {
        const wx = ((o.customFields as any)?.workWechatName || '').trim();
        return currentWx && wx === currentWx;
      });
      if (alreadyServedWithCurrentWx) {
        throw new ForbiddenException('该客户微信已由你当前工作微信添加并服务过，请更换订单');
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

    // 新客首单：线下非上等马陪玩不能抢，避免新客被浪费
    if (order.type === 'NEW' && companion.studioId === order.studioId) {
      const ex = await this.excellence.computeOne(companionId);
      const tier = ex.tier || 'LOW';
      const limitKey = tier === 'TOP'
        ? 'dispatch.top_tier_daily_new_limit'
        : tier === 'MIDDLE'
          ? 'dispatch.middle_tier_daily_new_limit'
          : 'dispatch.low_tier_daily_new_limit';
      const limitCfg = await this.prisma.systemConfig.findUnique({ where: { key: limitKey } });
      const limit = Number(limitCfg?.value ?? (tier === 'TOP' ? 999 : tier === 'MIDDLE' ? 2 : 1));
      const { start: today } = currentBusinessDayRange();
      const todayNew = await this.prisma.order.count({
        where: {
          companionId,
          type: 'NEW',
          status: { in: ['GRABBED', 'CONFIRMED', 'DONE'] },
          contactStatus: { not: 'not_accepted' },
          grabbedAt: { gte: today },
        },
      });
      if (todayNew >= limit) throw new ForbiddenException('新客首单今日名额已用完');
    }

    // Revenue threshold check — skip for peer orders (created by companions)
    const creator = await this.prisma.user.findUnique({ where: { id: order.csUserId }, select: { role: true } });
    const isPeerOrder = creator?.role === 'COMPANION';

    if (!isPeerOrder) {
      const { start: today, end: tomorrow } = currentBusinessDayRange();

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
