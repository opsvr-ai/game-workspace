// craftsman-ignore: TS001,TS003
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { CompanionQuotaService, QUOTA_REASON } from './companion-quota.service';
import { currentBusinessDayRange } from '../common/business-day';
import { OrderOutcome } from '@chunlv/shared';
import { orderChannelOf } from '../common/order-outcome';
import { SUPPLEMENT_TYPE } from './order.constants';

/** 同意补单后，隔多久提醒管理端去核查「这个客户后来到底通过了没有」（小时）。 */
const SUPPLEMENT_REVIEW_HOURS = 24;
/** 第一次「仍未通过」之后，再过 7 天提醒管理端核查一次（第二次点仍未通过就结案）。 */
const SUPPLEMENT_REVIEW_AGAIN_HOURS = 7 * 24;
/** 管理端直接补单时给记录打的标记（老板 2026-10-08：订单管理里「退款」改成「补单」）。 */
const ADMIN_SUPPLEMENT_TAG = '【管理端补单】';
/** 退单申请类型（与补单共用一张申请表）。 */
const REFUND_TYPE = 'REFUND';

/**
 * 订单异常处理：补单 / 退单 / 报结果 / 客服核对 / 店长拍板 / 成交核对清单 / 催反馈。
 *
 * 从 OrdersService 拆出，方法体原样搬运，行为与拆分前一致。
 */
