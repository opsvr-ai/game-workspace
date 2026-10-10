// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { OrderStatus } from '@chunlv/shared';
import { logger } from '../common/logger';
import { CompanionQuotaService } from './companion-quota.service';
import { assertCustomerNotTakenByCurrentWechat } from './customer-wechat-rule';
import { companionOrderRevenue } from '../common/order-revenue';
import { PoolScope } from '@chunlv/shared';
import { visibleToOwnOffline } from '../common/order-outcome';
import { resolveConfigsRaw } from '../common/studio-config';
import { switchCompanionStatus } from '../common/companion-status-switch';

export const VALID_TRANSITIONS: Record<string, string[]> = {
  [OrderStatus.PENDING]: [OrderStatus.GRABBED, OrderStatus.CLAIMED, OrderStatus.CANCELLED],
  [OrderStatus.CLAIMED]: [OrderStatus.PENDING, OrderStatus.CANCELLED],
  [OrderStatus.GRABBED]: [OrderStatus.CONFIRMED, OrderStatus.DONE, OrderStatus.CANCELLED, OrderStatus.PENDING], // H2: allow re-pool; allow direct complete (unified flow)
  [OrderStatus.CONFIRMED]: [OrderStatus.DONE, OrderStatus.CANCELLED],
  // 存单（OrdersService.markDeposit 写的 status=DEPOSITED）：客户先把钱存进来、这次还没打。
  // 以前这张表里没有 DEPOSITED，于是「存单」过的单之后完成 / 取消全被 validateTransition 判成
  // 「不允许从 DEPOSITED 转换到 DONE」—— 单子卡死在那儿（老板 2026-10-08 全链路复查）。
  // 现在补上：客人来了接着打（CONFIRMED）、打完（DONE）、或者不打了取消（CANCELLED）。
  [OrderStatus.DEPOSITED]: [OrderStatus.CONFIRMED, OrderStatus.DONE, OrderStatus.CANCELLED],
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
    // 统一入口：放回空闲的同时把计时日志接上（否则「接单时长」会缺段）。
    await switchCompanionStatus(this.prisma, companionId, 'AVAILABLE');
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

    // 同一个工作微信不能抢同一个客户：这个微信号接过这个客户就拦，换了新微信可以再接；
    // 没绑工作微信的直接拦（提示去绑定），见 customer-wechat-rule.ts。
    await assertCustomerNotTakenByCurrentWechat(
      this.prisma,
      companionId,
      order.customerId,
      ((order.customFields as any) || {}).customerWechat,
    );

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
    // 「线上→线下流转」的单：本店线下陪玩在客服放行（或过了自动放行时间）之前抢不了。
    // 池子里本来就不给他看，这里是服务端兜底 —— 别让人拿旧页面 / 直连接口绕过。
    if (order.poolScope === PoolScope.ONLINE_FIRST && companion.studioId === order.studioId) {
      const cfg = await resolveConfigsRaw(this.prisma, order.studioId, ['pool.online_first_release_minutes']);
      const minutes = Number((cfg as Record<string, unknown>)['pool.online_first_release_minutes'] ?? 5);
      if (!visibleToOwnOffline(order, minutes)) {
        throw new ForbiddenException('这张单先给桥接工作室 / 线上俱乐部，暂时还抢不了；客服放给线下后就能抢');
      }
    }

    // Prevent self-grabbing: companion can't grab their own created order
    const comp = await this.prisma.companion.findUnique({ where: { id: companionId }, select: { userId: true } });
    if (comp && comp.userId === order.csUserId) {
      throw new ForbiddenException('不能抢自己发布的订单');
    }

    // 每日抢单名额（老板 2026-10-04 口径）：抢单那一刻就扣，失败由管理端补单返还。
    // 陪玩自己发的单不占；客服指定单不占；线下工作室的预约单也占，线上俱乐部不占。
    const creator = await this.prisma.user.findUnique({
      where: { id: order.csUserId },
      select: { role: true },
    });
    const isPeerOrder = creator?.role === 'COMPANION';
    const isImmediate = (order.customFields as any)?.urgency !== 'later';
    const studioType = await this.quota.studioTypeOf(order.studioId);
    const countsQuota = this.quota.countsOrder({ isPeerOrder, isImmediate, studioType });
    const quotaRef = { refId: orderId, note: `抢单扣名额 · 订单 ${order.orderCode || orderId}` };
    // 先扣名额，抢单失败再退回去（并发安全）
    const reserved = countsQuota ? await this.quota.reserve(companionId, 1, quotaRef) : null;
    if (reserved && !reserved.ok) {
      throw new ForbiddenException(
        `今天的抢单名额用完了（${reserved.tier} ${reserved.dailyLimit} 个/天，没用完的会累计）；可以等明天，或让客服直接指定派单`,
      );
    }

    // Atomic grab: WHERE includes companionId:null + status:PENDING to prevent race
    const updatedOrder = await this.prisma.order.updateMany({
      where: { id: orderId, companionId: null, status: OrderStatus.PENDING },
      data: { status: OrderStatus.GRABBED, companionId, grabbedAt: new Date() },
    });

    if (updatedOrder.count === 0) {
      if (reserved) await this.quota.refund(companionId, 1, quotaRef);
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
    // 老板 2026-10-11：「童祥瑞点复购开单，打了一个多小时、单价填 50，结束服务后业绩只加了 50」——
    // 业绩一直按**下单那一刻预填的** `Order.amount`（时长 × 单价，时长默认 1）算，真正打了多久
    // 只写进了 `Order.auditAmountCents`，从来没进过业绩。这里改成「逐段真实时长 × 该段单价」，
    // 并把订单金额一起回写 —— 订单管理那一列跟业绩永远是同一个数。
    const actualCharge = await this.revenueByActualHours(order).catch(() => null);
    let revenueOrder: any = order;
    if (actualCharge && actualCharge.amount > 0) {
      const patch: any = { amount: actualCharge.amount };
      if (actualCharge.coAmount != null) patch.coAmount = actualCharge.coAmount;
      await this.prisma.order.update({ where: { id: orderId }, data: patch }).catch(() => {});
      revenueOrder = { ...order, ...patch };
    }
    if (revenueOrder.companionId && revenueOrder.amount) {
      try {
        const primaryRevenue = companionOrderRevenue(revenueOrder, revenueOrder.companionId);
        await this.prisma.companion.update({
          where: { id: revenueOrder.companionId },
          data: { monthlyRevenue: { increment: primaryRevenue } },
        });
        if (revenueOrder.coCompanionId) {
          const coRevenue = companionOrderRevenue(revenueOrder, revenueOrder.coCompanionId);
          if (coRevenue > 0) {
            await this.prisma.companion
              .update({ where: { id: revenueOrder.coCompanionId }, data: { monthlyRevenue: { increment: coRevenue } } })
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

  /**
   * 按「每段真实时长 × 该段单价」算这张单的真实服务费（老板 2026-10-11）。
   *
   * 为什么要有它：业绩原来 = `Order.amount`（陪玩点「复购 / 续单」时预填的 时长 × 单价，
   * 时长默认就是 1），跟他真正打了多久没关系 —— 打 1 小时是 +50，打 3 分钟也是 +50，
   * 打 7 小时还是 +50。真实时长其实一直在库里（会话的 startedAt / endedAt / 暂停秒数），
   * 单价也在（claimedPrice；搭档看 coAmount ÷ 计划时长）—— 这里把它俩乘起来。
   *
   * 口径：
   *   · 主陪：该段 `claimedPrice`（没填就退回 订单金额 ÷ 计划时长）
   *   · 搭档：该段 `coAmount` ÷ 该段计划时长
   *   · 只算已经落库结束（status=DONE、endedAt 有值）的段；还在打的段不算
   *   · 一段都算不出来（客服直接改状态完成、压根没有会话）→ 返回 null，调用方退回老口径
   */
  private async revenueByActualHours(
    order: { id: string; companionId?: string | null; coCompanionId?: string | null },
  ): Promise<{ amount: number; coAmount: number | null } | null> {
    const sessions = await this.prisma.orderSession.findMany({
      where: { parentOrderId: order.id, status: 'DONE', startedAt: { not: null } },
      select: {
        companionId: true,
        coCompanionId: true,
        startedAt: true,
        endedAt: true,
        totalPausedSec: true,
        amount: true,
        coAmount: true,
        duration: true,
        claimedPrice: true,
      },
    });
    const list = sessions || [];
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const hoursOf = (s: (typeof list)[number]): number => {
      if (!s.endedAt || !s.startedAt) return 0;
      const sec =
        (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000 -
        (s.totalPausedSec || 0);
      return Math.max(0, sec) / 3600;
    };
    let primary = 0;
    let co = 0;
    let primaryMatched = false;
    let coMatched = false;
    for (const s of list) {
      const h = hoursOf(s);
      if (h <= 0) continue;
      const planned = Number(s.duration) || 0;
      if (order.companionId && s.companionId === order.companionId) {
        const unit =
          Number(s.claimedPrice) || (planned > 0 ? Number(s.amount) / planned : Number(s.amount) || 0);
        if (unit > 0) {
          primary += h * unit;
          primaryMatched = true;
        }
      }
      if (order.coCompanionId && s.coCompanionId === order.coCompanionId) {
        const unit = planned > 0 ? (Number(s.coAmount) || 0) / planned : Number(s.coAmount) || 0;
        if (unit > 0) {
          co += h * unit;
          coMatched = true;
        }
      }
    }
    if (!primaryMatched && !coMatched) return null;
    return { amount: round2(primary), coAmount: coMatched ? round2(co) : null };
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
