// craftsman-ignore: TS001,TS003
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { TRANSFER_REQUEST_TTL_SEC } from './order.constants';

/**
 * 转让申请全链路（发起 / 同意 / 拒绝 / 撤回 / 列表 / 超时清理）。
 *
 * 从 OrdersService 拆出，方法体原样搬运，行为与拆分前一致。
 */
@Injectable()
export class OrderTransferService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
  ) {}

  /** 超时没人处理的转让申请置为 EXPIRED，并通知双方（老板 2026-10-03）。 */
  async cleanupExpiredTransferRequests(): Promise<void> {
    const cutoff = new Date(Date.now() - TRANSFER_REQUEST_TTL_SEC * 1000);
    const stale = await this.prisma.orderTransferRequest
      .findMany({
        where: { status: 'PENDING', createdAt: { lt: cutoff } },
        select: { id: true, orderId: true, fromCompanionId: true, toCompanionId: true },
      })
      .catch(() => []);
    for (const r of stale) {
      const res = await this.prisma.orderTransferRequest
        .updateMany({
          where: { id: r.id, status: 'PENDING' },
          data: { status: 'EXPIRED', resolvedAt: new Date() },
        })
        .catch(() => ({ count: 0 }));
      if (!res.count) continue;
      this.wsGateway.pushToCompanion(r.fromCompanionId, 'order:transfer_expired', {
        requestId: r.id,
        orderId: r.orderId,
        role: 'from',
        message: '转让申请长时间没被确认，已自动作废',
      });
      this.wsGateway.pushToCompanion(r.toCompanionId, 'order:transfer_expired', {
        requestId: r.id,
        orderId: r.orderId,
        role: 'to',
        message: '这条转让申请已经过期',
      });
    }
  }

  /**
   * 陪玩发起「转让申请」（老板 2026-10-03：「想转让的订单，需要被转让方同意才能过来，要不然乱套了」）。
   *
   * 「抢单超时自动回收」已经整条删除 —— 是谁抢的就是谁的；换手只剩这一条路：
   * 加了很久客户没通过、或者客户不满意，接单陪玩自己把归属调给同工作室的另一个人。
   *
   * 但**不再点一下就换手**：这里只落一条 PENDING 申请 + 推给被转让方，等他同意
   * （acceptTransferRequest）才真正换人。拒绝 / 撤回 / 30 分钟没人理（EXPIRED）都作废，订单原样不动。
   *
   * 同一张单同时只保留一条 PENDING：重新发起（换个对象 / 再点一次）就把旧的顶掉，
   * 并推一条 transfer_cancelled 给旧对象，免得两个人同时举着同一张单的申请。
   */
  async requestTransfer(
    orderId: string,
    fromCompanionId: string,
    toCompanionId: string,
    reason?: string,
  ) {
    if (!fromCompanionId) throw new ForbiddenException('只有接单陪玩本人能发起转让');
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        companion: {
          select: {
            id: true,
            studioId: true,
            userId: true,
            user: { select: { username: true, displayName: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.companionId !== fromCompanionId) throw new ForbiddenException('这张单不在你名下，转让不了');
    if (order.status !== 'GRABBED' && order.status !== 'CONFIRMED') {
      throw new ForbiddenException('只有已抢单 / 已确认、还没开始服务的订单能转让');
    }
    if (!toCompanionId) throw new BadRequestException('请选择要转让给谁');
    if (toCompanionId === fromCompanionId) throw new BadRequestException('不能转让给自己');

    const startedCount = await this.prisma.orderSession.count({
      where: { parentOrderId: orderId, startedAt: { not: null } },
    });
    if (startedCount > 0) throw new ForbiddenException('这张单已经开始服务了，要换人请联系客服');

    const target = await this.prisma.companion.findUnique({
      where: { id: toCompanionId },
      select: {
        id: true,
        studioId: true,
        userId: true,
        isResigned: true,
        user: { select: { username: true, displayName: true } },
      },
    });
    if (!target) throw new NotFoundException('要转让的陪玩不存在');
    if (target.isResigned) throw new ForbiddenException('该陪玩已离职，转让不了');
    if (order.companion?.studioId && target.studioId !== order.companion.studioId) {
      throw new ForbiddenException('只能转让给同一工作室的陪玩');
    }

    const now = new Date();
    const note = (reason || '').trim() || null;

    // 顶掉这张单上原有的待确认申请（重新发起 / 换个人），并通知被顶掉的那位。
    const previous = await this.prisma.orderTransferRequest.findMany({
      where: { orderId, status: 'PENDING' },
      select: { id: true, toCompanionId: true },
    });
    if (previous.length) {
      await this.prisma.orderTransferRequest.updateMany({
        where: { id: { in: previous.map((p) => p.id) } },
        data: { status: 'CANCELLED', resolvedAt: now },
      });
      for (const p of previous) {
        if (p.toCompanionId === toCompanionId) continue;
        this.wsGateway.pushToCompanion(p.toCompanionId, 'order:transfer_cancelled', {
          requestId: p.id,
          orderId,
          message: '这条转让申请已被对方撤回',
        });
      }
    }

    const request = await this.prisma.orderTransferRequest.create({
      data: { orderId, fromCompanionId, toCompanionId, reason: note, status: 'PENDING', createdAt: now },
    });

    const fromName = order.companion?.user?.displayName || order.companion?.user?.username || '同事';
    this.wsGateway.pushToCompanion(toCompanionId, 'order:transfer_requested', {
      requestId: request.id,
      orderId,
      orderCode: order.orderCode,
      gameName: order.gameName,
      amount: order.amount,
      fromCompanionId,
      fromName,
      reason: note,
      expiresInSec: TRANSFER_REQUEST_TTL_SEC,
    });
    return {
      id: request.id,
      status: 'PENDING' as const,
      toCompanionId,
      toName: target.user?.displayName || target.user?.username || '',
      expiresInSec: TRANSFER_REQUEST_TTL_SEC,
    };
  }

  /**
   * 被转让方同意 → 真正换手（老板 2026-10-03）。
   *
   * 换手是这个系统的老逻辑（写 OrderTransfer 留痕 + 换 companionId/grabbedAt + 客户归属跟着转 +
   * 清掉联系进度 + 主副陪撞车时对调），只是现在改为「对方点同意」之后才跑。同意时会把
   * 申请先原子地置成 PROCESSING 当作锁：两个人同时点 / 点了两次都只会换一次手，失败再退回 PENDING。
   */
  async acceptTransferRequest(requestId: string, toCompanionId: string) {
    if (!toCompanionId) throw new ForbiddenException('只有陪玩本人能确认转让');
    const request = await this.prisma.orderTransferRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('转让申请不存在');
    if (request.toCompanionId !== toCompanionId) throw new ForbiddenException('这条转让申请不是给你的');
    if (request.status !== 'PENDING') throw new BadRequestException('这条转让申请已经处理过了');

    const order = await this.prisma.order.findUnique({
      where: { id: request.orderId },
      include: {
        companion: {
          select: {
            id: true,
            studioId: true,
            userId: true,
            user: { select: { username: true, displayName: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.companionId !== request.fromCompanionId) {
      throw new BadRequestException('这张单已经不在对方名下了，转让作废');
    }
    if (order.status !== 'GRABBED' && order.status !== 'CONFIRMED') {
      throw new BadRequestException('这张单现在不能转让了');
    }
    const startedCount = await this.prisma.orderSession.count({
      where: { parentOrderId: order.id, startedAt: { not: null } },
    });
    if (startedCount > 0) throw new BadRequestException('这张单已经开始服务了，转让作废');

    const me = await this.prisma.companion.findUnique({
      where: { id: toCompanionId },
      select: { id: true, userId: true, isResigned: true, user: { select: { username: true, displayName: true } } },
    });
    if (!me || me.isResigned) throw new ForbiddenException('你已经不能接单了');

    // 原子占位：只有还把 PENDING 的那个人抢得到，避免重复换手。
    const claim = await this.prisma.orderTransferRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    if (claim.count !== 1) throw new BadRequestException('这条转让申请已经处理过了');

    let updated: any;
    try {
      updated = await this.applyTransfer(
        order,
        request.fromCompanionId,
        toCompanionId,
        request.reason,
        order.companion?.userId ?? null,
        me.userId ?? null,
        order.companion?.user?.displayName || order.companion?.user?.username || '同事',
      );
    } catch (err) {
      await this.prisma.orderTransferRequest
        .updateMany({ where: { id: requestId, status: 'PROCESSING' }, data: { status: 'PENDING' } })
        .catch(() => {});
      throw err;
    }

    await this.prisma.orderTransferRequest.update({
      where: { id: requestId },
      data: { status: 'ACCEPTED', resolvedAt: new Date() },
    });
    const myName = me.user?.displayName || me.user?.username || '同事';
    this.wsGateway.pushToCompanion(request.fromCompanionId, 'order:transfer_accepted', {
      requestId,
      orderId: order.id,
      orderCode: order.orderCode,
      gameName: order.gameName,
      toCompanionId,
      toName: myName,
      message: `${myName} 已同意转让，这张单交给他了`,
    });
    return updated;
  }

  /** 被转让方拒绝：申请作废，订单不动，只通知发起人。 */
  async rejectTransferRequest(requestId: string, toCompanionId: string, reason?: string) {
    if (!toCompanionId) throw new ForbiddenException('只有陪玩本人能拒绝转让');
    const request = await this.prisma.orderTransferRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('转让申请不存在');
    if (request.toCompanionId !== toCompanionId) throw new ForbiddenException('这条转让申请不是给你的');
    const res = await this.prisma.orderTransferRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: 'REJECTED', resolvedAt: new Date() },
    });
    if (res.count !== 1) throw new BadRequestException('这条转让申请已经处理过了');

    const me = await this.prisma.companion
      .findUnique({ where: { id: toCompanionId }, select: { user: { select: { username: true, displayName: true } } } })
      .catch(() => null);
    const myName = me?.user?.displayName || me?.user?.username || '对方';
    this.wsGateway.pushToCompanion(request.fromCompanionId, 'order:transfer_rejected', {
      requestId,
      orderId: request.orderId,
      toCompanionId,
      byName: myName,
      reason: (reason || '').trim() || null,
      message: `${myName} 拒绝了你的转让申请`,
    });
    return { ok: true };
  }

  /** 发起人撤回还没被确认的转让申请。 */
  async cancelTransferRequest(requestId: string, fromCompanionId: string) {
    if (!fromCompanionId) throw new ForbiddenException('只有本人能撤回转让申请');
    const request = await this.prisma.orderTransferRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('转让申请不存在');
    if (request.fromCompanionId !== fromCompanionId) throw new ForbiddenException('只有发起人能撤回');
    const res = await this.prisma.orderTransferRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: 'CANCELLED', resolvedAt: new Date() },
    });
    if (res.count !== 1) throw new BadRequestException('这条转让申请已经处理过了');
    this.wsGateway.pushToCompanion(request.toCompanionId, 'order:transfer_cancelled', {
      requestId,
      orderId: request.orderId,
      message: '对方撤回了转让申请',
    });
    return { ok: true };
  }

  /**
   * 我这个陪玩名下待处理的转让申请（老板 2026-10-03）。
   * incoming = 别人要转给我的（我点同意 / 拒绝）；outgoing = 我发起的（等对方同意，可以撤回）。
   * 陪玩端刷新 / 重连后靠它把弹窗和「转让」按钮的状态补回来（WS 只负责实时提醒）。
   */
  async listMyTransferRequests(companionId: string) {
    if (!companionId) return { incoming: [], outgoing: [] };
    const [incoming, outgoing] = await this.prisma.$transaction([
      this.prisma.orderTransferRequest.findMany({
        where: { toCompanionId: companionId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.orderTransferRequest.findMany({
        where: { fromCompanionId: companionId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    const rows = [...incoming, ...outgoing];
    const orderIds = Array.from(new Set(rows.map((r) => r.orderId)));
    const orders = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderCode: true, gameName: true, amount: true, companionId: true, status: true },
        })
      : [];
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const companionIds = Array.from(new Set([...incoming.map((r) => r.fromCompanionId), ...outgoing.map((r) => r.toCompanionId)]));
    const companions = companionIds.length
      ? await this.prisma.companion.findMany({
          where: { id: { in: companionIds } },
          select: { id: true, user: { select: { username: true, displayName: true } } },
        })
      : [];
    const nameMap = new Map(companions.map((c) => [c.id, c.user?.displayName || c.user?.username || '']));
    const base = (r: any) => {
      const o = orderMap.get(r.orderId);
      return {
        requestId: r.id,
        orderId: r.orderId,
        orderCode: o?.orderCode || '',
        gameName: o?.gameName || '',
        amount: o?.amount ?? 0,
        reason: r.reason,
        createdAt: r.createdAt,
        expiresAt: r.createdAt.getTime() + TRANSFER_REQUEST_TTL_SEC * 1000,
      };
    };
    return {
      incoming: incoming.map((r) => {
        const o = orderMap.get(r.orderId);
        return {
          ...base(r),
          fromCompanionId: r.fromCompanionId,
          fromName: nameMap.get(r.fromCompanionId) || '',
          // 这张单还在对方名下、还能转 —— 不满足就是「已经作废了」，客户端别把它当成有效申请。
          valid:
            !!o &&
            o.companionId === r.fromCompanionId &&
            (o.status === 'GRABBED' || o.status === 'CONFIRMED'),
        };
      }),
      outgoing: outgoing.map((r) => ({
        ...base(r),
        toCompanionId: r.toCompanionId,
        toName: nameMap.get(r.toCompanionId) || '',
      })),
    };
  }

  /**
   * 真正的换手动作（老板 2026-09-29 的转让逻辑，2026-10-03 起只在对方同意后调用）：
   *   - 订单 companionId / grabbedAt 换成新人（新人的「接单记录」里立刻出现）；
   *   - OrderTransfer 留痕，转出方的「接单记录」里这张单不消失，标成「已于某时转让给某人」；
   *   - 客户归属如果本来挂在这个人身上，一并转给新人（客户管理里看得到）；
   *   - 联系状态重置（新人得重新加客户微信），副陪撞车时与转出方对调。
   */
  private async applyTransfer(
    order: any,
    fromCompanionId: string,
    toCompanionId: string,
    reason: string | null,
    fromUserId: string | null,
    toUserId: string | null,
    fromName: string,
  ) {
    const now = new Date();
    // 要转给的人正好是副陪时，两个人对调，别让同一张单的主副陪变成同一个人。
    const nextCoCompanionId = order.coCompanionId === toCompanionId ? fromCompanionId : order.coCompanionId;
    const [, updated] = await this.prisma.$transaction([
      this.prisma.orderTransfer.create({
        data: {
          orderId: order.id,
          fromCompanionId,
          toCompanionId,
          fromUserId,
          toUserId,
          reason,
          createdAt: now,
        },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: {
          companionId: toCompanionId,
          coCompanionId: nextCoCompanionId,
          grabbedAt: now,
          contactStatus: null,
          screenshotUrl: null,
        },
      }),
      this.prisma.customer.updateMany({
        where: { id: order.customerId, companionId: fromCompanionId },
        data: { companionId: toCompanionId },
      }),
    ]);

    this.wsGateway.pushOrder(toCompanionId, updated);
    // 单独给新人一条「有人转让订单给你」的提醒（order:new 只刷新池子，不弹提示）。
    this.wsGateway.pushToCompanion(toCompanionId, 'order:transferred', {
      orderId: updated.id,
      orderCode: updated.orderCode,
      gameName: updated.gameName,
      amount: updated.amount,
      toCompanionId,
      fromCompanionId,
      fromName,
      reason,
    });
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
  }
}