@Injectable()
export class OrderExceptionService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
    private bridgeService: BridgeService,
    private quota: CompanionQuotaService,
  ) {}

  /** 管理端能看到的工作室范围；老板不限（返回 null = 不过滤）。 */
  private async supplementScopeIds(user: any): Promise<string[] | null> {
    if (user?.role === 'OWNER' || !user?.studioId) return null;
    return this.bridgeService.getVisibleStudioIds(user.studioId);
  }

  /**
   * 补单申请列表（客服 / 店长 / 老板）。
   * scope = 'pending' 只看待审；'due' 只看「已同意、到期要核查客户后来通过没」；
   * 'records' 只看已经同意过的（含管理端直接补单，按处理时间倒序）—— 老板要一眼看清今天给谁补过名额；
   * 不传看全部。
   */
  async listSupplements(user: any, scope?: 'pending' | 'due' | 'records' | 'all') {
    if (!['OWNER', 'ADMIN', 'CS'].includes(user?.role ?? '')) {
      throw new ForbiddenException('只有客服 / 店长 / 老板能看补单申请');
    }
    const visibleIds = await this.supplementScopeIds(user);
    const where: any = {};
    if (visibleIds) where.studioId = { in: visibleIds };
    let orderBy: any = { createdAt: 'desc' };
    if (scope === 'pending') {
      where.status = 'PENDING';
    } else if (scope === 'due') {
      // 「客户后来到底通过了没有」只对「添加失败」的补单有意义，退单没这一步。
      where.type = SUPPLEMENT_TYPE;
      where.status = 'APPROVED';
      where.reviewStatus = { in: ['PENDING', 'STILL_NOT'] };
      where.reviewDueAt = { lte: new Date() };
    } else if (scope === 'records') {
      // 已经同意过的（含管理端直接补单 + 同意的退单）：按处理时间倒序，谁批的、什么时候批的一目了然
      where.status = 'APPROVED';
      where.decidedAt = { not: null };
      orderBy = { decidedAt: 'desc' };
    } else {
      where.status = { in: ['PENDING', 'APPROVED', 'REJECTED'] };
    }
    const rows = await this.prisma.supplementRequest.findMany({
      where,
      orderBy,
      take: 200,
    });
    if (!rows.length) return [];
    const orderIds = rows.map((r) => r.orderId);
    const companionIds = [...new Set(rows.map((r) => r.companionId))];
    const [orders, companions] = await Promise.all([
      this.prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          orderCode: true,
          type: true,
          status: true,
          amount: true,
          gameName: true,
          contactStatus: true,
          customerId: true,
          customFields: true,
        },
      }),
      this.prisma.companion.findMany({
        where: { id: { in: companionIds } },
        select: { id: true, user: { select: { username: true, displayName: true } } },
      }),
    ]);
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const nameMap = new Map(
      companions.map((c) => [c.id, c.user?.displayName || c.user?.username || null]),
    );
    const deciderIds = [...new Set(rows.map((r) => r.decidedByUserId).filter(Boolean))] as string[];
    const deciders = deciderIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: deciderIds } },
          select: { id: true, username: true, displayName: true },
        })
      : [];
    const deciderMap = new Map(deciders.map((u) => [u.id, u.displayName || u.username || null]));
    return rows.map((r) => {
      const order = orderMap.get(r.orderId) ?? null;
      const cf = (order?.customFields as any) || {};
      return {
        ...r,
        companionName: nameMap.get(r.companionId) ?? null,
        decidedByName: r.decidedByUserId ? deciderMap.get(r.decidedByUserId) ?? null : null,
        byAdmin: String(r.reason ?? '').startsWith(ADMIN_SUPPLEMENT_TAG),
        order: order
          ? {
              id: order.id,
              orderCode: order.orderCode,
              type: order.type,
              status: order.status,
              amount: order.amount,
              gameName: order.gameName,
              contactStatus: order.contactStatus,
              customerId: order.customerId,
              customerWechat: cf.customerWechat ?? null,
              customerSource: cf.customerSource ?? null,
            }
          : null,
      };
    });
  }

  /**
   * 管理端顶部红点用的数量：待审几条、到期要核查几条、本营业日已经补出去几个名额。
   *
   * `approvedToday` 是老板 2026-10-08 要的：订单管理页那句「今日抢单 · 补单 · 合计」
   * 以前是拿当前列表里的备注猜「补单」两个字，根本不准 —— 改成读补单记录里真实的数。
   */
  async supplementSummary(user: any) {
    const visibleIds = await this.supplementScopeIds(user);
    const base = visibleIds ? { studioId: { in: visibleIds } } : {};
    const { start, end } = currentBusinessDayRange();
    const [pending, due, approvedToday] = await Promise.all([
      this.prisma.supplementRequest.count({ where: { ...base, status: 'PENDING' } }),
      this.prisma.supplementRequest.count({
        where: {
          ...base,
          type: SUPPLEMENT_TYPE, // 退单没有「客户后来通过没」这一步，不进到期核查
          status: 'APPROVED',
          reviewStatus: { in: ['PENDING', 'STILL_NOT'] },
          reviewDueAt: { lte: new Date() },
        },
      }),
      this.prisma.supplementRequest.count({
        where: {
          ...base,
          type: SUPPLEMENT_TYPE, // 订单管理顶头那句「今日 补单 N」只数补单
          status: 'APPROVED',
          decidedAt: { gte: start, lt: end },
        },
      }),
    ]);
    return { pending, due, approvedToday };
  }

  /**
   * 审核补单（老板 2026-10-04）：同意 = 陪玩次数 +1（写台账），
   * 并排一次「客户后来通过没」的核查，别把这个客户浪费掉；驳回只留痕。
   */
  /**
   * 这张单是不是已经因为「补单 / 退单」返还过名额了（老板 2026-10-08 全链路复查）。
   *
   * 抢单时一张单只扣了 1 个名额，所以最多只能返还 1 个：
   * 「报不成功 → 补单同意」(名额 +1) 之后再「退单同意」，如果再 +1 就是凭空多出来的；
   * 反过来先退单同意、再让管理端直接补单，也一样。
   * 判定：同一张单下已经有一条「已同意」的补单 / 退单记录（不含正在处理的这一条）。
   */
  private async hasReturnedQuota(orderId: string, excludeId: string): Promise<boolean> {
    const row = await this.prisma.supplementRequest
      .findFirst({
        where: { orderId, status: 'APPROVED', id: { not: excludeId } },
        select: { id: true },
      })
      .catch(() => null);
    return !!row;
  }

  async decideSupplement(id: string, decision: string, note: string | undefined, user: any) {
    if (!['OWNER', 'ADMIN', 'CS'].includes(user?.role ?? '')) {
      throw new ForbiddenException('只有客服 / 店长 / 老板能审核补单');
    }
    const req = await this.prisma.supplementRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('补单申请不存在');
    const visibleIds = await this.supplementScopeIds(user);
    if (visibleIds && req.studioId && !visibleIds.includes(req.studioId)) {
      throw new ForbiddenException('无权操作其他工作室的补单申请');
    }
    if (req.status !== 'PENDING') throw new ForbiddenException('这条补单申请已经处理过了');
    const isRefund = req.type === REFUND_TYPE;
    const act = String(decision || '').toUpperCase();

    // 「退单」是两段式（老板 2026-10-08：「客服端审核 无异议到店长这里」，跟「成交核对」一个路子）：
    //   客服这一段：无异议 → 只是把这条**转给店长**（客服点不了「同意退单」）；有异议 → 直接驳回。
    //   店长 / 老板：拍板 —— 同意 = 这张单作废（按退款处理，不计利润与提成、不参与 KPI 计算）+ 陪玩名额 +1；驳回 = 只留痕。
    //   （老板自己是最高权限，哪一段都能直接拍板，不用等客服先点一遍。）
    if (isRefund && user?.role === 'CS' && act !== 'REJECT') {
      const csPassed = await this.prisma.supplementRequest.update({
        where: { id },
        data: {
          csReviewedAt: new Date(),
          csReviewedByUserId: user?.id ?? null,
          csReviewNote: (note || '').trim() || null,
        },
      });
      await this.notifyRefundReviewers(req, ['ADMIN', 'OWNER'], '的退单申请客服已核对、无异议，等你拍板').catch(
        () => null,
      );
      return csPassed;
    }

    const approve = isRefund ? act !== 'REJECT' : act === 'APPROVE';
    // 一张单只返还一次名额：抢单只扣了 1 个，「补单同意」+「退单同意」不能各还一个（老板 2026-10-08 全链路复查）。
    const alreadyReturned = approve ? await this.hasReturnedQuota(req.orderId, req.id) : false;
    const reviewDueAt = new Date(Date.now() + SUPPLEMENT_REVIEW_HOURS * 3600 * 1000);
    const updated = await this.prisma.supplementRequest.update({
      where: { id },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedByUserId: user?.id ?? null,
        decidedAt: new Date(),
        decisionNote: (note || '').trim() || null,
        // 「到期核查」（这个客户后来到底通过了没有）只有补单才有这一步；退单同意就结束。
        ...(approve && !isRefund ? { reviewDueAt, reviewStatus: 'PENDING' } : {}),
      },
    });
    if (approve && isRefund) {
      // 同意退单 = 这张单没打成：按「退款」处理（refundedAt → 不计利润与提成、不参与 KPI 计算），
      // 并把陪玩的名额还回去（跟「添加失败」的补偿一致 —— 名额被这张单占掉了，老板 2026-10-08）。
      await this.markRefund(req.orderId, undefined, req.reason || '陪玩申请退单', '退单').catch(() => null);
      if (!alreadyReturned) {
        await this.quota.credit(req.companionId, 1, QUOTA_REASON.SUPPLEMENT, {
          refId: req.orderId,
          note: '管理端同意退单，返还 1 个名额',
        });
      }
    }
    if (approve && !isRefund) {
      if (!alreadyReturned) {
        await this.quota.credit(req.companionId, 1, QUOTA_REASON.SUPPLEMENT, {
          refId: req.orderId,
          note: '管理端同意补单，返还 1 个名额',
        });
      }
      const order = await this.prisma.order.findUnique({
        where: { id: req.orderId },
        select: { customFields: true },
      });
      const cf = (order?.customFields as any) || {};
      await this.prisma.order
        .update({
          where: { id: req.orderId },
          data: {
            customFields: {
              ...cf,
              supplementApproved: true,
              supplementApprovedAt: new Date().toISOString(),
            },
          },
        })
        .catch(() => null);
    }
    // 审核结果陪玩本人也要实时知道（老板 2026-10-04 问「双方都有提示么」）。
    // 以前只有「同意」发了事件、而且陪玩端页面没监听；「驳回」连事件都没发 ——
    // 陪玩一直不知道自己被驳回了，只能对着失败状态干等。
    const companion = await this.prisma.companion
      .findUnique({ where: { id: req.companionId }, select: { userId: true } })
      .catch(() => null);
    if (companion?.userId) {
      this.wsGateway.notifyUser(companion.userId, 'order:supplement', {
        orderId: req.orderId,
        approved: approve,
        note: (note || '').trim() || null,
        message: isRefund
          ? approve
            ? `管理端已同意退单：这张单已退掉（不计利润与提成、不参与 KPI 计算）${alreadyReturned ? '' : '，你的抢单次数 +1'}`
            : '管理端驳回了退单申请，这张单照旧'
          : approve
            ? `管理端已同意补单${alreadyReturned ? '' : '，你的抢单次数 +1'}`
            : '管理端驳回了补单申请，这次不返还名额',
      });
    }
    return updated;
  }

  /**
   * 管理端补单（老板 2026-10-08）：订单管理里那颗「补单」按钮 ——
   * 点一下给这张单的陪玩名额 +1（写台账），并留一条 APPROVED 的补单记录，
   * 让管理端一眼看清今天到底给谁补过名额。
   *
   * 它同时是「陪玩申请补单」的**核对 + 同意**入口（老板 2026-10-08：「点了补单要跟其他功能联动起来」）：
   * 这张单上只要有待审的补单申请，点一下就顺手把它批掉（保留他写的原因 / 截图当作凭据），
   * 陪玩端会收到「你的补单申请已通过」的实时提示 —— 一个动作，名额 / 台账 / 记录 / 通知一起走完。
   *
   * 和陪玩自己申请补单走同一张表：同一张单只补一次（已经有 APPROVED 记录就直接拒）。
   * 权限给客服 / 店长 / 老板（老板 2026-10-08 把原先只给「客服 / 店长」的那个直接退款口子整条删掉、
   * 换成这个动作）；陪玩不能给自己补。
   */
  async supplementOrder(orderId: string, user: any, body: { reason?: string }) {
    if (!['OWNER', 'ADMIN', 'CS'].includes(user?.role ?? '')) {
      throw new ForbiddenException('只有客服 / 店长 / 老板能补单');
    }
    const reason = String(body?.reason || '').trim();
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderCode: true, companionId: true, studioId: true, customFields: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    const visibleIds = await this.supplementScopeIds(user);
    if (visibleIds && order.studioId && !visibleIds.includes(order.studioId)) {
      throw new ForbiddenException('无权操作其他工作室的订单');
    }
    if (!order.companionId) throw new BadRequestException('这张单还没有陪玩接单，无法补单');
    const existing = await this.prisma.supplementRequest.findFirst({
      where: { orderId, type: SUPPLEMENT_TYPE },
    });
    if (existing?.status === 'APPROVED') {
      throw new BadRequestException('这张单已经补过名额了');
    }
    // 同一张单只返还一次名额：先走过「退单同意」的，这里不能再补一个（老板 2026-10-08 全链路复查）。
    if (await this.hasReturnedQuota(orderId, '')) {
      throw new BadRequestException('这张单已经因为补单 / 退单返还过名额了，不能重复返还');
    }
    // 老板 2026-10-08：这张单上「陪玩已经申请了补单」时，这一下就是**核对 + 同意** ——
    // 原因用他写的那段（那就是凭据），管理端可以不写；不是接他的申请就必须写清楚。
    const approvingRequest = existing?.status === 'PENDING';
    if (!reason && !approvingRequest) throw new BadRequestException('补单必须写明原因');
    const now = new Date();
    const reviewDueAt = new Date(now.getTime() + SUPPLEMENT_REVIEW_HOURS * 3600 * 1000);
    const fields: any = approvingRequest
      ? {
          // 同意陪玩的补单申请：保留他写的原因 / 截图（客服、店长核对就是看这两样），
          // 只把「谁批的、什么时候批的、批的时候说了什么」补上。
          status: 'APPROVED',
          decidedByUserId: user?.id ?? null,
          decidedAt: now,
          decisionNote: reason || '核对无异议，同意补单',
          reviewDueAt,
          reviewStatus: 'PENDING',
          reviewedAt: null,
          reviewedByUserId: null,
        }
      : {
          companionId: order.companionId,
          studioId: order.studioId ?? null,
          reason: `${ADMIN_SUPPLEMENT_TAG}${reason}`,
          evidenceUrl: null,
          status: 'APPROVED',
          decidedByUserId: user?.id ?? null,
          decidedAt: now,
          decisionNote: reason,
          reviewDueAt,
          reviewStatus: 'PENDING',
          reviewedAt: null,
          reviewedByUserId: null,
        };
    const record = existing
      ? await this.prisma.supplementRequest.update({ where: { id: existing.id }, data: fields })
      : await this.prisma.supplementRequest.create({
          data: { orderId, type: SUPPLEMENT_TYPE, ...fields },
        });
    const roleLabel = user?.role === 'CS' ? '客服' : '店长 / 老板';
    await this.quota.credit(order.companionId, 1, QUOTA_REASON.SUPPLEMENT, {
      refId: order.id,
      note: approvingRequest
        ? `同意陪玩的补单申请（${roleLabel}核对）：${reason || '无异议'}`
        : `管理端直接补单（${roleLabel}）：${reason}`,
    });
    const cf = (order.customFields as any) || {};
    await this.prisma.order
      .update({
        where: { id: order.id },
        data: {
          customFields: {
            ...cf,
            supplementApproved: true,
            supplementApprovedAt: now.toISOString(),
            supplementByAdmin: true,
          },
        },
      })
      .catch(() => null);
    const companion = await this.prisma.companion
      .findUnique({ where: { id: order.companionId }, select: { userId: true } })
      .catch(() => null);
    if (companion?.userId) {
      this.wsGateway.notifyUser(companion.userId, 'order:supplement', {
        orderId: order.id,
        approved: true,
        note: reason || null,
        message: approvingRequest
          ? `你的补单申请已通过：订单 ${order.orderCode || order.id} 给你补了 1 个抢单名额`
          : `管理端给你补了 1 个抢单名额（订单 ${order.orderCode || order.id}）`,
      });
    }
    const st: any = await this.quota.status(order.companionId).catch(() => null);
    const balance = st?.balance ?? st?.remaining ?? null;
    return { ...record, balance, orderCode: order.orderCode, approvedRequest: approvingRequest };
  }

  /**
   * 陪玩点「退单」（老板 2026-10-08）。
   *
   * 场景（老板原话）：「最多的情况就是添加成功了，客户没转钱或者转钱了最后不打了」——
   * 也就是「客户同意了但是没打成」。陪玩点「退单」+ 写清原因 + 传截图 → 生成一条 REFUND 申请，
   * **跟「添加失败」走同一个审核入口**（「订单管理 → 🧾 补单审核 / 退单审核」）：
   * 客服先核对（无异议 → 转店长；有异议 → 直接驳回），店长 / 老板拍板。
   * 同意 = 这张单按退款处理（不计利润与提成、不参与 KPI 计算）+ 陪玩的抢单次数 +1。
   *
   * 为什么陪玩不能自己直接退：钱的事得有人核 —— 截图 + 原因摆在审核列表里，客服店长一眼能判断。
   */
  async requestRefund(orderId: string, user: any, body: { reason?: string; evidenceUrl?: string }) {
    if (user?.role !== 'COMPANION') throw new ForbiddenException('只有陪玩能发起退单');
    const reason = String(body?.reason || '').trim();
    if (!reason) throw new BadRequestException('退单要写清楚原因（为什么没打成）');
    const evidenceUrl = String(body?.evidenceUrl || '').trim() || null;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderCode: true, studioId: true, companionId: true, status: true, refundedAt: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (!user?.companionId || order.companionId !== user.companionId) {
      throw new ForbiddenException('只能给自己的订单发起退单');
    }
    if (order.refundedAt || order.status === 'CANCELLED') {
      throw new BadRequestException('这张单已经退过 / 已经取消了');
    }
    // 老板 2026-10-08：「打了就证明没问题 还退啥单。有问题的单都不会打，加吧」。
    // 「退单必须还没开打」以前**只在陪玩端按钮上拦**（`OrdersPage.canRequestRefund`），
    // 后端没卡 —— 拿到订单号直接调接口的，能把已经开打的单退掉。这里补上同一道锁：
    // 只要有过一段「已开始」的会话，就不给退（没打成请走「报结果」那套）。
    if (order.status === 'DONE') {
      throw new BadRequestException('这张单已经打完了，不能退单；没打成请走「报结果」');
    }
    const startedSegments = await this.prisma.orderSession.count({
      where: { parentOrderId: orderId, startedAt: { not: null } },
    });
    if (startedSegments > 0) {
      throw new BadRequestException('这张单已经开打了，不能退单；没打成请走「报结果」');
    }
    const existing = await this.prisma.supplementRequest.findFirst({
      where: { orderId, type: REFUND_TYPE },
    });
    if (existing?.status === 'PENDING') {
      throw new BadRequestException('退单申请已经提交过了，等客服 / 店长处理');
    }
    if (existing?.status === 'APPROVED') throw new BadRequestException('这张单已经同意退单了');
    const data = {
      orderId,
      type: REFUND_TYPE,
      companionId: user.companionId,
      studioId: order.studioId ?? null,
      reason,
      evidenceUrl,
      status: 'PENDING',
      csReviewedAt: null,
      csReviewedByUserId: null,
      csReviewNote: null,
      decidedByUserId: null,
      decidedAt: null,
      decisionNote: null,
    };
    const record = existing
      ? await this.prisma.supplementRequest.update({ where: { id: existing.id }, data })
      : await this.prisma.supplementRequest.create({ data });
    // 收件人的工作室 / 陪玩直接用本地这两个值，别指望创建返回值带全（DB 里带，但少一层依赖更稳）
    await this.notifyRefundReviewers(
      { orderId, studioId: order.studioId ?? null, companionId: user.companionId },
      ['CS', 'ADMIN', 'OWNER'],
      '提交了退单申请',
    ).catch(() => null);
    return record;
  }

  /**
   * 退单申请的实时提醒（跟「补单申请」同一个渠道，只是收件人不同）：
   *  - 刚提交 → 客服 / 店长 / 老板都收到，客服先去核对；
   *  - 客服点「无异议」转上去 → 只推店长 / 老板去拍板。
   */
  private async notifyRefundReviewers(
    req: { orderId: string; studioId: string | null; companionId: string },
    roles: string[],
    verb: string,
  ): Promise<void> {
    const studioId: string | null = req?.studioId ?? null;
    const where: any = { isAuthorized: true, role: { in: roles } };
    if (studioId) where.OR = [{ studioId }, { role: 'OWNER', studioId: null }];
    else where.role = 'OWNER';
    const found = await this.prisma.user.findMany({ where, select: { id: true } }).catch(() => []);
    const reviewers = Array.isArray(found) ? found : [];
    if (!reviewers.length) return;
    const order = await this.prisma.order
      .findUnique({ where: { id: req.orderId }, select: { orderCode: true } })
      .catch(() => null);
    const companion = await this.prisma.companion
      .findUnique({
        where: { id: req.companionId },
        select: { user: { select: { displayName: true, username: true } } },
      })
      .catch(() => null);
    const name =
      (companion as any)?.user?.displayName || (companion as any)?.user?.username || '有陪玩';
    const code = (order as any)?.orderCode || req.orderId;
    const payload = {
      orderId: req.orderId,
      orderCode: (order as any)?.orderCode ?? null,
      companionId: req.companionId,
      companionName: name,
      type: REFUND_TYPE,
      message: `${name} ${verb}（订单 ${code}），去「订单管理 → 🧾 补单审核」处理`,
    };
    for (const reviewer of reviewers) {
      this.wsGateway.notifyUser((reviewer as any).id, 'order:supplement_request', payload);
    }
  }

  /** 到期核查：客户后来其实通过了 → 系统把这张单改成「已添加」，别把客户浪费掉。 */
  async reviewSupplement(id: string, result: string, user: any) {
    if (!['OWNER', 'ADMIN', 'CS'].includes(user?.role ?? '')) {
      throw new ForbiddenException('只有客服 / 店长 / 老板能核查补单');
    }
    const req = await this.prisma.supplementRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('补单申请不存在');
    const visibleIds = await this.supplementScopeIds(user);
    if (visibleIds && req.studioId && !visibleIds.includes(req.studioId)) {
      throw new ForbiddenException('无权操作其他工作室的补单申请');
    }
    const accept = String(result || '').toUpperCase() === 'ACCEPTED';
    // 已经记过一次「仍未通过」→ 这次再点就是第二次，直接结案（最多提醒两次）。
    const alreadyStillNot = (req as any).reviewStatus === 'STILL_NOT';
    if (accept) {
      const order = await this.prisma.order.findUnique({
        where: { id: req.orderId },
        select: { id: true, customerId: true, companionId: true },
      });
      if (order) {
        await this.prisma.order.update({ where: { id: order.id }, data: { contactStatus: 'added' } });
        if (order.customerId) {
          const customer = await this.prisma.customer
            .findUnique({ where: { id: order.customerId }, select: { companionId: true } })
            .catch(() => null);
          await this.prisma.customer
            .update({
              where: { id: order.customerId },
              data: { companionId: customer?.companionId || order.companionId },
            })
            .catch(() => null);
        }
      }
    }
    return this.prisma.supplementRequest.update({
      where: { id },
      data: {
        // 老板 2026-10-04：「别搞这么复杂，先 24h 提醒一次，后期直接 7 天提醒一次」——
        // 第一次点「仍未通过」→ 7 天后再提醒一次；第二次再点「仍未通过」→ 结案（CLOSED），
        // 不再排提醒、也不再进「到期核查」的红点。谁点的、什么时候点的留在
        // reviewedAt / reviewedByUserId 里，翻历史查得到。客户哪天真通过了，
        // 陪玩 / 客服照旧能从「客户管理」把他捞回来，不影响。
        reviewStatus: accept ? 'ACCEPTED' : alreadyStillNot ? 'CLOSED' : 'STILL_NOT',
        reviewedAt: new Date(),
        reviewedByUserId: user?.id ?? null,
        reviewDueAt: accept
          ? null
          : alreadyStillNot
            ? null
            : new Date(Date.now() + SUPPLEMENT_REVIEW_AGAIN_HOURS * 3600 * 1000),
      },
    });
  }

  /**
   * 订单结果反馈 ——「这单到底成没成」（老板 2026-09-29 定、2026-10-06 加成交核对）。
   *
   * **谁报**：接单方自己报（抢到这张单的陪玩 / 他的搭档）；客服、店长、老板可以替他补录。
   * **报完怎么走**（老板 2026-10-06 原话：「接单方点成功那就推给发单者计入考核，
   * 失败的推给发单者 + 店长，店长最终拍板这个到底是谁的原因、谁的问题，谁的问题就去找谁，
   * 失败的还得粘贴上截图。成功的不用重点追查，重点追查失败的。」）：
   *  - 「成功」→ 直接推给发单者、计入客服考核，不用店长拍板；
   *  - 「不成功」→ **必须粘贴截图**（+ 原因 + 说明），同时推给发单者和店长，
   *    进「成交核对」清单等店长拍板定责。
   * 本店线下单点了「开始首单」就算成功、不用再报；抢了单一直没开始首单的，
   * 接单方可以报「不成功」（添加失败 / 暂时不打 / 对价格不满意 …），一样要带截图。
   */
  async recordOutcome(
    orderId: string,
    user: any,
    body: { outcome?: string; reason?: string; note?: string; evidence?: unknown },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        companion: {
          select: {
            id: true,
            studioId: true,
            studio: { select: { id: true, type: true, name: true } },
            user: { select: { id: true, username: true, displayName: true } },
          },
        },
        sessions: { select: { startedAt: true } },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    const role = user?.role ?? '';
    if (role === 'COMPANION') {
      // 只有这张单的接单方（主陪 / 搭档本人）能报结果，别人不能替他报。
      const mine =
        !!user?.companionId &&
        (order.companionId === user.companionId || order.coCompanionId === user.companionId);
      if (!mine) throw new ForbiddenException('只有这张单的接单方能报结果');
    } else {
      if (!['OWNER', 'ADMIN', 'CS'].includes(role)) {
        throw new ForbiddenException('只有接单方 / 客服 / 店长 / 老板能记结果反馈');
      }
      if (role !== 'OWNER' && user?.studioId) {
        const visibleIds = await this.bridgeService.getVisibleStudioIds(user.studioId);
        if (!visibleIds.includes(order.studioId)) throw new ForbiddenException('无权操作其他工作室的订单');
      }
    }
    if (!order.companionId) throw new ForbiddenException('这张单还没人接，先等陪玩抢单');
    const channel = orderChannelOf(order, order.studioId);
    const started = order.status === 'DONE' || (order.sessions || []).some((s: any) => !!s.startedAt);
    if (channel === 'offline' && started) {
      throw new BadRequestException('本店线下的单点了「开始首单」就算成功，不用再反馈');
    }
    const outcome =
      body.outcome === OrderOutcome.SUCCESS
        ? OrderOutcome.SUCCESS
        : body.outcome === OrderOutcome.FAILED
          ? OrderOutcome.FAILED
          : null;
    if (!outcome) throw new BadRequestException('结果只能是「成功」或「不成功」');
    // 老板 2026-10-06 起前端不再给固定原因选项，只留一个自由填写的「备注」（必填）：
    // 备注内容直接当原因存（两边都收，保证老客户端 / 老数据也认）。
    const reason = (body.reason || body.note || '').trim();
    const evidence = (Array.isArray(body.evidence) ? body.evidence : [])
      .map((u) => String(u ?? '').trim())
      .filter((u) => !!u)
      .slice(0, 12);
    if (outcome === OrderOutcome.FAILED) {
      if (!reason) throw new BadRequestException('报「不成功」要把原因写清楚（备注必填）');
      if (!evidence.length) {
        throw new BadRequestException('报「不成功」要粘贴截图 —— 店长得凭这个定责（谁的问题找谁）');
      }
    }
    const data: any = {
      outcome,
      outcomeReason: reason || null,
      outcomeNote: (body.note || '').trim() || null,
      outcomeByUserId: user?.id ?? null,
      outcomeAt: new Date(),
      outcomeEvidence: evidence.length ? evidence : null,
      // 成功单不用拍板；失败单**先进「等发单客服跟接单方核对」**（老板 2026-10-06：
      // 「他们不跟发单者掰扯明白，直接进店长，那不把店长累死」），核对完才轮到店长拍板。
      reviewStatus: outcome === OrderOutcome.FAILED ? 'CS_CONFIRMING' : null,
      reviewResponsibility: null,
      reviewNote: null,
      reviewByUserId: null,
      reviewAt: null,
      csConfirmedAt: null,
      csConfirmedByUserId: null,
      csConfirmNote: null,
    };
    // 被店长 / 老板打回过的（customFields.outcomeReject）：这次重报就把打回标记清掉，
    // 免得接单方下次打开弹窗又看到旧的驳回说明（老板 2026-10-06「乱写就驳回」）。
    const prevCf = (order.customFields as any) || null;
    if (prevCf && prevCf.outcomeReject) {
      data.customFields = { ...prevCf, outcomeReject: null };
    }
    const updated = await this.prisma.order.update({ where: { id: orderId }, data });
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    await this.notifyOutcomeReport(updated, {
      channel,
      companionName:
        (order.companion as any)?.user?.displayName ||
        (order.companion as any)?.user?.username ||
        '接单方',
    }).catch(() => null);
    return updated;
  }

  /**
   * 报完结果之后通知谁（老板 2026-10-06）：
   *  - 成功 → 只推给发单者（这单算进他的考核，他得知道）；
   *  - 不成功 → 推给发单者 **和店长 / 老板** —— 失败单才是要追的那一类。
   */
  private async notifyOutcomeReport(
    order: any,
    ctx: { channel: string; companionName: string },
  ): Promise<void> {
    const failed = order?.outcome === OrderOutcome.FAILED;
    const code = order?.orderCode || order?.id || '';
    const payload = {
      orderId: order?.id ?? null,
      orderCode: order?.orderCode ?? null,
      gameName: order?.gameName ?? null,
      outcome: order?.outcome ?? null,
      reason: order?.outcomeReason ?? null,
      note: order?.outcomeNote ?? null,
      evidence: Array.isArray(order?.outcomeEvidence) ? order.outcomeEvidence : [],
      companionName: ctx.companionName,
      channel: ctx.channel,
      message: failed
        ? `${ctx.companionName} 报了「不成功」（订单 ${code}${order?.outcomeReason ? '：' + order.outcomeReason : ''}）—— 已附截图，请先跟接单方核对（双方都没异议了再推店长拍板）`
        : `${ctx.companionName} 报了「成功」（订单 ${code}）—— 计入发单客服考核`,
    };
    const event = failed ? 'order:outcome_failed' : 'order:outcome_success';
    // 只通知**发单本人**：失败单先跟他把事掰扯明白，别直接堆给店长（老板 2026-10-06）；
    // 成功单也只告诉他，计入考核。`Order.csUserId` 是 NOT NULL（建单人），每张单一定有发单人。
    this.wsGateway.notifyUser(order.csUserId, event, payload);
  }

  /**
   * 发单客服确认「已跟接单方核对、双方无异议」（老板 2026-10-06）：
   * 失败单必须先过这一步，才轮到店长拍板 —— 免得两边还没掰扯明白就直接堆到店长那儿。
   */
  async confirmOutcomeWithCs(orderId: string, user: any, body: { note?: string }) {
    const role = user?.role ?? '';
    if (!['OWNER', 'ADMIN', 'CS', 'COMPANION'].includes(role)) {
      throw new ForbiddenException('只有发单本人 / 店长 / 老板能确认这一步');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        companion: { select: { user: { select: { id: true, username: true, displayName: true } } } },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.outcome !== OrderOutcome.FAILED) {
      throw new BadRequestException('只有报「不成功」的单才要客服先核对');
    }
    if (order.reviewStatus === 'DECIDED') {
      throw new BadRequestException('这张单店长已经拍过板了');
    }
    // **谁发的单谁确认**：订单上的 `csUserId` 就是建单人（客服 / 店长 / 陪玩自己建的都算，
    // 这一列是 NOT NULL，不存在「查不到发单人」的情况）。
    if (order.csUserId !== user?.id) {
      // 不是发单本人 → 只有店长 / 老板能「代确认」兜底（发单人休假 / 离职时别把单卡死）。
      if (role !== 'OWNER' && role !== 'ADMIN') {
        throw new ForbiddenException('这张单不是你发的，等发单的人自己跟接单方核对');
      }
      if (user?.studioId && order.studioId !== user.studioId) {
        throw new ForbiddenException('无权确认其他工作室的订单');
      }
    }
    const note = (body?.note || '').trim();
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        reviewStatus: 'CS_CONFIRMED',
        csConfirmedAt: new Date(),
        csConfirmedByUserId: user?.id ?? null,
        csConfirmNote: note || null,
      },
    });
    const code = updated.orderCode || updated.id;
    const payload = {
      orderId: updated.id,
      orderCode: updated.orderCode ?? null,
      gameName: (updated as any).gameName ?? null,
      outcome: updated.outcome ?? null,
      reason: updated.outcomeReason ?? null,
      evidence: Array.isArray(updated.outcomeEvidence) ? updated.outcomeEvidence : [],
      message: `订单 ${code}：发单客服已跟接单方核对完（双方无异议），等店长拍板到底是谁的问题`,
    };
    // 接单方也知会一声：这事定了，等店长定责。
    const companionUserId = (order.companion as any)?.user?.id ?? null;
    if (companionUserId) {
      this.wsGateway.notifyUser(companionUserId, 'order:outcome_cs_confirmed', {
        ...payload,
        message: `订单 ${code}：发单客服已跟你核对完（双方无异议），等店长拍板`,
      });
    }
    // 轮到店长 / 老板了（这才是他们该被叫的时候）。
    await this.notifyOrderReviewers(order.studioId ?? null, 'order:outcome_cs_confirmed', payload);
    return updated;
  }

  /**
   * 店长 / 老板「打回重写」（老板 2026-10-06）。
   *
   * 老板原话：「那些不成功的原因全部删除吧，只留备注必填，让他们自己填，因为很多奇奇怪怪的原因，
   * 如果乱写管理端给驳回就行了」——「驳回」就落在这里：接单方报的说明糊弄、截图不对、或者根本没写清楚，
   * 店长一点就把这张单**退回去让他重填**，不占店长的待拍板清单（`reviewStatus=REJECTED`）。
   * 陪玩重新在「报结果」里填 + 重贴截图再报一次，流程从头走（recordOutcome 会把状态置回 CS_CONFIRMING）。
   */
  async rejectOrderOutcome(orderId: string, user: any, body: { note?: string }) {
    if (!['OWNER', 'ADMIN'].includes(user?.role ?? '')) {
      throw new ForbiddenException('只有店长 / 老板能打回重写');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        companion: {
          select: {
            id: true,
            user: { select: { id: true, username: true, displayName: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (user?.role !== 'OWNER' && user?.studioId && order.studioId !== user.studioId) {
      throw new ForbiddenException('无权操作其他工作室的订单');
    }
    if (order.outcome !== OrderOutcome.FAILED) {
      throw new BadRequestException('只有报「不成功」的单才能打回重写');
    }
    if (order.reviewStatus === 'DECIDED') {
      throw new BadRequestException('这张单已经拍过板了，不能打回');
    }
    const note = (body?.note || '').trim();
    if (!note) throw new BadRequestException('写一句为什么打回（接单方要照着改）');
    const cf = (order.customFields as any) || {};
    const byName = user?.displayName || user?.username || '店长';
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        // REJECTED = 退给接单方重填，不在「待拍板」清单里（listOrderReviews 已把它排除）
        reviewStatus: 'REJECTED',
        csConfirmedAt: null,
        csConfirmedByUserId: null,
        csConfirmNote: null,
        customFields: {
          ...cf,
          outcomeReject: {
            at: new Date().toISOString(),
            byUserId: user?.id ?? null,
            byName,
            note,
          },
        },
      },
    });
    const code = updated.orderCode || updated.id;
    const payload = {
      orderId: updated.id,
      orderCode: updated.orderCode ?? null,
      note,
      byName,
      message: `订单 ${code}：店长把你的「不成功」说明打回了 —— ${note}。请重新填清楚原因、重新贴截图再报一次`,
    };
    const companionUserId = (order.companion as any)?.user?.id ?? null;
    if (companionUserId) {
      this.wsGateway.notifyUser(companionUserId, 'order:outcome_rejected', payload);
    }
    // 发单客服也知会一声：这张单退回去重填了，不在他那儿挂着等核对。
    if (updated.csUserId) {
      this.wsGateway.notifyUser(updated.csUserId, 'order:outcome_rejected', {
        ...payload,
        message: `订单 ${code}：店长把接单方的「不成功」说明打回了，让他重填（你先不用核对这张）`,
      });
    }
    return updated;
  }

  /** 店长 / 老板（含全站老板）：拍板这类事只找他们。 */
  private async notifyOrderReviewers(
    studioId: string | null,
    event: string,
    payload: any,
    excludeUserId?: string | null,
  ): Promise<void> {
    const where: any = { isAuthorized: true, role: { in: ['OWNER', 'ADMIN'] } };
    if (studioId) where.OR = [{ studioId }, { role: 'OWNER', studioId: null }];
    else where.role = 'OWNER';
    const found = await this.prisma.user.findMany({ where, select: { id: true } }).catch(() => []);
    for (const reviewer of (Array.isArray(found) ? found : []) as any[]) {
      if (excludeUserId && reviewer.id === excludeUserId) continue;
      this.wsGateway.notifyUser(reviewer.id, event, payload);
    }
  }

  /** 店长拍板能选的责任方：接单方 / 发单客服 / 客户 / 无人担责。 */
  static readonly REVIEW_RESPONSIBILITIES = ['COMPANION', 'CS', 'CUSTOMER', 'NONE'] as const;

  /**
   * 店长 / 老板拍板（老板 2026-10-06）：「店长最终拍板这个到底是谁的原因，到底谁的问题，
   * 谁的问题就去找谁。」拍完给接单方 + 发单者各推一条，两边都知道这事定了、找谁。
   */
  async reviewOrderOutcome(orderId: string, user: any, body: { responsibility?: string; note?: string }) {
    if (!['OWNER', 'ADMIN'].includes(user?.role ?? '')) {
      throw new ForbiddenException('只有店长 / 老板能拍板');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        companion: {
          select: {
            id: true,
            user: { select: { id: true, username: true, displayName: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (user?.role !== 'OWNER' && user?.studioId && order.studioId !== user.studioId) {
      throw new ForbiddenException('无权拍板其他工作室的订单');
    }
    if (order.outcome !== OrderOutcome.FAILED) {
      throw new BadRequestException('只有报「不成功」的单才需要拍板');
    }
    // 老板 2026-10-06：失败单必须先由发单客服跟接单方核对完（双方无异议），才轮到店长拍板。
    if (order.reviewStatus !== 'CS_CONFIRMED') {
      throw new BadRequestException(
        '这张单还没经过发单客服核对 —— 先让发单客服在「成交核对 → 待拍板」点「已跟接单方确认、双方无异议」',
      );
    }
    const responsibility = String(body.responsibility || '').trim().toUpperCase();
    if (!(OrderExceptionService.REVIEW_RESPONSIBILITIES as readonly string[]).includes(responsibility)) {
      throw new BadRequestException('请选一个责任方：接单方 / 发单客服 / 客户 / 无人担责');
    }
    const note = (body.note || '').trim();
    if (!note) throw new BadRequestException('要写清楚结论：到底谁的问题、后面怎么处理');
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        reviewStatus: 'DECIDED',
        reviewResponsibility: responsibility,
        reviewNote: note,
        reviewByUserId: user?.id ?? null,
        reviewAt: new Date(),
      },
    });
    const label =
      responsibility === 'COMPANION'
        ? '接单方的问题'
        : responsibility === 'CS'
          ? '发单客服的问题'
          : responsibility === 'CUSTOMER'
            ? '客户的问题'
            : '谁都没问题（不可抗力）';
    const payload = {
      orderId: updated.id,
      orderCode: updated.orderCode ?? null,
      responsibility,
      note,
      decidedBy: user?.displayName || user?.username || '店长',
      message: `订单 ${updated.orderCode || updated.id} 的「不成功」已拍板：${label}｜结论：${note}`,
    };
    if (updated.csUserId) this.wsGateway.notifyUser(updated.csUserId, 'order:outcome_decided', payload);
    const companionUserId = (order.companion as any)?.user?.id ?? null;
    if (companionUserId) this.wsGateway.notifyUser(companionUserId, 'order:outcome_decided', payload);
    return updated;
  }

  /** 核对范围：老板看全部，其他人看本店 + 桥接工作室（和补单申请同一套口径）。 */
  private async reviewScopeIds(user: any): Promise<string[] | null> {
    if (user?.role === 'OWNER' || !user?.studioId) return null;
    return this.bridgeService.getVisibleStudioIds(user.studioId);
  }

  /** 抢走多久还没结果，就该进「待核对」清单（30 分钟：够打一局，又不至于全堆在清单里）。 */
  private static readonly RECHECK_AFTER_MINUTES = 30;

  /**
   * 「抢了没结果」在要在清单里挂多久（天）。老板 2026-10-06：接单方那边**次日提醒一次、第 7 天提醒一次**，
   * 满 7 天还是没结果的就挪去「历史记录」—— 不再占着要在清单，但记录留着随时能翻。
   */
  private static readonly ARCHIVE_AFTER_DAYS = 7;

  /**
   * 「成交核对」清单（老板 2026-10-06）。管理端每天要核的就这四类：
   *  - waiting：接单方报了「不成功」、还没拍板的（**重点追这类**，带截图，店长来定责）；
   *  - recheck：抢走了却一直没结果、**还在 7 天以内**的（本店线下没点「开始首单」、桥接 / 线上没反馈）；
   *  - archived：上面那批**满了 7 天**的（陪玩那边两次提醒走完就进这儿，不再占着要在清单，随时可翻）；
   *  - decided：最近拍过板的（留痕，可回看）。
   */
  async listOrderReviews(
    user: any,
    scope: 'waiting' | 'recheck' | 'archived' | 'decided' = 'waiting',
  ) {
    if (!['OWNER', 'ADMIN', 'CS'].includes(user?.role ?? '')) {
      throw new ForbiddenException('只有客服 / 店长 / 老板能看成交核对');
    }
    const scopeIds = await this.reviewScopeIds(user);
    const where: any = { companionId: { not: null }, refundedAt: null, status: { not: 'CANCELLED' } };
    if (scopeIds) where.studioId = { in: scopeIds };
    if (scope === 'waiting') {
      where.outcome = OrderOutcome.FAILED;
      // 注意：`not` 在 SQL 里会把 NULL 一起排掉，而这批字段是新加的 ——
      // 之前报过「不成功」的老单 reviewStatus 是 NULL，也必须留在清单里等拍板。
      // 被打回重写的（REJECTED）已经退给接单方了，不该继续占着店长的清单。
      where.OR = [{ reviewStatus: null }, { reviewStatus: { notIn: ['DECIDED', 'REJECTED'] } }];
    } else if (scope === 'decided') {
      where.reviewStatus = 'DECIDED';
    } else {
      where.outcome = null;
      where.status = { not: 'DONE' };
      // 「抢了没结果」按 7 天一分为二：7 天以内算要在清单（recheck），满了 7 天的挪去
      // 「历史记录」（archived）—— 不再占着要在清单，但记录留着随时能翻。
      const since = new Date(Date.now() - OrderExceptionService.ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);
      const range = scope === 'archived' ? { lt: since } : { gte: since };
      where.OR = [{ grabbedAt: range }, { grabbedAt: null, createdAt: range }];
    }
    const rows = await this.prisma.order.findMany({
      where,
      include: {
        companion: {
          select: {
            id: true,
            studioId: true,
            studio: { select: { id: true, name: true, type: true } },
            user: { select: { username: true, displayName: true } },
          },
        },
        coCompanion: { select: { user: { select: { username: true, displayName: true } } } },
        csUser: { select: { username: true, displayName: true } },
        customer: { select: { id: true, wechatId: true, customerCode: true, platform: true } },
        sessions: { select: { startedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const cutoff = Date.now() - OrderExceptionService.RECHECK_AFTER_MINUTES * 60_000;
    const list = rows
      .map((o) => {
        const channel = orderChannelOf(o as any, o.studioId);
        const started =
          o.status === 'DONE' || (o.sessions || []).some((s: any) => !!s.startedAt);
        const grabbedAt = (o.grabbedAt || o.createdAt) as any;
        return {
          id: o.id,
          orderCode: o.orderCode,
          type: o.type,
          gameName: o.gameName,
          status: o.status,
          amount: o.amount,
          coAmount: o.coAmount,
          duration: o.duration,
          customFields: o.customFields,
          channel,
          started,
          outcome: o.outcome,
          outcomeReason: o.outcomeReason,
          outcomeNote: o.outcomeNote,
          outcomeAt: o.outcomeAt,
          evidence: Array.isArray(o.outcomeEvidence) ? o.outcomeEvidence : [],
          reviewStatus: o.reviewStatus,
          reviewResponsibility: o.reviewResponsibility,
          reviewNote: o.reviewNote,
          reviewAt: o.reviewAt,
          csConfirmedAt: o.csConfirmedAt,
          csConfirmedByUserId: o.csConfirmedByUserId,
          csConfirmNote: o.csConfirmNote,
          csUserId: o.csUserId,
          csUserName: (o.csUser as any)?.displayName || (o.csUser as any)?.username || null,
          companionId: o.companionId,
          companionName:
            (o.companion as any)?.user?.displayName || (o.companion as any)?.user?.username || null,
          companionStudioName: (o.companion as any)?.studio?.name ?? null,
          coCompanionName:
            (o.coCompanion as any)?.user?.displayName || (o.coCompanion as any)?.user?.username || null,
          customerId: o.customerId,
          customerWechat: (o.customer as any)?.wechatId ?? null,
          customerCode: (o.customer as any)?.customerCode ?? null,
          grabbedAt,
          createdAt: o.createdAt,
        };
      })
      // 「待核对」只留抢走 30 分钟以上、还一直没结果的 —— 刚抢走的不算问题单；
      // 「历史记录」只做「没点开始首单」这一条（7 天窗口已经在查询里切好）。
      .filter((o) => {
        if (scope === 'recheck') {
          return !o.started && new Date(o.grabbedAt as any).getTime() <= cutoff;
        }
        if (scope === 'archived') return !o.started;
        return true;
      });
    return list;
  }

  /** 管理端菜单 / 首页红点要的条数（老板 2026-10-06：每天点名管理端去核对）。 */
  async orderReviewSummary(user: any) {
    if (!['OWNER', 'ADMIN', 'CS'].includes(user?.role ?? '')) {
      return { waiting: 0, waitingCs: 0, waitingDecide: 0, recheck: 0, decided: 0 };
    }
    const [waiting, recheck] = await Promise.all([
      this.listOrderReviews(user, 'waiting').catch(() => []),
      this.listOrderReviews(user, 'recheck').catch(() => []),
    ]);
    // waiting 里再分两段：还没过发单客服核对的（等客服）/ 核对完等店长拍板的（等店长）。
    const waitingDecide = waiting.filter((o: any) => o.reviewStatus === 'CS_CONFIRMED').length;
    const rejected = await this.prisma.order
      .count({
        where: {
          ...(user?.role === 'OWNER' || !user?.studioId
            ? {}
            : { studioId: { in: (await this.reviewScopeIds(user)) || [user.studioId] } }),
          outcome: OrderOutcome.FAILED,
          reviewStatus: 'REJECTED',
        },
      })
      .catch(() => 0);
    return {
      waiting: waiting.length,
      waitingCs: waiting.length - waitingDecide,
      waitingDecide,
      recheck: recheck.length,
      rejected,
    };
  }

  /**
   * 「催一下」（老板 2026-09-30）：线上 / 桥接单还挂着「待反馈」时，发单的客服按一下，
   * 把话说到接单那边去 —— 「没反馈的算待反馈，不算成功也不算失败，看得见、催得动」。
   *
   * 做三件事：
   *  1. 单上记一笔（催了几次、最后一次什么时候）：接单方的看板上显示「对方催过 N 次」，
   *     发单的客服自己也知道催过几回，不用在微信里翻聊天记录；
   *  2. 给接单工作室（桥接店 / 线上俱乐部）的客服 / 店长推一条实时提醒；
   *  3. 返回更新后的单，界面立刻刷新。
   *
   * 已经反馈过结果、还没人接、本店线下单，都不给催。
   */
  async chaseFeedback(orderId: string, user: any) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        companion: { select: { studioId: true, studio: { select: { id: true, type: true, name: true } } } },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (!['OWNER', 'ADMIN', 'CS'].includes(user?.role ?? '')) {
      throw new ForbiddenException('只有客服 / 店长 / 老板能催结果');
    }
    if (user?.role !== 'OWNER' && user?.studioId) {
      const visibleIds = await this.bridgeService.getVisibleStudioIds(user.studioId);
      if (!visibleIds.includes(order.studioId)) throw new ForbiddenException('无权操作其他工作室的订单');
    }
    if (!order.companionId) throw new ForbiddenException('这张单还没人接，先等陪玩抢单');
    if (orderChannelOf(order, order.studioId) === 'offline') {
      throw new ForbiddenException('本店线下的单不用反馈：陪玩点了「开始首单」就算成功');
    }
    if (order.outcome === OrderOutcome.SUCCESS || order.outcome === OrderOutcome.FAILED) {
      throw new ForbiddenException('这张单已经反馈过结果了，不用再催');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { feedbackChasedAt: new Date(), feedbackChaseCount: { increment: 1 } },
    });
    const targetStudioId = order.companion?.studioId ?? null;
    if (targetStudioId) {
      this.wsGateway.broadcastToStudio(targetStudioId, 'order:feedback_chase', {
        orderId: updated.id,
        orderCode: updated.orderCode,
        gameName: updated.gameName,
        chaseCount: updated.feedbackChaseCount,
        fromName: user?.displayName || user?.username || '对方客服',
        fromStudioId: order.studioId,
        chasedAt: updated.feedbackChasedAt,
        _notify: true,
      });
    }
    return updated;
  }

  async markRefund(orderId: string, companionId?: string, reason?: string, label = '退款') {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new ForbiddenException('订单不存在');
    if (companionId && order.companionId !== companionId) throw new ForbiddenException('只能操作自己的订单');

    // 已完成过的订单在退款时回冲累计业绩与客户总消费，避免财务虚高
    if (order.status === 'DONE') {
      await this.reverseOrderRevenue(order);
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        refundedAt: new Date(),
        refundReason: reason || null,
        notes: order.notes
          ? `${order.notes}\n[${label}] ${reason || ''}`
          : `[${label}] ${reason || ''}`,
      },
    });
    if (order.companionId) {
      await this.prisma.companion
        .update({ where: { id: order.companionId }, data: { status: 'AVAILABLE' } })
        .catch(() => {});
      await this.wsGateway.refreshCompanionBlacklist(order.companionId).catch(() => {});
    }
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', updated);
    return updated;
  }

  /** 回冲一笔已完成订单已累计的业绩与总消费 */
  private async reverseOrderRevenue(order: any) {
    const splits: Array<{ companionId: string; amount: number }> =
      (order.customFields as any)?.splits || [];
    const splitTotal = splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

    try {
      if (order.companionId) {
        await this.prisma.companion.update({
          where: { id: order.companionId },
          data: { monthlyRevenue: { decrement: Math.max(0, order.amount - splitTotal) } },
        });
      }
      for (const split of splits) {
        if (!split.companionId) continue;
        await this.prisma.companion
          .update({
            where: { id: split.companionId },
            data: { monthlyRevenue: { decrement: Math.max(0, Number(split.amount) || 0) } },
          })
          .catch(() => {});
      }
      if (order.customerId) {
        await this.prisma.customer.update({
          where: { id: order.customerId },
          data: { totalSpent: { decrement: Math.max(0, order.amount) } },
        });
      }
    } catch (err) {
      console.error('reverseOrderRevenue failed', { error: (err as Error).message, orderId: order.id });
    }
  }
}
