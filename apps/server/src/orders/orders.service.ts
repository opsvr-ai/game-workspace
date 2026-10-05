// craftsman-ignore: TS001,TS003
import { Injectable, NotFoundException, ForbiddenException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { OrderWorkflowService } from './order-workflow.service';
import { OrderDispatchService } from './order-dispatch.service';
import { CompanionQuotaService, QUOTA_REASON } from './companion-quota.service';
import { ExcellenceService } from '../companions/excellence.service';
import { logger } from '../common/logger';
import { maskCustomerWechat, maskPartnerContactView, stripPoolCustomerContact } from '../common/order-privacy';
import { releaseCompanionIfIdle } from '../common/companion-presence';
import { computeEntertainmentFee, loadEntertainmentRule } from '../common/entertainment-fee';
import { currentBusinessDayRange, settlementMonthRange } from '../common/business-day';
import { resolveConfigsRaw } from '../common/studio-config';
import { DIRECT_ALERT_SECONDS } from './direct-assignment-reminder.service';
import { isBelowPriceFloor, isRenewalSegment, partnerUnitPriceYuan, priceStatsFloor, resolvePriceMode } from '../common/price-rules';
import { PoolScope, OrderOutcome } from '@chunlv/shared';
import {
  normalizePoolScope,
  visibleToOwnOffline,
  orderChannelOf,
  orderUnits,
  outcomeOf,
  outsideViewerVisible,
} from '../common/order-outcome';

// 搭档邀请有效期（老板 2026-10-03）：60 秒太短 —— 陪玩在游戏里 / 在微信上，
// 看到横幅再切回来经常就过了，邀请一超时就等于这单没有搭档，被邀请方也拿不到记录。
// 放到 3 分钟；而且超时只撤掉「待搭档」，不再把整段会话/订单作废（见 schedulePartnerInviteExpiry）。
const PARTNER_INVITE_TTL_SEC = 180;

/**
 * 转让申请多久没人理就作废（老板 2026-10-03：「需要被转让方同意才能过来」）。
 * 30 分钟：够对方打完一局看到弹窗，又不至于让一张单一直挂着一个没人认的申请。
 */
const TRANSFER_REQUEST_TTL_SEC = 30 * 60;

/** 「桥接工作室等待」默认值（秒）：库里没配置时用它。 */
const DEFAULT_BRIDGE_DELAY_SECONDS = 30;

/** 同意补单后，隔多久提醒管理端去核查「这个客户后来到底通过了没有」（小时）。 */
const SUPPLEMENT_REVIEW_HOURS = 24;
/** 第一次「仍未通过」之后，再过 7 天提醒管理端核查一次（第二次点仍未通过就结案）。 */
const SUPPLEMENT_REVIEW_AGAIN_HOURS = 7 * 24;

@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
    private bridgeService: BridgeService,
    private readonly workflowService: OrderWorkflowService,
    private readonly dispatchService: OrderDispatchService,
    private readonly excellence: ExcellenceService,
    private readonly quota: CompanionQuotaService,
  ) {}

  onModuleInit(): void {
    // 服务重启后，setTimeout 会丢失；这里定时兜底清理过期未接受的搭档邀请，
    // 避免客户管理里一直显示“等待搭档接受/取消邀请”。
    setInterval(() => {
      void this.cleanupExpiredPartnerInvites();
      // 同一根因：转让申请是「发起方落库 + 等对方同意」，服务重启也会丢通知，
      // 挂久了界面上就一直有个没人认的申请，一起清。
      void this.cleanupExpiredTransferRequests();
    }, 30 * 1000);
  }

  /** 超时没人处理的转让申请置为 EXPIRED，并通知双方（老板 2026-10-03）。 */
  private async cleanupExpiredTransferRequests(): Promise<void> {
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

  private async cleanupExpiredPartnerInvites(): Promise<void> {
    const cutoff = new Date(Date.now() - PARTNER_INVITE_TTL_SEC * 1000);
    const sessions = await this.prisma.orderSession.findMany({
      where: { status: 'ACTIVE', startedAt: null, createdAt: { lt: cutoff } },
      select: {
        id: true,
        companionId: true,
        parentOrderId: true,
        parentOrder: { select: { studioId: true, dispatchType: true, status: true } },
      },
    });
    for (const s of sessions) {
      await this.prisma.orderSession.update({
        where: { id: s.id },
        data: { status: 'DONE', endedAt: new Date() },
      }).catch(() => {});
      await this.prisma.order.updateMany({
        where: {
          id: s.parentOrderId,
          status: 'CONFIRMED',
          dispatchType: 'DIRECT',
          sessions: { none: { status: 'ACTIVE' } },
        },
        data: { status: 'DONE' },
      }).catch(() => {});
      const studioId = s.parentOrder?.studioId || '';
      if (studioId) {
        this.wsGateway.broadcastToStudio(studioId, 'order:dual_invite_expired', {
          sessionId: s.id,
          orderId: s.parentOrderId,
        });
        this.wsGateway.broadcastToStudio(studioId, 'order:pool_updated', { id: s.id, expired: true });
      }
      if (s.companionId) {
        this.wsGateway.pushToCompanion(s.companionId, 'order:partner_timeout', {
          sessionId: s.id,
          orderId: s.parentOrderId,
        });
      }
    }
  }

  private async nextGlobalCode(): Promise<string> {
    const cfg = await this.prisma.systemConfig.upsert({
      where: { key: 'counter.global_code' },
      create: { key: 'counter.global_code', value: '0' },
      update: {},
    });
    const current = parseInt(cfg.value as string, 10) || 0;
    const next = current + 1;
    await this.prisma.systemConfig.update({
      where: { key: 'counter.global_code' },
      data: { value: String(next) },
    });
    return String(next);
  }

  async create(dto: {
    type: string;
    studioId?: string;
    csUserId: string;
    customerId?: string;
    customerWechat?: string;
    customerRoomCode?: string;
    dispatchType: string;
    amount: number;
    gameName: string;
    duration?: number;
    customFields?: any;
    companionId?: string;
    /** 陪玩自己录入客户、直接开单时是否用客户存单抵扣（落到自动建的会话上，双陪也走这条） */
    useDeposit?: boolean;
  }) {
    // Resolve studioId: from dto or from CS user's studio
    let studioId = dto.studioId;
    if (!studioId) {
      const csUser = await this.prisma.user.findUnique({ where: { id: dto.csUserId } });
      studioId = csUser?.studioId ?? undefined;
    }
    if (!studioId) throw new NotFoundException('无法确定订单所属工作室');

    // COMPANION can only create orders for themselves (not for other companions)
    const creator = await this.prisma.user.findUnique({ where: { id: dto.csUserId }, select: { role: true } });
    if (creator?.role === 'COMPANION' && dto.dispatchType === 'DIRECT' && dto.companionId) {
      const companion = await this.prisma.companion.findUnique({
        where: { userId: dto.csUserId },
        select: { id: true, studioId: true },
      });
      if (!companion) {
        throw new ForbiddenException('陪玩信息不存在');
      }
      if (dto.companionId !== companion.id) {
        const target = await this.prisma.companion.findUnique({
          where: { id: dto.companionId },
          select: { studioId: true },
        }).catch(() => null);
        if (!target || target.studioId !== companion.studioId) {
          throw new ForbiddenException('陪玩只能给自己或同工作室的陪玩创建直接派单');
        }
      }
    }

    // Resolve customerId: create a placeholder if not provided
    let customerId = dto.customerId;
    if (!customerId && studioId) {
      const customerCode = await this.nextGlobalCode();
      const placeholder = await this.prisma.customer.create({
        data: {
          studioId,
          wechatId: dto.customerWechat || '',
          customerCode,
        },
      });
      customerId = placeholder.id;
    }

    // 「老客单」兜底校验（老板 2026-10-04）：「怎么防止陪玩随便去客户管理找一个客户就点复购了？」
    // 以及「客户管理里有客户 A、客户 B，陪玩去客户 B 的位置点续单 / 复购，你怎么挡住？」
    // 续单率 / 复购率是评分项，不能自己造。**只卡陪玩自己发起的老客单**（客服 / 店长 / 老板代发不动，
    // 免得老客户前一单还没 DONE 就把客服的正常续单 / 复购发单给拦了）。
    // 关键：一律**以服务端查出来的关系为准**，不信前端传的客户归属——把 customerId 换成别人的客户也过不了：
    //   ① 客户必须是真实客户，且属于本单工作室（跨店客户直接拒）；
    //   ② 客户**在自己名下**（自己录入 / 打过的）→ 放行（老板 2026-10-04：自己录入的老客可直接续单 / 复购 / 存单）；
    //   ③ 不是自己名下的客户 → 必须**真成交过**（有 DONE 单）且本人**服务过**（主陪或副陪的 DONE 单）。
    if ((dto.type === 'REPURCHASE' || dto.type === 'RENEW') && customerId && creator?.role === 'COMPANION') {
      const me = await this.prisma.companion
        .findUnique({ where: { userId: dto.csUserId }, select: { id: true } })
        .catch(() => null);
      if (!me) throw new ForbiddenException('陪玩信息不存在');

      const customer = await this.prisma.customer
        .findUnique({ where: { id: customerId }, select: { companionId: true, studioId: true } })
        .catch(() => null);
      if (!customer) throw new ForbiddenException('客户不存在，不能发续单 / 复购');
      if (customer.studioId && customer.studioId !== studioId) {
        throw new ForbiddenException('这个客户不属于本工作室，不能发续单 / 复购');
      }

      // 老板 2026-10-04：陪玩自己录入的客户，新客老客他自己清楚 ——
      // 「有的就是老客户……他自己录入的，开始首单 / 续单 / 复购 / 存单都要有」。
      // 所以**自己名下的客户直接放行**（允许没有 DONE 单就点续单 / 复购 / 存单，比如还有没打完的存单）；
      // 只有**不在自己名下**的客户才要求「真成交过 + 本人服务过」——
      // 「陪玩去客户 B 的位置点续单 / 复购」这条路照样堵着。
      const isMine = !!customer.companionId && customer.companionId === me.id;
      if (!isMine) {
        const doneCount = await this.prisma.order.count({
          where: { customerId, status: 'DONE' },
        });
        if (doneCount === 0) {
          throw new ForbiddenException('这个客户还没有成交记录，不能算续单 / 复购；新客户请走抢单 / 首单');
        }

        const served = await this.prisma.order.count({
          where: {
            customerId,
            status: 'DONE',
            OR: [{ companionId: me.id }, { coCompanionId: me.id }],
          },
        });
        if (served === 0) {
          throw new ForbiddenException('只能续单 / 复购你自己服务过的客户；这个客户不是你打的，请让客服 / 店长处理');
        }
      }
    }

    const orderCode = await this.nextGlobalCode();
    const newOrder = await this.prisma.order.create({
      data: {
        orderCode,
        type: dto.type,
        studioId: studioId!,
        csUserId: dto.csUserId,
        customerId: customerId!,
        dispatchType: dto.dispatchType === 'BROADCAST' ? 'POOL' : dto.dispatchType,
        source: (dto as any).source ?? 'OFFLINE',
        attributedCsUserId: (dto as any).attributedCsUserId ?? dto.csUserId,
        companionId: dto.dispatchType === 'DIRECT' ? dto.companionId : null,
        coCompanionId: dto.dispatchType === 'DIRECT' ? ((dto as any).coCompanionId ?? null) : null,
        coAmount: (dto as any).coAmount ?? null,
        status: dto.dispatchType === 'DIRECT' && dto.companionId ? 'GRABBED' : 'PENDING',
        contactStatus: (dto as any).directAdd === true ? 'pending' : undefined,
        // 先给谁抢（老板 2026-10-01）：空 = 线下→线上流转（本店线下先抢）；
        // ONLINE_FIRST = 线上→线下流转（桥接 + 线上秒看到，没人接再放给本店线下）
        poolScope: normalizePoolScope((dto as any).poolScope) === PoolScope.ONLINE_FIRST ? PoolScope.ONLINE_FIRST : null,
        amount: dto.amount,
        gameName: dto.gameName,
        serviceType: (dto as any).serviceType ?? 'PLAY_WITH',
        duration: dto.duration,
        customFields: {
          customerSource: (dto as any).customerSource,
          customerSourceAccount: (dto as any).customerSourceAccount,
          customerNickname: (dto as any).customerNickname,
          customerAccountId: (dto as any).customerAccountId,
          customerPlatformAccount: (dto as any).customerPlatformAccount,
          customerWechat: dto.customerWechat,
          customerWechatQr: (dto as any).customerWechatQr || undefined,
          customerRoomCode: dto.customerRoomCode,
          customerYy: (dto as any).customerYy,
          csWorkWechatId: (dto as any).workWechatId || undefined,
          csWorkWechatName: (dto as any).workWechatName || undefined,
          csCultivated: (dto as any).csCultivated === true ? true : undefined,
          // 这张单是从哪张「客服养好的客户」派出去的（跟进列表「重新派单」带过来），
          // 有了它，「管理端直添客户流转明细」才追得回源头。
          cultivatedFromOrderId:
            (dto as any).csCultivated === true
              ? ((dto as any).sourceOrderId || undefined)
              : undefined,
          deltaMission: (dto as any).deltaMission,
          deltaCount: (dto as any).deltaCount,
          deltaNote: (dto as any).deltaNote,
          billingMode: (dto as any).billingMode,
          transferScreenshotUrl: (dto as any).transferScreenshotUrl || undefined,
          urgency: (dto as any).directAdd === true ? 'later' : (dto as any).urgency,
          scheduledTimeText: (dto as any).scheduledTimeText || undefined,
          serviceType: (dto as any).serviceType ?? 'PLAY_WITH',
          gameMode: (dto as any).gameMode,
          isCompensation: (dto as any).isCompensation === true ? true : undefined,
          ...((dto as any).directAdd === true
            ? {
                directAdd: true,
                poolExpired: true,
                poolExpiredAt: new Date().toISOString(),
                poolHandled: true,
                poolHandledAt: new Date().toISOString(),
              }
            : {}),
          broadcast: dto.dispatchType === 'BROADCAST' ? true : undefined,
          dispatchCount: 1,
          firstDispatchedAt: new Date().toISOString(),
          dispatchHistory: [{ at: new Date().toISOString(), action: 'DISPATCH' }],
        },
        paymentAccountId: (dto as any).paymentAccountId || null,
      },
      include: { customer: true },
    });

    // 从「客服跟进台账」点「直接派单」出来的单：把来源那条跟进标成「已派单」，
    // 台账里那一行留着当记录，客服点「处理完成」才从台账里消失。
    if ((dto as any).csCultivated === true && (dto as any).sourceOrderId) {
      await this.prisma.order
        .update({
          where: { id: String((dto as any).sourceOrderId) },
          data: { contactStatus: 'dispatched' },
        })
        .catch(() => null);
    }

    // 弹窗只服务「广播」和「指定」两种方式：入池订单只进抢单池，不弹窗。
    const isUrgent = (dto as any).urgency === 'now';
    const popupCreator = await this.prisma.user.findUnique({
      where: { id: dto.csUserId },
      select: { username: true, role: true },
    });
    // 弹窗停留时长（设置里可配，默认 15 秒 —— 老板 2026-10-01「15 秒消失」）随单下发，
    // 让陪玩端桌面横幅用同一个数。
    const popupSeconds = await this.getPopupSeconds(studioId ?? null);
    const popupPayload = {
      ...newOrder,
      _createdBy: popupCreator?.username || '未知',
      _creatorRole: popupCreator?.role || 'CS',
      _popupSeconds: popupSeconds,
    };
    // 「线上→线下流转」的单（老板 2026-10-01）：本店线下陪玩先看不见，弹窗 / 通知都只往桥接 + 线上那边发，
    // 否则本店陪玩会收到一个自己抢不到的单的弹窗（点进去还提示没权限）。
    const onlineFirst = newOrder.poolScope === PoolScope.ONLINE_FIRST;

    // 广播出去的是「还没人接的单」，弹窗 payload 里不能带客户联系方式
    // （老板 2026-10-01：「还没抢就显示微信 那还抢什么？」）—— 陪玩点了横幅是回抢单池再抢，
    // 抢到手之后才走订单详情拿微信。指定单（DIRECT）是他自己的单，不动。
    const broadcastPopupPayload = stripPoolCustomerContact(popupPayload) as typeof popupPayload;

    // BROADCAST: 右下角弹窗给本店在线陪玩
    // （空闲 + 娱乐中一定弹；接单中默认不打扰，陪玩可在「陪玩端 → 设置」自行打开）
    if (dto.dispatchType === 'BROADCAST' && studioId) {
      if (onlineFirst) {
        // 本店不弹；桥接 / 线上那边立即弹（“秒看到”就是这一步：立即 = 延时 0）
        void this.wsGateway.broadcastUrgentToBridgedStudios(
          studioId,
          newOrder.id,
          { ...broadcastPopupPayload, _broadcast: true, _bridged: true },
          0,
        );
      } else {
      await this.wsGateway.broadcastNewOrder(studioId, {
        ...broadcastPopupPayload,
        _broadcast: true,
      });
      // 桥接工作室那边也弹一次，但要等「桥接工作室等待」到了才弹，
      // 保证本店陪玩仍然先有这段先手；不等它跑完，先把响应返回去。
      void this.wsGateway.broadcastUrgentToBridgedStudios(
        studioId,
        newOrder.id,
        { ...broadcastPopupPayload, _broadcast: true, _bridged: true },
        await this.getBridgeDelayMs(studioId),
      );
      }
    }

    // DIRECT: 指定给某个陪玩，右下角弹窗提醒他
    // 老板 2026-10-06：「指定到某个陪玩，直接进订单管理，陪玩有时候可能注意不到」——
    // 指定单不用抢、只在订单管理里躺着，横幅 15 秒一闪而过就再也看不见了，所以给它更长的停留时间；
    // 之后还没点「开始首单」，由 DirectAssignmentReminderService 在第 5 / 10 / 20 分钟再各喊一遍。
    if (dto.dispatchType === 'DIRECT' && dto.companionId) {
      this.wsGateway.notifyCompanion(dto.companionId, 'order:urgent', {
        ...popupPayload,
        _popupSeconds: DIRECT_ALERT_SECONDS,
        _direct: true,
      });
    }

    // Auto-create first session when order is created
    if (newOrder.companionId) {
      // 指定订单不在这里进入「接单中」：等陪玩点「首单」才开始计时、才置接单中、才杀黑名单。
      const session = await this.prisma.orderSession
        .create({
          data: {
            parentOrderId: newOrder.id,
            seq: 1,
            companionId: newOrder.companionId,
            coCompanionId: newOrder.coCompanionId,
            amount: newOrder.amount,
            coAmount: (newOrder as any).coAmount ?? null,
            duration: newOrder.duration || 1,
            // 老板 2026-10-04：双陪开新单同样能消耗存单 —— 主陪发起时带的标记先落在会话上，
            // 搭档接受邀请（acceptPartnerInvite）不改这个字段，所以结束服务时照扣。
            paidByDeposit: dto.useDeposit === true,
            status: 'ACTIVE',
          },
        })
        .catch(() => null);

      // 双陪（指定搭档）：创建后立即通知搭档接受邀请
      if (session && session.coCompanionId) {
        const inviter = await this.prisma.companion.findUnique({
          where: { id: session.companionId || '' },
          select: { user: { select: { displayName: true, username: true } } },
        }).catch(() => null);
        const inviterName = inviter?.user?.displayName || inviter?.user?.username || '';
        this.wsGateway.pushOrder(session.coCompanionId, {
          ...session,
          gameName: newOrder.gameName,
          customerId: newOrder.customerId,
          orderId: newOrder.id,
          type: 'DUAL_INVITE',
          inviterName,
          expiresInSec: PARTNER_INVITE_TTL_SEC,
        });
        this.schedulePartnerInviteExpiry(session.id, newOrder.studioId || '');
      }

      // 双陪续单 / 复购：这条路不经过 addSession / startSession，单价没人检查 ——
      // 在会话建出来的这一刻按「续单 / 复购」的底线提醒一次（徐泽宁那对复购填 35 就是这么漏的）。
      // 单陪的交给 startSession 填价那一步提醒，这里只管有搭档、别处不会触发的。
      if (session?.coCompanionId && (newOrder.type === 'REPURCHASE' || newOrder.type === 'RENEW')) {
        void this
          .alertBelowFloorPrice(newOrder, session, {
            claimedMode: resolvePriceMode(null, newOrder.customFields),
            coAmount: (newOrder as any).coAmount,
            duration: newOrder.duration,
          })
          .catch(() => null);
      }
    }

    if (studioId && newOrder.dispatchType === 'POOL') {
      if (onlineFirst) {
        this.wsGateway.broadcastToBridgedStudios(studioId, 'order:pool_updated', newOrder);
      } else if (isUrgent) {
        this.wsGateway.broadcastToBridgedStudios(studioId, 'order:pool_updated', newOrder);
      } else {
        this.wsGateway.broadcastToStudio(studioId, 'order:pool_updated', newOrder);
      }
    }

    // Desktop notification: DIRECT → only target companion; POOL/BROADCAST → all
    if (dto.dispatchType === 'DIRECT' && dto.companionId) {
      const csUser = await this.prisma.user.findUnique({ where: { id: dto.csUserId }, select: { username: true } });
      const isBuDan =
        (dto as any).deltaNote?.includes('补单') || (newOrder.customFields as any)?.deltaNote?.includes('补单');
      this.wsGateway.pushOrder(dto.companionId, {
        ...newOrder,
        _inviterName: csUser?.username || '系统',
        _isAssignment: true,
        _label: isBuDan ? '补单' : '新订单',
      });
    } else if (studioId) {
      if (onlineFirst) {
        // 线上→线下流转的单：本店陪玩在这张单被放给线下之前根本看不到，不给本店发通知
      } else if (isUrgent) {
        this.wsGateway.broadcastToBridgedStudios(studioId, 'order:new', {
          ...newOrder,
          _notify: true,
        });
      } else {
        this.wsGateway.broadcastToStudio(studioId, 'order:new', {
          ...newOrder,
          _notify: true,
        });
      }
    }

    return newOrder;
  }

  /** 桥接工作室等待时长（毫秒）：桥接工作室的陪玩要等这么久才能看到本店的单。 */
  private async getBridgeDelayMs(studioId?: string | null): Promise<number> {
    const scoped = await resolveConfigsRaw(this.prisma, studioId ?? null, [
      'pool.bridge_delay_seconds',
    ]);
    return Number(scoped['pool.bridge_delay_seconds'] ?? DEFAULT_BRIDGE_DELAY_SECONDS) * 1000;
  }

  async findPool(companionId?: string, studioId?: string) {
    const where: any = {
      status: 'PENDING',
      dispatchType: 'POOL',
      // 客服「指定」给某个陪玩的单不再出现在可抢列表里（老板 2026-10-06）：
      // 指定单发布那一刻就是 GRABBED + dispatchType=DIRECT，本来也进不来；
      // 这里再钉一道「companionId 必须为空」，保证任何已经带陪玩的单都不会被人再点一次「抢单」。
      companionId: null,
    };
    if (studioId) {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
      where.studioId = { in: [studioId, ...bridgedIds] };
    }

    // 等待时长按「本店店长填的 → 老板全局默认」解析，各店互不影响
    const [poolCfg, studio] = await Promise.all([
      resolveConfigsRaw(this.prisma, studioId ?? null, [
        'pool.priority_delay_seconds',
        'pool.bridge_delay_seconds',
        'pool.middle_delay_seconds',
        'pool.low_delay_seconds',
        'pool.online_delay_seconds',
        'pool.online_first_release_minutes',
        'pool.offline_first_bridge_minutes',
      ]),
      studioId
        ? this.prisma.studio.findUnique({ where: { id: studioId }, select: { type: true } })
        : null,
    ]);
    const priorityDelay = Number(poolCfg['pool.priority_delay_seconds'] ?? 0) * 1000;
    const bridgeDelay = Number(poolCfg['pool.bridge_delay_seconds'] ?? DEFAULT_BRIDGE_DELAY_SECONDS) * 1000;
    const middleDelay = Number(poolCfg['pool.middle_delay_seconds'] ?? 60) * 1000;
    const lowDelay = Number(poolCfg['pool.low_delay_seconds'] ?? 120) * 1000;
    const onlineDelay = Number(poolCfg['pool.online_delay_seconds'] ?? 180) * 1000;
    // 「线上→线下流转」的单没人管时，多久自动放给本店线下陪玩（分钟）
    const onlineFirstReleaseMinutes = Number(poolCfg['pool.online_first_release_minutes'] ?? 5);
    // 「线下→线上流转」的单：本店线下先抢这么久，没人接才轮到桥接 / 线上俱乐部（分钟）
    const offlineFirstBridgeMinutes = Number(poolCfg['pool.offline_first_bridge_minutes'] ?? 3);
    const offlineFirstBridgeDelay = Math.max(0, offlineFirstBridgeMinutes) * 60_000;
    const studioType = studio?.type ?? 'DIRECT';

    // 当前陪玩的段位（只对自家工作室订单生效）
    let tier = 'MIDDLE';
    if (companionId) {
      const ex = await this.excellence.computeOne(companionId);
      tier = ex?.tier || 'MIDDLE';
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        customer: { select: { wechatId: true, customerCode: true, platform: true } },
        csUser: { select: { username: true, avatar: true, displayName: true, role: true } },
        studio: { select: { name: true } },
      },
      // 抢单池统一按发布时间倒序：新单排在最上面。
      // 之前这里是 asc，接口返回最老的单在前，凡是没在前端再排一次的页面
      // （派单工作台的订单池）就会出现「新发布的单跑到最底部」。
      orderBy: { createdAt: 'desc' },
    });

    // 已过消失时间、标记为待客服处理的订单不再出现在抢单池；
    // 按「上等马 → 桥接 → 中等马 → 下等马 → 线上」分别延迟可见。
    const now = Date.now();
    const isCompanion = !!companionId;
    const available = orders.filter((o) => {
      const cf = (o.customFields as any) || {};
      // 客服已经处理过的单子不再回到抢单池。
      if (cf.poolHandled) return false;
      // 超时未处理的订单只进入客服/管理端的“流转失败明细”，不再出现在陪玩订单池。
      if (cf.poolExpired) return false;
      // 「线上→线下流转」的单（老板 2026-10-01）：本店线下陪玩先看不见，客服/店长手动放了、
      // 或过了自动放行时间才出现；一旦放行立即可见，不再排段位。
      // （客服 / 店长的派单工作台一直看得见，只是这一列会带「线上→线下」的标记。）
      const onlineFirstOrder = o.poolScope === PoolScope.ONLINE_FIRST;
      const ownOfflineOrder = !!studioId && o.studioId === studioId && studioType !== 'RENTAL';
      if (onlineFirstOrder && ownOfflineOrder) {
        if (isCompanion && !visibleToOwnOffline(o, onlineFirstReleaseMinutes, now)) return false;
        return true;
      }
      const waited = now - new Date(o.createdAt).getTime();
      let delay: number;
      if (!studioId) {
        delay = 0; // 老板（无工作室）看全部订单，立即可见
      } else if (ownOfflineOrder) {
        // 本店自己的单：广播的急单自家所有人立即可见；其余按段位（管理端/客服不受段位限制）
        delay =
          cf.broadcast === true || !isCompanion
            ? 0
            : tier === 'TOP' ? priorityDelay : tier === 'MIDDLE' ? middleDelay : lowDelay;
      } else {
        // 别家看本店的单：桥接工作室 / 线上俱乐部。
        // 「线上→线下流转」= 桥接工作室 + 线上俱乐部秒看到（等待时间 0），没人接再放给本店线下；
        // 「线下→线上流转」= 本店线下先抢 offlineFirstBridgeDelay 分钟，没人接才轮到桥接 / 线上
        //（老板 2026-09-29：「线下没人接，几分钟后到桥接，桥接没人接直接到线上俱乐部」——
        //  所以这里桥接和线上用同一个下限，桥接没人接线上马上能接）。
        return outsideViewerVisible(
          o,
          {
            bridgeDelayMs: bridgeDelay,
            onlineDelayMs: onlineDelay,
            offlineFirstBridgeMs: offlineFirstBridgeDelay,
            isRentalViewer: studioType === 'RENTAL',
          },
          now,
        );
      }
      return waited >= delay;
    });

    // 老板 2026-09-21：订单池里只看得到「还没被抢走」的单，陪玩一忙、一看视频就以为
    // 工作室没单，其实是被人抢走了。现在把今天（营业日 12:00 起）已经被抢的单也一起
    // 返回，前端灰掉显示，让大家看得到「今天发过这些单」。
    // 只对陪玩端（有 companionId）返回；管理端/客服在「全部订单」里本来就看得见。
    if (!companionId) return available;

    const taken = await this.findTakenPoolOrders(companionId, studioId);
    // 陪玩端**看不到别人单的客户联系方式**（老板 2026-10-01：「还没抢就显示微信 那还抢什么？」）。
    // 客服指定给自己的单、以及自己已经抢到的单照常看得见 —— 抢单池那一行只是给人挑单用的。
    return [...available, ...taken].map((o) =>
      o.companionId === companionId || o.coCompanionId === companionId
        ? o
        : stripPoolCustomerContact(o),
    );
  }

  /**
   * 今天（营业日 12:00 起）已经被抢走 / 已在服务的订单池订单 —— 陪玩端的灰色记录。
   * 刻意不带客户微信号、来源账号、二维码：只是让陪玩看到「今天有这些单、被谁抢了」，
   * 别人的客户信息一条都不给。
   */
  private async findTakenPoolOrders(companionId: string, studioId?: string) {
    const { start } = currentBusinessDayRange();
    // 陪玩端「已被抢」灰色记录现在也带上客服「指定」单（老板 2026-10-06）：
    // 指定单不走抢单池，以前一条都不显示 —— 陪玩在池子里既找不到自己那张被指定的单，
    // 也看不到「这单已经指定给谁了」。带上 DIRECT 之后，指定单会像被抢走的单一样灰色列出来，
    // 写清「🎯 客服指定给 XX 接」，且永远没有「抢单」按钮。
    const where: any = {
      dispatchType: { in: ['POOL', 'DIRECT'] },
      status: { in: ['GRABBED', 'CONFIRMED', 'DONE', 'CANCELLED', 'CLAIMED'] },
      OR: [{ createdAt: { gte: start } }, { grabbedAt: { gte: start } }],
    };
    if (studioId) {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
      where.studioId = { in: [studioId, ...bridgedIds] };
    }

    const rows = await this.prisma.order.findMany({
      where,
      select: {
        id: true,
        orderCode: true,
        type: true,
        status: true,
        dispatchType: true,
        amount: true,
        gameName: true,
        serviceType: true,
        duration: true,
        customFields: true,
        createdAt: true,
        grabbedAt: true,
        updatedAt: true,
        companionId: true,
        coCompanionId: true,
        studioId: true,
        csUserId: true,
        companion: { select: { user: { select: { displayName: true, username: true } } } },
        coCompanion: { select: { user: { select: { displayName: true, username: true } } } },
        csUser: { select: { username: true, avatar: true, displayName: true, role: true } },
        studio: { select: { name: true } },
      },
      orderBy: [{ grabbedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });

    return rows
      .filter((o) => {
        const cf = (o.customFields as any) || {};
        // 客服已经处理过、或判定流转失败的单不再展示（和上面的可抢列表口径一致）。
        return !cf.poolHandled && !cf.poolExpired;
      })
      .map((o) => ({
        ...o,
        customer: null,
        _taken: true,
        _direct: o.dispatchType === 'DIRECT',
        _takenByMe: o.companionId === companionId || o.coCompanionId === companionId,
        _takenByName:
          o.companion?.user?.displayName ||
          o.companion?.user?.username ||
          o.coCompanion?.user?.displayName ||
          o.coCompanion?.user?.username ||
          '其他陪玩',
        _takenAt: o.grabbedAt ?? o.updatedAt,
      }));
  }

  /**
   * 订单管理列表。
   *
   * `scope` 只有客服端和陪玩端用得上：
   * - 客服：「只看我的」传 `mine`，要看全店传 `all`（不传按原来的全店口径）
   * - 陪玩：「我抢到的」传 `taken`（默认），「我服务的」传 `served`，「我发的」传 `published`
   * 店长 / 老板传什么都不受影响，各自走下面的本店 / 全部工作室分支。
   */
  async findAll(user: any, status?: string, scope?: string) {
    const where: any = {};
    // 别人正想转给我、还没点同意的单（老板 2026-10-03）：它们现在还不挂在我名下，
    // 但老板要的是「在订单列表那一行点接手」——所以先查出来，等下一并按 id 捞进本次查询。
    let pendingIncoming: Array<{
      id: string;
      orderId: string;
      fromCompanionId: string;
      reason: string | null;
      createdAt: Date;
    }> = [];
    if (status) where.status = status;
    // Role-based filtering (showAll only bypasses for OWNER — security fix C4)
    if (user.role === 'COMPANION') {
      if (scope === 'published') {
        // 「我发的单」：陪玩端的首单 / 续费 / 复购是陪玩自己发起，发布人就是他本人。
        // 这里不再排除 PENDING+POOL —— 自己发出去还没人抢的单也是「我发的单」。
        where.csUserId = user.id;
      } else {
        // 陪玩一定挂着 Companion 档案。万一没挂（异常账号），宁可给空列表 ——
        // 否则 `{ companionId: undefined }` 会被 Prisma 当成空条件，等于把全站订单漏给他。
        if (!user.companionId) return [];
        if (scope === 'served') {
          // 「我服务的单」（老板 2026-10-03）：别人抢到、我当搭档（副陪）跟着一起打的单。
          // 以前这类单混在「我接的单」里，跟主陪自己的单分不清；现在单独一栏，
          // 并且这一栏里客户微信对副陪隐藏（见函数结尾的 maskPartnerContactView）。
          // 带上 sessions 那一层：搭档关系换过手、只有会话上还是我的，也别漏。
          where.OR = [
            { coCompanionId: user.companionId },
            { sessions: { some: { coCompanionId: user.companionId } } },
          ];
          if (!status) where.NOT = { status: 'PENDING', dispatchType: 'POOL' };
        } else {
        // 默认「我抢到的」：挂在我名下的单（抢到的 / 派给我的）。
        // 自己发的单只要也挂在我名下，这里照样留着 —— 老板 2026-09-27 明确
        // 「自己发的单两个栏都显示」，所以这里不排除自己发布的那些。
          where.OR = [{ companionId: user.companionId }];
          // 转让出去的订单也要留在转出方的接单记录里（老板 2026-09-29：抢单超时
          // 自动回收整条删掉，改由陪玩自己转让；转给谁、什么时候转的都得看得到）。
          where.OR.push({ transfers: { some: { fromCompanionId: user.companionId } } });
          // 别人要转给我的单也进「我抢到的」：那一行会长出「接手 / 拒绝」
          // （老板 2026-10-03：「放在订单列表那一行点转让或者点接受不行么」）。
          // 以前只靠顶栏铃铛 / 弹窗提醒，单子压根不在列表里，陪玩想点都没地方点。
          pendingIncoming = await this.prisma.orderTransferRequest.findMany({
            // 只看还没过期的：过期的申请不能再把单子拉进我的列表
            // （实测过：只看 status 的话，超时那条会把一张跟我无关的单留在列表里，
            //  只是按钮不显示 —— 列表里多一行莫名其妙的东西同样是错）。
            where: {
              toCompanionId: user.companionId,
              status: 'PENDING',
              createdAt: { gt: new Date(Date.now() - TRANSFER_REQUEST_TTL_SEC * 1000) },
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: { id: true, orderId: true, fromCompanionId: true, reason: true, createdAt: true },
          });
          if (pendingIncoming.length) {
            where.OR.push({ id: { in: pendingIncoming.map((r) => r.orderId) } });
          }
          if (!status) where.NOT = { status: 'PENDING', dispatchType: 'POOL' };
        }
      }
    } else if (user.role === 'CS') {
      if (scope === 'mine') {
        // 「我的单」= 自己发布的 + 自己认领的池子单：认领也是客服自己在跟的单，
        // 漏掉它会出现「刚认领完就从列表里消失」。这个口径与 updatePayment /
        // updateOrderInfo 里对客服的权限判断保持一致。
        where.OR = [{ csUserId: user.id }, { claimedCsUserId: user.id }];
      } else {
        const bridgedIds = await this.bridgeService.getBridgedStudioIds(user.studioId);
        where.studioId = { in: [user.studioId, ...bridgedIds] };
      }
    } else if (user.role === 'ADMIN') {
      // 店长只显示本店，不跨桥接工作室
      where.studioId = user.studioId;
    }
    // OWNER: 不添加过滤条件，可以看到所有订单
    const orders = await this.prisma.order.findMany({
      where,
      include: {
        customer: true,
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
        claimedCsUser: { select: { id: true, username: true, avatar: true, displayName: true } },
        // 发布方工作室：和接单陪玩的工作室对照，能看出是不是桥接工作室接的单
        studio: { select: { id: true, name: true } },
        // 接单陪玩所属工作室：桥接工作室接单时，订单上的 studioId 仍是发布方，
        // 客服要靠这一层才能看出「这单是谁家接的」。
        companion: {
          include: {
            user: { select: { id: true, username: true, avatar: true, displayName: true } },
            // type 也要带上：前端靠它区分「桥接别家店」和「线上俱乐部（租赁）」，
            // 好决定这张线上 / 桥接单要不要让接单方反馈「成功 / 不成功」。
            studio: { select: { id: true, name: true, type: true } },
          },
        },
        coCompanion: { include: { user: { select: { username: true } } } },
        // 转让留痕（老板 2026-09-29）：订单管理 / 接单记录 / 客户管理都要能写出
        // 「已于某时由某人转让给某人」，所以列表里一并带上。
        transfers: {
          orderBy: { createdAt: 'desc' },
          // 只要「谁转给谁 + 时间 + 原因」，别把两个陪玩实体整套塞进每一行
          // （订单列表是高频接口，留痕每条多带 30 来个字段纯属浪费）。
          select: {
            id: true,
            createdAt: true,
            reason: true,
            fromCompanion: { select: { id: true, user: { select: { id: true, username: true, displayName: true } } } },
            toCompanion: { select: { id: true, user: { select: { id: true, username: true, displayName: true } } } },
          },
        },
        sessions: {
          orderBy: { seq: 'desc' },
          take: 1,
          select: { id: true, startedAt: true, endedAt: true, duration: true, totalPausedSec: true, seq: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    // 逐行挂上「别人要转给我、等我点接手」的申请（老板 2026-10-03），并丢掉已经不成立的：
    // 单已经不在对方名下、状态不再是已抢单/已确认、申请已过期 —— 这些一律不下发，
    // 免得陪玩在列表里看到一个点了会报错的「接手」。
    const pendingTransferMap = new Map<string, any>();
    if (pendingIncoming.length) {
      const byId = new Map(orders.map((o) => [o.id, o]));
      const fromIds = Array.from(new Set(pendingIncoming.map((r) => r.fromCompanionId)));
      const fromCompanions = await this.prisma.companion.findMany({
        where: { id: { in: fromIds } },
        select: { id: true, user: { select: { username: true, displayName: true } } },
      });
      const fromNameMap = new Map(
        fromCompanions.map((c) => [c.id, c.user?.displayName || c.user?.username || '']),
      );
      const nowMs = Date.now();
      for (const r of pendingIncoming) {
        const o: any = byId.get(r.orderId);
        if (!o) continue;
        if (o.companionId !== r.fromCompanionId) continue;
        if (o.status !== 'GRABBED' && o.status !== 'CONFIRMED') continue;
        const expiresAt = new Date(r.createdAt).getTime() + TRANSFER_REQUEST_TTL_SEC * 1000;
        if (expiresAt <= nowMs) continue;
        pendingTransferMap.set(r.orderId, {
          requestId: r.id,
          fromCompanionId: r.fromCompanionId,
          fromName: fromNameMap.get(r.fromCompanionId) || '',
          reason: r.reason || '',
          expiresAt,
        });
      }
    }
    // 隐私：副陪（搭档）看不到主陪的客户微信。
    // 引流账号（来源账号）**不再按角色抹成 `***`**（老板 2026-09-30「管理端的 订单管理
    // 引流账号 怎么是 *？」）：陪玩端那一列本来就被 CustomerSourceMaskInterceptor 整列摘掉了，
    // 管理端（客服 / 店长 / 老板）一律显示完整账号 —— 和「客户管理」那一格同一口径。
    const rows = orders.map((o) =>
      maskCustomerWechat({ ...o, pendingTransferForMe: pendingTransferMap.get(o.id) || null }, user),
    );
    if (user.role === 'COMPANION' && scope === 'served') {
      // 「我服务的单」里主陪不是我的，一律按副陪视角遮客户微信：这一栏是我跟着别人打的单，
      // 客户资源是主陪的（老板 2026-10-03：「这个订单可以隐藏掉客户的微信信息，保护王昊的权益」）。
      return rows.map((o: any) =>
        o.companionId === user.companionId ? o : maskPartnerContactView(o),
      );
    }
    return rows;
  }

  async grab(orderId: string, companionId: string) {
    return this.workflowService.grab(orderId, companionId);
  }

  /** 陪玩待开始的订单：已抢单/已确认，但还没有真正开始计时的会话。 */
  async findPendingStart(companionId: string) {
    if (!companionId) return [];
    return this.prisma.order.findMany({
      where: {
        companionId,
        status: { in: ['GRABBED', 'CONFIRMED'] },
        sessions: { none: { status: 'ACTIVE', startedAt: { not: null } } },
      },
      include: {
        customer: { select: { wechatId: true, customerCode: true, platform: true } },
        sessions: { orderBy: { seq: 'asc' }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateContact(orderId: string, body: any) {
    // M1: Validate order is in GRABBED or CONFIRMED state before allowing contact updates
    const order0 = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order0 || (order0.status !== 'GRABBED' && order0.status !== 'CONFIRMED')) {
      throw new ForbiddenException('只能对已抢单或已确认的订单更新联系状态');
    }
    const data: any = {};
    if (body.contactStatus !== undefined) data.contactStatus = body.contactStatus;
    if (body.scheduledAt !== undefined) data.scheduledAt = new Date(body.scheduledAt);
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.screenshotUrl !== undefined) data.screenshotUrl = body.screenshotUrl;
    if (body.workWechatId !== undefined) {
      const order2 = await this.prisma.order.findUnique({ where: { id: orderId }, select: { customFields: true } });
      const cf2 = (order2?.customFields as any) || {};
      if (body.workWechatName !== undefined) cf2.workWechatName = body.workWechatName;
      data.customFields = { ...cf2, workWechatId: body.workWechatId };
    }
    if (body.workWechatName !== undefined) {
      const cf3 = (data.customFields as any) || {};
      data.customFields = { ...cf3, workWechatName: body.workWechatName };
    }
    const updated = await this.prisma.order.update({ where: { id: orderId }, data, include: { customer: true } });

    // M6: Only link customer when contact is successfully added (not 'not_accepted')
    if (body.contactStatus === 'added' && updated.customer) {
      await this.prisma.customer.upsert({
        where: { id: updated.customerId },
        update: {
          companionId: updated.customer.companionId || updated.companionId,
        },
        create: {
          id: updated.customerId,
          studioId: updated.studioId,
          customerCode: updated.customer.customerCode || `C${Date.now().toString(36)}`,
          wechatId: (updated.customFields as any)?.customerWechat || updated.customer.wechatId || '',
          platform: (updated.customFields as any)?.customerSource || '',
          platformAccount: (updated.customFields as any)?.customerPlatformAccount || '',
          companionId: updated.companionId,
          status: 'FOLLOW_UP',
        },
      });
    }
    // 陪玩点「添加失败」→ 自动生成一条补单申请，等管理端审核（老板 2026-10-04）。
    if (body.contactStatus === 'not_accepted') {
      await this.upsertSupplementRequest(updated, body).catch(() => null);
    }
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
  }

  /** 管理端能看到的工作室范围；老板不限（返回 null = 不过滤）。 */
  private async supplementScopeIds(user: any): Promise<string[] | null> {
    if (user?.role === 'OWNER' || !user?.studioId) return null;
    return this.bridgeService.getVisibleStudioIds(user.studioId);
  }

  /** 陪玩点「添加失败」时建档：同一张单只留一条；被驳回后重新提交会回到待审。 */
  private async upsertSupplementRequest(order: any, body: any): Promise<void> {
    if (!order?.companionId) return;
    const reason = String(body?.failReason || body?.reason || '').trim() || null;
    const evidenceUrl = String(body?.screenshotUrl || body?.evidenceUrl || '').trim() || null;
    const existing = await this.prisma.supplementRequest.findUnique({ where: { orderId: order.id } });
    if (existing) {
      // 已经补过的单不再重复开，避免同一张单被反复要名额
      if (existing.status === 'APPROVED') return;
      await this.prisma.supplementRequest.update({
        where: { orderId: order.id },
        data: {
          companionId: order.companionId,
          studioId: order.studioId ?? existing.studioId,
          reason,
          evidenceUrl,
          status: 'PENDING',
          decidedByUserId: null,
          decidedAt: null,
          decisionNote: null,
          reviewDueAt: null,
          reviewStatus: null,
          reviewedAt: null,
          reviewedByUserId: null,
        },
      });
      await this.notifySupplementRequest(order, reason).catch(() => null);
      return;
    }
    await this.prisma.supplementRequest.create({
      data: {
        orderId: order.id,
        companionId: order.companionId,
        studioId: order.studioId ?? null,
        reason,
        evidenceUrl,
        status: 'PENDING',
      },
    });
    await this.notifySupplementRequest(order, reason).catch(() => null);
  }

  /**
   * 陪玩提交补单申请 → 实时告诉本店客服 / 店长 + 全站老板。
   *
   * 老板 2026-10-04 问「这种交互 双方都有提示么？」——以前陪玩这边提交完，
   * 管理端只有「订单管理」页上那个每 60 秒自己轮询一次的红点数字，
   * 管理端不在那一页就完全不知道有人要补单。
   */
  private async notifySupplementRequest(order: any, reason: string | null): Promise<void> {
    const studioId: string | null = order?.studioId ?? null;
    const where: any = { isAuthorized: true, role: { in: ['OWNER', 'ADMIN', 'CS'] } };
    if (studioId) where.OR = [{ studioId }, { role: 'OWNER', studioId: null }];
    else where.role = 'OWNER';
    const found = await this.prisma.user.findMany({ where, select: { id: true } }).catch(() => []);
    const reviewers = Array.isArray(found) ? found : [];
    if (!reviewers.length) return;
    const companion = await this.prisma.companion
      .findUnique({
        where: { id: order.companionId },
        select: { user: { select: { displayName: true, username: true } } },
      })
      .catch(() => null);
    const name =
      (companion as any)?.user?.displayName || (companion as any)?.user?.username || '有陪玩';
    const code = order?.orderCode || order?.id || '';
    const payload = {
      orderId: order?.id ?? null,
      orderCode: order?.orderCode ?? null,
      companionId: order?.companionId ?? null,
      companionName: name,
      reason: reason ?? null,
      message: `${name} 提交了补单申请（订单 ${code}），去「订单管理 → 补单审核」同意或驳回`,
    };
    for (const reviewer of reviewers) {
      this.wsGateway.notifyUser((reviewer as any).id, 'order:supplement_request', payload);
    }
  }

  /**
   * 补单申请列表（客服 / 店长 / 老板）。
   * scope = 'pending' 只看待审；'due' 只看「已同意、到期要核查客户后来通过没」；不传看全部。
   */
  async listSupplements(user: any, scope?: 'pending' | 'due' | 'all') {
    if (!['OWNER', 'ADMIN', 'CS'].includes(user?.role ?? '')) {
      throw new ForbiddenException('只有客服 / 店长 / 老板能看补单申请');
    }
    const visibleIds = await this.supplementScopeIds(user);
    const where: any = {};
    if (visibleIds) where.studioId = { in: visibleIds };
    if (scope === 'pending') {
      where.status = 'PENDING';
    } else if (scope === 'due') {
      where.status = 'APPROVED';
      where.reviewStatus = { in: ['PENDING', 'STILL_NOT'] };
      where.reviewDueAt = { lte: new Date() };
    } else {
      where.status = { in: ['PENDING', 'APPROVED', 'REJECTED'] };
    }
    const rows = await this.prisma.supplementRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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
    return rows.map((r) => {
      const order = orderMap.get(r.orderId) ?? null;
      const cf = (order?.customFields as any) || {};
      return {
        ...r,
        companionName: nameMap.get(r.companionId) ?? null,
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

  /** 管理端顶部红点用的数量：待审几条、到期要核查几条。 */
  async supplementSummary(user: any) {
    const visibleIds = await this.supplementScopeIds(user);
    const base = visibleIds ? { studioId: { in: visibleIds } } : {};
    const [pending, due] = await Promise.all([
      this.prisma.supplementRequest.count({ where: { ...base, status: 'PENDING' } }),
      this.prisma.supplementRequest.count({
        where: {
          ...base,
          status: 'APPROVED',
          reviewStatus: { in: ['PENDING', 'STILL_NOT'] },
          reviewDueAt: { lte: new Date() },
        },
      }),
    ]);
    return { pending, due };
  }

  /**
   * 审核补单（老板 2026-10-04）：同意 = 陪玩次数 +1（写台账），
   * 并排一次「客户后来通过没」的核查，别把这个客户浪费掉；驳回只留痕。
   */
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
    const approve = String(decision || '').toUpperCase() === 'APPROVE';
    const reviewDueAt = new Date(Date.now() + SUPPLEMENT_REVIEW_HOURS * 3600 * 1000);
    const updated = await this.prisma.supplementRequest.update({
      where: { id },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedByUserId: user?.id ?? null,
        decidedAt: new Date(),
        decisionNote: (note || '').trim() || null,
        ...(approve ? { reviewDueAt, reviewStatus: 'PENDING' } : {}),
      },
    });
    if (approve) {
      await this.quota.credit(req.companionId, 1, QUOTA_REASON.SUPPLEMENT, {
        refId: req.orderId,
        note: '管理端同意补单，返还 1 个名额',
      });
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
        message: approve
          ? '管理端已同意补单，你的抢单次数 +1'
          : '管理端驳回了补单申请，这次不返还名额',
      });
    }
    return updated;
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
   * 「线上→线下流转」的单：客服 / 店长点一下放给本店线下陪玩（老板 2026-10-01：
   * 「孙或店长点一下『也放给线下陪玩』」）。没人点也会在
   * `pool.online_first_release_minutes` 分钟后自动放行（判定在 findPool 里，纯读时计算）。
   */
  async releaseToOffline(orderId: string, user: any) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });

    if (!order) throw new NotFoundException('订单不存在');
    if (user?.role !== 'OWNER' && user?.studioId) {
      const visibleIds = await this.bridgeService.getVisibleStudioIds(user.studioId);
      if (!visibleIds.includes(order.studioId)) throw new ForbiddenException('无权操作其他工作室的订单');
    }
    if (order.poolScope !== PoolScope.ONLINE_FIRST) {
      throw new ForbiddenException('这张单本来就是线下→线上流转（本店线下先抢），不用放');
    }
    if (order.releasedToOfflineAt) return order; // 已经放过，重复点不报错
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { releasedToOfflineAt: new Date() },
    });
    this.wsGateway.broadcastToStudio(updated.studioId, 'order:pool_updated', updated);
    // 老板 2026-10-01：放给线下时本店每个陪玩都要弹一次（原来只是悄悄进池子）。
    void this.broadcastReleasedToOffline(updated).catch(() => null);
    return updated;
  }

  /** 弹窗停留时长（秒）：设置里没填就 15。 */
  async getPopupSeconds(studioId: string | null): Promise<number> {
    const cfg = await resolveConfigsRaw(this.prisma, studioId, ['pool.popup_seconds']).catch(
      () => ({}) as Record<string, unknown>,
    );
    const raw = Number((cfg as Record<string, unknown>)['pool.popup_seconds']);
    return Number.isFinite(raw) && raw > 0 ? raw : 15;
  }

  /**
   * 「线上→线下流转」的单放给本店线下时，给本店每个陪玩弹一次（老板 2026-10-01）。
   * 收件人规则跟广播一致（空闲 / 挂机一定弹，娱乐中 / 接单中看本人开关）。
   */
  async broadcastReleasedToOffline(order: any): Promise<void> {
    if (!order?.studioId) return;
    const popupCreator = await this.prisma.user
      .findUnique({ where: { id: order.csUserId }, select: { username: true, role: true } })
      .catch(() => null);
    const popupSeconds = await this.getPopupSeconds(order.studioId);
    await this.wsGateway.broadcastNewOrder(order.studioId, {
      ...stripPoolCustomerContact(order),
      _createdBy: popupCreator?.username || '未知',
      _creatorRole: popupCreator?.role || 'CS',
      _popupSeconds: popupSeconds,
      _broadcast: true,
      _releasedToOffline: true,
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
    if (!(OrdersService.REVIEW_RESPONSIBILITIES as readonly string[]).includes(responsibility)) {
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
      const since = new Date(Date.now() - OrdersService.ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);
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
    const cutoff = Date.now() - OrdersService.RECHECK_AFTER_MINUTES * 60_000;
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

  async updateOrderInfo(orderId: string, user: any, dto: any) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status === 'CANCELLED') throw new ForbiddenException('已取消的订单不能修改');
    if (order.status === 'DONE' && (dto?.amount !== undefined || dto?.duration !== undefined)) {
      throw new ForbiddenException('已完成订单不能修改金额或时长，请走退款/补单');
    }

    if (user?.role === 'CS' || user?.role === 'COMPANION') {
      if (order.csUserId !== user.id) throw new ForbiddenException('只能修改自己发布的订单');
    } else if (user?.role === 'ADMIN') {
      if (order.studioId !== user.studioId) throw new ForbiddenException('无权修改其他工作室的订单');
    } else if (user?.role !== 'OWNER') {
      throw new ForbiddenException('无权修改订单');
    }

    const has = (key: string) => Object.prototype.hasOwnProperty.call(dto || {}, key);
    const orderData: any = {};
    if (has('gameName')) orderData.gameName = dto.gameName;
    if (has('serviceType')) orderData.serviceType = dto.serviceType;
    if (has('duration')) orderData.duration = dto.duration;
    if (has('amount')) orderData.amount = dto.amount;
    if (has('notes')) orderData.notes = dto.notes;
    if (has('type')) orderData.type = dto.type;
    if (has('scheduledAt')) orderData.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;

    const customFieldKeys = [
      'customerSource',
      'customerSourceAccount',
      'customerNickname',
      'customerAccountId',
      'customerPlatformAccount',
      'customerWechat',
      'customerWechatQr',
      'customerRoomCode',
      'customerYy',
      'deltaMission',
      'deltaCount',
      'deltaNote',
      'billingMode',
      'urgency',
      'scheduledTimeText',
      'gameMode',
      'serviceType',
    ];

    const cfPatch: any = {};
    for (const key of customFieldKeys) {
      if (!has(key)) continue;
      const value = dto[key];
      cfPatch[key] = key === 'customerWechatQr' && !value ? undefined : value;
    }

    const currentCf = (order.customFields as any) || {};
    const nextCf = { ...currentCf, ...cfPatch };

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        ...orderData,
        customFields: nextCf,
      },
      include: {
        customer: true,
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
        companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } },
        coCompanion: { include: { user: { select: { username: true } } } },
      },
    });

    const customerData: any = {};
    if (has('customerWechat')) customerData.wechatId = dto.customerWechat ?? '';
    if (has('customerSource')) customerData.platform = dto.customerSource || null;
    if (has('customerPlatformAccount')) customerData.platformAccount = dto.customerPlatformAccount || null;
    if (Object.keys(customerData).length > 0) {
      await this.prisma.customer
        .update({ where: { id: order.customerId }, data: customerData })
        .catch((err) => {
          logger.error('updateOrderInfo: sync customer failed', { orderId, error: (err as Error).message });
        });
    }

    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    if (updated.companionId) this.wsGateway.pushOrder(updated.companionId, updated);
    if (updated.coCompanionId) {
      const coSafe = maskCustomerWechat(updated, {
        id: '',
        role: 'COMPANION',
        companionId: updated.coCompanionId,
      });
      this.wsGateway.pushOrder(updated.coCompanionId, coSafe);
    }
    return updated;
  }

  async updateAmount(orderId: string, companionId: string, amount: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { companionId: true, status: true, studioId: true },
    });
    if (!order || order.companionId !== companionId) throw new ForbiddenException('无权操作此订单');
    // W2: Only allow amount updates for GRABBED or CONFIRMED orders
    if (order.status !== 'GRABBED' && order.status !== 'CONFIRMED') {
      throw new ForbiddenException('只能对已抢单或已确认的订单修改金额');
    }
    const updated = await this.prisma.order.update({ where: { id: orderId }, data: { amount } });
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async compensateCustomer(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    const customer = await this.prisma.customer.create({
      data: {
        studioId: order.studioId,
        wechatId: 'BC-' + order.id.slice(0, 8),
        companionId: order.companionId,
        customerCode: 'BC' + Date.now().toString(36).toUpperCase(),
        notes: '补单客户（原订单 ' + order.id + '）',
      },
    });
    return customer;
  }

  async renew(orderId: string, userId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.companionId !== companionId) throw new ForbiddenException('无权操作此订单');
    const orderCode = await this.nextGlobalCode();
    const newOrder = await this.prisma.order.create({
      data: {
        orderCode,
        type: 'RENEW',
        studioId: order.studioId,
        csUserId: userId,
        customerId: order.customerId,
        companionId: order.companionId,
        coCompanionId: order.coCompanionId,
        coAmount: order.coAmount,
        dispatchType: 'DIRECT',
        source: order.source,
        attributedCsUserId: order.attributedCsUserId ?? order.claimedCsUserId ?? order.csUserId,
        amount: order.amount,
        gameName: order.gameName,
        duration: order.duration,
        customFields: { ...((order.customFields as any) || {}), renewedFrom: orderId },
        status: 'PENDING',
      },
    });
    if (order.companionId) {
      this.wsGateway.pushOrder(order.companionId, newOrder);
    }
    if (order.coCompanionId) {
      this.wsGateway.pushOrder(order.coCompanionId, newOrder);
    }
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', newOrder);
    return newOrder;
  }

  async republish(orderId: string, userId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.companionId !== companionId) throw new ForbiddenException('无权操作此订单');
    const orderCode = await this.nextGlobalCode();
    const newOrder = await this.prisma.order.create({
      data: {
        orderCode,
        type: order.type,
        studioId: order.studioId,
        csUserId: userId,
        customerId: order.customerId,
        dispatchType: 'POOL',
        source: order.source,
        attributedCsUserId: order.attributedCsUserId ?? order.claimedCsUserId ?? order.csUserId,
        amount: order.amount,
        gameName: order.gameName,
        duration: order.duration,
        customFields: order.customFields as any,
        status: 'PENDING',
      },
      include: { csUser: { select: { username: true, avatar: true, displayName: true, role: true } } },
    });
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', newOrder);
    return newOrder;
  }

  async assign(orderId: string, companionId: string, userStudioId?: string) {
    return this.dispatchService.assign(orderId, companionId, userStudioId);
  }

  async acceptAssignment(orderId: string, companionId: string) {
    return this.dispatchService.acceptAssignment(orderId, companionId);
  }

  async declineAssignment(orderId: string, companionId: string) {
    return this.dispatchService.declineAssignment(orderId, companionId);
  }

  async quickGrab(orderId: string, companionId: string) {
    return this.dispatchService.quickGrab(orderId, companionId);
  }

  async findUrgent(studioId: string, user?: { id: string; role: string }) {
    const now = Date.now();
    const disappearScoped = await resolveConfigsRaw(this.prisma, studioId ?? null, [
      'pool.immediate_disappear_minutes',
    ]);
    const disappearSeconds = Number(disappearScoped['pool.immediate_disappear_minutes'] ?? 10) * 60;
    const where: any = { status: 'PENDING', dispatchType: 'POOL' };
    if (studioId) where.studioId = studioId;
    const orders = await this.prisma.order.findMany({
      where,
      include: {
        customer: { select: { wechatId: true, customerCode: true, platform: true } },
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
      },
      // 新的在前。原来是 asc（最老的排最前面），结果「刚流转失败」的那条被压在几十行旧单下面，
      // 老板 2026-09-27 就因此以为「这单没进流转失败明细」（线上实测：客户 229 那张单排在第 29/29 条）。
      orderBy: { createdAt: 'desc' },
    });

    const list = await Promise.all(
      orders
        .filter((o) => {
          const cf = (o.customFields as any) || {};
          if (cf.poolHandled) return false;
          if (o.contactStatus === 'not_accepted') return false;
          // 立即打：全部显示（加急+待处理）；预约：只显示已过期的待处理
          return cf.urgency === 'now' || (cf.urgency === 'later' && cf.poolExpired);
        })
        .map(async (o) => {
          const cf = (o.customFields as any) || {};
          // 老板/店长可处理所有单；客服只能处理自己发布的单。
          const canProcess = user?.role !== 'CS' || user?.id === o.csUserId;
          const maskedCf = canProcess
            ? cf
            : {
                ...cf,
                customerSourceAccount: undefined,
                customerNickname: undefined,
                customerAccountId: undefined,
                customerWechat: undefined,
                customerWechatQr: undefined,
                customerYy: undefined,
                customerPlatformAccount: undefined,
                customerRoomCode: undefined,
              };
          const isScheduled = cf.urgency === 'later';
          const waitingSeconds = Math.max(0, Math.floor((now - o.createdAt.getTime()) / 1000));
          const poolExpired = !!cf.poolExpired;
          const availableCompanions =
            !isScheduled && waitingSeconds >= 300
              ? await this.getSoonEndingCompanions(studioId)
              : [];
          return {
            ...o,
            customer: canProcess ? o.customer : null,
            waitingSeconds,
            urgent: !isScheduled,
            poolExpired,
            poolExpiredAt: cf.poolExpiredAt || '',
            dispatchCount: cf.dispatchCount || 1,
            firstDispatchedAt: cf.firstDispatchedAt || '',
            dispatchHistory: cf.dispatchHistory || [],
            isScheduled,
            requireCsContact: poolExpired || (!isScheduled && waitingSeconds >= disappearSeconds),
            csContactStatus: o.contactStatus || '',
            csContactEvidenceUrl: cf.csContactEvidenceUrl || '',
            customFields: maskedCf,
            availableCompanions,
            canProcess,
          };
        }),
    );

    // 已消失（待客服处理）的订单排最前；同一组里保持上面查出来的「新的在前」（Array.sort 稳定）。
    return list.sort((a, b) => Number(b.poolExpired) - Number(a.poolExpired));
  }

  async markCsContact(
    orderId: string,
    status: string,
    evidenceUrl?: string,
    extra?: { workWechatId?: string; workWechatName?: string; addResult?: string; failReason?: string; note?: string },
    user?: { id: string; role: string },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (user?.role === 'CS' && order.csUserId !== user.id) {
      throw new ForbiddenException('只能处理自己发布的订单');
    }
    const cf = (order.customFields as any) || {};
    const result = extra?.addResult;
    // agreed = 客户已同意（跟进台账里点的那一步）、dispatched = 这条跟进已经派出单去了
    const contactStatus =
      status === 'agreed'
        ? 'agreed'
        : status === 'dispatched'
          ? 'dispatched'
          : result === 'passed'
            ? 'added'
            : result === 'failed'
              ? 'not_accepted'
              : 'pending';
    const poolHandled = status === 'added';
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        contactStatus,
        customFields: {
          ...cf,
          csContactAt: new Date().toISOString(),
          csContactEvidenceUrl: evidenceUrl || '',
          // 客服标「添加失败」时选的原因 + 备注（老板 2026-10-06）：留档，方便跟发单者 / 店长核对
          ...(extra?.failReason ? { csContactFailReason: extra.failReason } : {}),
          ...(extra?.note ? { csContactNote: extra.note } : {}),
          ...(extra?.workWechatId !== undefined ? { csWorkWechatId: extra.workWechatId } : {}),
          ...(extra?.workWechatName !== undefined ? { csWorkWechatName: extra.workWechatName } : {}),
          ...(result === 'passed' ? { csCultivated: true } : {}),
          ...(status === 'added' ? { poolHandled } : {}),
        },
      },
    });
  }

  async redispatch(
    orderId: string,
    studioId?: string,
    user?: { id: string; role: string },
    body?: { poolScope?: string },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'PENDING' || order.dispatchType !== 'POOL') {
      throw new ForbiddenException('该订单当前不可重新派单');
    }
    if (studioId && order.studioId !== studioId) {
      throw new ForbiddenException('无权操作其他工作室的订单');
    }
    if (user?.role === 'CS' && order.csUserId !== user.id) {
      throw new ForbiddenException('只能处理自己发布的订单');
    }
      const cf = (order.customFields as any) || {};
      delete cf.poolExpired;
      delete cf.poolExpiredAt;
      delete cf.poolHandled;
      delete cf.poolHandledAt;
      const dispatchHistory = (cf.dispatchHistory || []).concat({
        at: new Date().toISOString(),
        action: 'REDISPATCH',
      });
      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          contactStatus: null,
          // 重新派单时客服可以再选一次入池方式（老板 2026-10-01）：
          // 「线下→线上流转」/「线上→线下流转」。不传就沿用原来那张单的方式。
          ...(body && body.poolScope !== undefined
            ? {
                poolScope:
                  normalizePoolScope(body.poolScope) === PoolScope.ONLINE_FIRST
                    ? PoolScope.ONLINE_FIRST
                    : null,
                // 换了方式就把「手动放给线下」的时间清掉，重新按新方式排
                releasedToOfflineAt: null,
              }
            : {}),
          customFields: {
            ...cf,
            dispatchCount: (cf.dispatchCount || 1) + 1,
          firstDispatchedAt: cf.firstDispatchedAt || new Date().toISOString(),
          dispatchHistory,
        },
        createdAt: new Date(), // 重置发单时间，让等待时间重新计算
      },
    });
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async markPoolHandled(orderId: string, user?: { id: string; role: string }) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (user?.role === 'CS' && order.csUserId !== user.id) {
      throw new ForbiddenException('只能处理自己发布的订单');
    }
    const cf = (order.customFields as any) || {};
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        contactStatus: null,
        customFields: { ...cf, poolHandled: true, poolHandledAt: new Date().toISOString() },
      },
    });
  }

  async listCsFollowup(studioId: string, user?: { id: string; role: string }) {
    const where: any = { status: 'PENDING' };
    if (studioId) where.studioId = studioId;
    // 客服只看自己跟进的单，店长/老板看全工作室
    if (user && user.role === 'CS') where.csUserId = user.id;
    const orders = await this.prisma.order.findMany({
      where,
      include: {
        // 跟进台账要显示「最后跟进（时间 + 聊了啥）」「下次跟进」「客服工作微信」，
        // 所以把客户最近一条跟进记录一起带出来（只取一条，代价很小）
        customer: { include: { followUps: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
        claimedCsUser: { select: { id: true, username: true, avatar: true, displayName: true } },
        companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } },
        coCompanion: { include: { user: { select: { username: true } } } },
        sessions: {
          where: { status: 'ACTIVE', startedAt: { not: null } },
          orderBy: { seq: 'desc' },
          take: 1,
          select: { id: true, startedAt: true, duration: true, seq: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    // 台账状态：待添加 / 已添加 / 客户已同意 / 添加失败 / 已派单。
    // 「已派单」这一行留着当记录（客服点「处理完成」才从这里消失，见 markPoolHandled）。
    return orders.filter((o) => {
      return (
        o.contactStatus === 'pending' ||
        o.contactStatus === 'added' ||
        o.contactStatus === 'agreed' ||
        o.contactStatus === 'not_accepted' ||
        o.contactStatus === 'dispatched'
      );
    });
  }

  // 客服养好的客户重新派单后，被谁抢走、陪玩用什么微信、最终去了线下/桥接/线上
  async listCsConverted(studioId: string, user?: { id: string; role: string }) {
    const where: any = { companionId: { not: null }, status: { not: 'CANCELLED' } };
    if (studioId) where.studioId = studioId;
    if (user && user.role === 'CS') where.csUserId = user.id;
    const juejuCents = await this.getJuejuReturnCents(studioId);

        const orders = await this.prisma.order.findMany({
        where,
        include: {
          customer: true,
          csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
          claimedCsUser: { select: { id: true, username: true, avatar: true, displayName: true } },
          companion: {
            include: {
              user: { select: { id: true, username: true, avatar: true, displayName: true } },
              studio: { select: { id: true, name: true, type: true } },
            },
          },
          coCompanion: { include: { user: { select: { id: true, username: true } } } },
          moneyFlows: true,
        },
        orderBy: { updatedAt: 'desc' },
      });

    return orders
      .filter((o) => {
        const cf = (o.customFields as any) || {};
        return cf.csCultivated === true;
      })
        .map((o) => {
          const cf = (o.customFields as any) || {};
          const compStudio = o.companion?.studio;
          let destination = '线下工作室';
        if (compStudio) {
          if (compStudio.type === 'RENTAL') destination = '线上俱乐部';
          else if (compStudio.id !== studioId) destination = '桥接工作室';
          else destination = '线下工作室';
        }
        let addStatus = '待结果';
        if (o.contactStatus === 'added') addStatus = '添加成功';
        else if (o.contactStatus === 'not_accepted') addStatus = '添加失败';
        const moneyIn = o.moneyFlows
          .filter((f) => f.direction === 'IN')
          .reduce((s, f) => s + f.amount, 0);
          const moneyOut = o.moneyFlows
            .filter((f) => f.direction === 'OUT')
            .reduce((s, f) => s + f.amount, 0);
          const isDouble = o.coCompanionId || cf.deltaCount === '双';
          const companions = isDouble ? 2 : 1;
          const bridgeReturn =
            cf.deltaMission === '绝密' ? (juejuCents / 100) * (o.duration || 1) * companions : 0;
          return {
            ...o,
            companionUserId: o.companion?.user?.id || '',
            customerPaidAccount: o.customerPaymentAccountName || '',
            moneyIn,
            moneyOut,
            bridgeReturn,
            addStatus,
            destination,
        };
      });
  }

  /**
   * 「线下→线上流转」的单，线下没人接、被桥接工作室 / 线上俱乐部接走 —— 统计 + 标注
   * （老板 2026-09-29：「选择线下+线上入池的时候，线下没人接，被桥接工作室或者线上俱乐部接走
   * 你要做好统计，并做好标注，记录好机密还是绝密、应收多少，钱在哪里等信息并做好汇总」）。
   *
   * 口径：
   *  - 只统计**本店**发的、入池方式 =「线下→线上流转」的单（poolScope 不是 ONLINE_FIRST）；
   *  - 只统计**已经被人抢走**、而且抢的人不是本店线下（桥接工作室 / 线上俱乐部）的单；
   *  - **桥接工作室** = 「首单不结」模式：机密 35 元/人/时、绝密 30 元/人/时是工作室净得的；
   *  - **线上俱乐部** = 「抽成」模式：工作室拿 100 − 陪玩分成（revenue.club_companion_share）；
   *  - 应收 = 客户按流水（单价 × 时长，双陪算两份）；
   *  - 应返还 = 绝密单返还给接单方（默认 15 元/人/小时，双陪 ×2）；机密首单不结、不返还。
   */
  async listEscalatedPoolOrders(studioId: string, opts?: { month?: string; csUserId?: string }) {
    const now = new Date();
    const month = opts?.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const blankTotals = () => ({
      count: 0,
      bridgeCount: 0,
      onlineCount: 0,
      units: 0,
      jimiUnits: 0,
      juejuUnits: 0,
      grossYuan: 0,
      returnYuan: 0,
      studioNetYuan: 0,
      bridgeGrossYuan: 0,
      onlineGrossYuan: 0,
      bridgeReturnYuan: 0,
      onlineReturnYuan: 0,
      moneyInYuan: 0,
      moneyOutYuan: 0,
    });
    if (!studioId) return { month, totals: blankTotals(), rows: [] as any[] };
    const { start, end } = settlementMonthRange(month);

    const [juejuCents, scopedCfg] = await Promise.all([
      this.getJuejuReturnCents(studioId),
      resolveConfigsRaw(this.prisma, studioId, [
        'bridge.secret_price_yuan',
        'bridge.jueju_net_yuan',
        'revenue.club_companion_share',
      ]),
    ]);
    const secretPrice = Number(scopedCfg['bridge.secret_price_yuan'] ?? 35);
    const juejuNet = Number(scopedCfg['bridge.jueju_net_yuan'] ?? 30);
    const clubCompanionShare = Number(scopedCfg['revenue.club_companion_share'] ?? 80);

    const orders = await this.prisma.order.findMany({
      where: {
        studioId,
        createdAt: { gte: start, lt: end },
        companionId: { not: null },
        status: { not: 'CANCELLED' },
        AND: [
          // 「线下→线上流转」= poolScope 不是 ONLINE_FIRST（含历史 null）。
          // 注意：这里必须显式写 `null OR <>`，不能用 `NOT: { poolScope: ... }` ——
          // SQL 里 `NOT (poolScope = 'x')` 对 NULL 求值还是 NULL，会把所有老单（poolScope 为 null）全过滤掉。
          { OR: [{ poolScope: null }, { poolScope: { not: PoolScope.ONLINE_FIRST } }] },
          ...(opts?.csUserId
            ? [
                {
                  OR: [
                    { attributedCsUserId: opts.csUserId },
                    { claimedCsUserId: opts.csUserId },
                    { csUserId: opts.csUserId },
                  ],
                },
              ]
            : []),
        ],
      },
      include: {
        customer: { select: { customerCode: true, wechatId: true } },
        csUser: { select: { id: true, username: true, displayName: true } },
        claimedCsUser: { select: { id: true, username: true, displayName: true } },
        companion: {
          include: {
            user: { select: { username: true, displayName: true } },
            studio: { select: { id: true, name: true, type: true } },
          },
        },
        coCompanion: { include: { user: { select: { username: true } } } },
        moneyFlows: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows = orders
      .filter((o) => {
        const compStudio = o.companion?.studio;
        // 只留「被别家接走」的：桥接工作室（别的店）或线上俱乐部（租赁店）
        return !!compStudio && (compStudio.id !== studioId || compStudio.type === 'RENTAL');
      })
      .map((o) => {
        const cf = (o.customFields as any) || {};
        const compStudio = o.companion!.studio!;
        const isOnline = compStudio.type === 'RENTAL';
        const mission =
          cf.deltaMission === '绝密' ? '绝密' : cf.deltaMission === '机密' ? '机密' : '';
        const units = orderUnits(o as any);
        const duration = Number(o.duration) || 1;
        const gross = (Number(o.amount || 0) + Number(o.coAmount || 0)) * duration;
        const returnYuan = mission === '绝密' ? (juejuCents / 100) * duration * units : 0;
        const studioNetYuan = isOnline
          ? Number((gross * ((100 - clubCompanionShare) / 100)).toFixed(2))
          : Number(((mission === '绝密' ? juejuNet : secretPrice) * duration * units).toFixed(2));
        const moneyIn = o.moneyFlows
          .filter((f) => f.direction === 'IN')
          .reduce((s, f) => s + Number(f.amount || 0), 0);
        const moneyOut = o.moneyFlows
          .filter((f) => f.direction === 'OUT')
          .reduce((s, f) => s + Number(f.amount || 0), 0);
        const moneyWhere = Array.from(
          new Set(
            [
              cf.csWorkWechatName ? `客服工作微信 ${cf.csWorkWechatName}` : '',
              o.customerPaymentAccountName ? `客户付款到 ${o.customerPaymentAccountName}` : '',
              ...o.moneyFlows.map((f) =>
                f.counterpart ? `${f.direction === 'IN' ? '转入' : '转出'} ${f.counterpart}` : '',
              ),
            ].filter(Boolean),
          ),
        );
        const decision = outcomeOf(o as any, studioId);
        return {
          orderId: o.id,
          orderCode: o.orderCode,
          createdAt: o.createdAt,
          grabbedAt: o.grabbedAt,
          gameName: o.gameName,
          customerCode: o.customer?.customerCode || '',
          customerWechat: o.customer?.wechatId || cf.customerWechat || '',
          csName: o.csUser?.displayName || o.csUser?.username || '',
          csUserId: o.csUser?.id || '',
          mission,
          countText: units === 2 ? '双陪' : '单陪',
          units,
          duration,
          destination: isOnline ? '线上俱乐部' : '桥接工作室',
          destinationStudioName: compStudio.name || '',
          settleMode: isOnline ? '抽成' : '首单不结',
          grossYuan: Number(gross.toFixed(2)),
          returnYuan: Number(returnYuan.toFixed(2)),
          studioNetYuan,
          moneyInYuan: Number(moneyIn.toFixed(2)),
          moneyOutYuan: Number(moneyOut.toFixed(2)),
          moneyWhere,
          state: decision.state,
          stateReason: decision.reason,
        };
      });

    const totals = blankTotals();
    for (const r of rows) {
      totals.count += 1;
      totals.units += r.units;
      if (r.mission === '绝密') totals.juejuUnits += r.units;
      else if (r.mission === '机密') totals.jimiUnits += r.units;
      totals.grossYuan += r.grossYuan;
      totals.returnYuan += r.returnYuan;
      totals.studioNetYuan += r.studioNetYuan;
      totals.moneyInYuan += r.moneyInYuan;
      totals.moneyOutYuan += r.moneyOutYuan;
      if (r.destination === '线上俱乐部') {
        totals.onlineCount += 1;
        totals.onlineGrossYuan += r.grossYuan;
        totals.onlineReturnYuan += r.returnYuan;
      } else {
        totals.bridgeCount += 1;
        totals.bridgeGrossYuan += r.grossYuan;
        totals.bridgeReturnYuan += r.returnYuan;
      }
    }
    const rounded: Record<string, number> = {};
    for (const [k, v] of Object.entries(totals)) {
      rounded[k] = k.endsWith('Yuan') ? Number(v.toFixed(2)) : v;
    }
    return { month, totals: rounded, rows };
  }

  async listMoneyFlows(orderId: string) {
    return this.prisma.orderMoneyFlow.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  async addMoneyFlow(
    orderId: string,
    data: { direction: string; amount: number; counterpart: string; counterpartId?: string; note?: string },
  ) {
    return this.prisma.orderMoneyFlow.create({
      data: {
        orderId,
        direction: data.direction,
        amount: data.amount,
        counterpart: data.counterpart,
        counterpartId: data.counterpartId,
        note: data.note,
      },
      });
  }

  // 客服每个工作微信的余额 = 流入(客户转入) - 流出(转给陪玩/桥接等) - 店长转走的余额
  // 客服角色只看自己绑定的工作微信，店长/老板看本工作室全部。
  async listCsWechatBalances(studioId: string, csUserId?: string) {
    const [wechats, orders, logs] = await Promise.all([
      this.prisma.workWechat.findMany({
        where: { studioId, type: 'STUDIO', ...(csUserId ? { csUserId } : {}) },
      }),
      this.prisma.order.findMany({ where: { studioId }, select: { customFields: true, moneyFlows: true } }),
      this.prisma.workWechatBalanceLog.findMany({ where: { studioId } }),
    ]);

    const withdrawnMap = new Map<string, number>();
    for (const l of logs) {
      withdrawnMap.set(l.workWechatId, (withdrawnMap.get(l.workWechatId) || 0) + l.amount);
    }

    return wechats.map((w) => {
      const related = orders.filter(
        (o) => ((o.customFields as any) || {}).csWorkWechatName === w.wechatId,
      );
      let inTotal = 0;
      let outTotal = 0;
      for (const o of related) {
        for (const f of o.moneyFlows) {
          if (f.direction === 'IN') inTotal += f.amount;
          else if (f.direction === 'OUT') outTotal += f.amount;
        }
      }
      const withdrawn = withdrawnMap.get(w.id) || 0;
      return {
        id: w.id,
        wechatId: w.wechatId,
        csUserId: w.csUserId,
        inTotal,
        outTotal,
        withdrawn,
        balance: inTotal - outTotal - withdrawn,
      };
    });
  }

  // 店长把客服微信里的余额转走，记录一笔清零流水，让系统余额归零
  async clearCsWechatBalance(studioId: string, workWechatId: string, note?: string) {
    const balances = await this.listCsWechatBalances(studioId);
    const target = balances.find((b) => b.id === workWechatId);
    if (!target) throw new NotFoundException('该客服微信不存在');
    if (target.balance <= 0) throw new BadRequestException('当前余额为 0，无需清零');

    await this.prisma.workWechatBalanceLog.create({
      data: {
        studioId,
        workWechatId,
        amount: target.balance,
        note: note || '店长转走余额清零',
      },
    });

    return this.listCsWechatBalances(studioId);
  }

  // 店长转走余额统计：本月 / 今年 / 累计，跨所有客服工作微信
  async getCsWechatBalanceSummary(studioId: string) {
    const logs = await this.prisma.workWechatBalanceLog.findMany({ where: { studioId } });
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let monthTotal = 0;
    let yearTotal = 0;
    let allTotal = 0;
    for (const l of logs) {
      allTotal += l.amount;
      if (l.createdAt >= yearStart) yearTotal += l.amount;
      if (l.createdAt >= monthStart) monthTotal += l.amount;
    }
    return {
      monthTotal,
      yearTotal,
      allTotal,
      count: logs.length,
    };
  }

  // 客服工作微信收款明细：按微信聚合相关订单的每一笔资金流水，并标出问题单。
  async listCsWechatFlow(studioId: string) {
    const [wechats, orders, logs, bridgeCfg] = await Promise.all([
      this.prisma.workWechat.findMany({ where: { studioId, type: 'STUDIO' } }),
      this.prisma.order.findMany({
        where: { studioId, status: { not: 'CANCELLED' } },
        include: {
          moneyFlows: true,
          customer: { select: { wechatId: true } },
          csUser: { select: { username: true, displayName: true } },
          companion: {
            include: {
              user: { select: { username: true, displayName: true } },
              studio: { select: { id: true, type: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.workWechatBalanceLog.findMany({ where: { studioId } }),
      this.getJuejuReturnCents(studioId),
    ]);
    const juejuCents = bridgeCfg;

    const withdrawnMap = new Map<string, number>();
    for (const l of logs) {
      withdrawnMap.set(l.workWechatId, (withdrawnMap.get(l.workWechatId) || 0) + l.amount);
    }

    return wechats.map((w) => {
      const related = orders.filter(
        (o) => ((o.customFields as any) || {}).csWorkWechatName === w.wechatId,
      );

      const orderRows = related.map((o) => {
        const cf = (o.customFields as any) || {};
        const inTotal = o.moneyFlows
          .filter((f) => f.direction === 'IN')
          .reduce((s, f) => s + f.amount, 0);
        const outTotal = o.moneyFlows
          .filter((f) => f.direction === 'OUT')
          .reduce((s, f) => s + f.amount, 0);
        const expected = Number(o.amount || 0) * (Number(o.duration) || 1);

        let destination = '线下工作室';
        if (o.companion?.studio) {
          if (o.companion.studio.type === 'RENTAL') destination = '线上俱乐部';
          else if (o.companion.studio.id !== studioId) destination = '桥接工作室';
        }

        const problems = this.evaluateOrderProblems(o, studioId, juejuCents);

        return {
          id: o.id,
          orderCode: o.orderCode,
          gameName: o.gameName,
          status: o.status,
          customerWechat: o.customer?.wechatId || cf.customerWechat || '',
          csName: o.csUser?.displayName || o.csUser?.username || '',
          companionName: o.companion?.user?.displayName || o.companion?.user?.username || '',
          destination,
          expected: Number(expected.toFixed(1)),
          inTotal: Number(inTotal.toFixed(1)),
          outTotal: Number(outTotal.toFixed(1)),
          problems,
        };
      });

      const inTotal = orderRows.reduce((s, r) => s + r.inTotal, 0);
      const outTotal = orderRows.reduce((s, r) => s + r.outTotal, 0);
      const withdrawn = withdrawnMap.get(w.id) || 0;

      return {
        id: w.id,
        wechatId: w.wechatId,
        nickname: w.nickname || '',
        csUserId: w.csUserId,
        inTotal: Number(inTotal.toFixed(1)),
        outTotal: Number(outTotal.toFixed(1)),
        withdrawn: Number(withdrawn.toFixed(1)),
        balance: Number((inTotal - outTotal - withdrawn).toFixed(1)),
        problemCount: orderRows.filter((r) => r.problems.length > 0).length,
        orders: orderRows,
      };
    });
  }

  private evaluateOrderProblems(o: any, studioId?: string, juejuCents = 1500): string[] {
    const moneyFlows = o.moneyFlows || [];
    const inTotal = moneyFlows
      .filter((f: any) => f.direction === 'IN')
      .reduce((s: number, f: any) => s + f.amount, 0);
    const outTotal = moneyFlows
      .filter((f: any) => f.direction === 'OUT')
      .reduce((s: number, f: any) => s + f.amount, 0);
    const expected = Number(o.amount || 0) * (Number(o.duration) || 1);
    const cf = (o.customFields as any) || {};
    const isDouble = o.coCompanionId || cf.deltaCount === '双';
    const companions = isDouble ? 2 : 1;
    const isDone = o.status === 'CONFIRMED' || o.status === 'DONE';

    // 判断去向：本工作室陪玩 / 桥接工作室 / 线上俱乐部
    let isBridgeOrOnline = false;
    if (o.companion?.studio) {
      if (o.companion.studio.type === 'RENTAL') isBridgeOrOnline = true;
      else if (studioId && o.companion.studio.id !== studioId) isBridgeOrOnline = true;
    }

    const problems: string[] = [];
    if (moneyFlows.length === 0) {
      problems.push('未记流水');
    } else {
      if (inTotal <= 0) problems.push('无客户转入');

      if (isBridgeOrOnline) {
        // 桥接/线上：机密本来就不给钱；绝密按 15 元/人/小时返还。
        if (cf.deltaMission === '绝密') {
          const bridgeReturn = (juejuCents / 100) * (Number(o.duration) || 1) * companions;
          if (isDone && outTotal < bridgeReturn) problems.push('桥接/线上返还不足');
        }
      } else {
        // 本工作室陪玩：客户转入后应转给陪玩。
        if (isDone && inTotal > 0 && outTotal <= 0) problems.push('未转陪玩');
      }

      if (outTotal > inTotal) problems.push('转出超过转入');
      if (inTotal > 0 && Math.abs(inTotal - expected) >= 0.01) problems.push('转入金额与订单不符');
    }
    return problems;
  }

  // 客服记完流水后，检查这单账是否还有异常；有异常就提醒负责的客服去修改。
  async checkAndNotifyCsAnomaly(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        moneyFlows: true,
        companion: { include: { studio: { select: { id: true, type: true } } } },
      },
    });
    if (!order) return;
    const juejuCents = await this.getJuejuReturnCents(order.studioId);

    const cf = (order.customFields as any) || {};
    const wechatId = cf.csWorkWechatName;
    if (!wechatId) return;

    const workWechat = await this.prisma.workWechat.findUnique({ where: { wechatId } });
    if (!workWechat?.csUserId) return;

    const problems = this.evaluateOrderProblems(order, order.studioId, juejuCents);
    if (problems.length === 0) return;

    this.wsGateway.notifyUser(workWechat.csUserId, 'cs:account_anomaly', {
      orderId: order.id,
      orderCode: order.orderCode,
      gameName: order.gameName,
      wechatId,
      problems,
      message: `你的工作微信 ${wechatId} 订单「${order.gameName}」账目有异常：${problems.join('、')}，请到客服工作台「管理端直添客户流转明细」里修改`,
    });
  }

  /**
   * 绝密单的线上返款（分/小时）：取「设置 → 派单与提成 → 绝密线上返款」，按店解析。
   * 兼容老的隐藏键 `pool.bridge_return_jueju_cents`（历史上只在库里手填过）。
   */
  private async getJuejuReturnCents(studioId?: string | null): Promise<number> {
    const scoped = await resolveConfigsRaw(this.prisma, studioId ?? null, [
      'dispatch.bridge_return_jueju_cents',
      'pool.bridge_return_jueju_cents',
    ]);
    const v =
      scoped['dispatch.bridge_return_jueju_cents'] ?? scoped['pool.bridge_return_jueju_cents'];
    const n = Number(v);
    return Number.isFinite(n) ? n : 1500;
  }

  async listMoneyReconciliation(studioId: string) {
    const [orders, bridgeCfg] = await Promise.all([
      this.prisma.order.findMany({
        where: { studioId, status: { not: 'CANCELLED' } },
        include: {
          moneyFlows: true,
          customer: { select: { wechatId: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.getJuejuReturnCents(studioId),
    ]);
    const juejuCents = bridgeCfg;

    const rows = orders
      .filter((o) => o.moneyFlows.length > 0)
      .map((o) => {
        const cf = (o.customFields as any) || {};
        const inTotal = o.moneyFlows
          .filter((f) => f.direction === 'IN')
          .reduce((s, f) => s + f.amount, 0);
        const outTotal = o.moneyFlows
          .filter((f) => f.direction === 'OUT')
          .reduce((s, f) => s + f.amount, 0);
        const isDouble = o.coCompanionId || cf.deltaCount === '双';
        const companions = isDouble ? 2 : 1;
        const bridgeReturn =
          cf.deltaMission === '绝密' ? (juejuCents / 100) * (o.duration || 1) * companions : 0;
        const profit = inTotal - outTotal;
        return {
          orderId: o.id,
          orderCode: o.orderCode,
          gameName: o.gameName,
          customerWechat: o.customer?.wechatId || cf.customerWechat || '',
          csWorkWechatName: cf.csWorkWechatName || '',
          deltaMission: cf.deltaMission || '',
          inTotal,
          outTotal,
          bridgeReturn,
          profit,
          flagged: profit < 0 || outTotal > inTotal,
        };
      });

    return {
      rows,
      totalIn: rows.reduce((s, r) => s + r.inTotal, 0),
      totalOut: rows.reduce((s, r) => s + r.outTotal, 0),
      totalBridgeReturn: rows.reduce((s, r) => s + r.bridgeReturn, 0),
      totalProfit: rows.reduce((s, r) => s + r.profit, 0),
    };
  }

  private async getSoonEndingCompanions(studioId: string) {
    if (!studioId) return [];
    const companions = await this.prisma.companion.findMany({
      where: { studioId, status: 'BUSY' },
      include: {
        user: { select: { username: true } },
        sessions: {
          where: { endedAt: null },
          include: { parentOrder: { select: { duration: true, amount: true } } },
        },
      },
    });
    const list = await Promise.all(
      companions.map(async (c) => {
        const excellent = await this.excellence.isExcellent(c.id);
        const remainingMinutes = c.sessions
          .map((s) => {
            if (!s.startedAt) return 999;
            const durationMs = (s.parentOrder?.duration || 1) * 3600_000;
            return Math.max(0, Math.round((durationMs - (Date.now() - s.startedAt.getTime())) / 60000));
          })
          .sort((a, b) => a - b)[0] ?? 999;
        return { id: c.id, name: c.user?.username || c.id, excellent, remainingMinutes };
      }),
    );
    return list.sort((a, b) => Number(b.excellent) - Number(a.excellent) || a.remainingMinutes - b.remainingMinutes);
  }

  async claim(
    orderId: string,
    csUserId: string,
    dto: {
      workWechatId?: string;
      workWechatName?: string;
      customerPaidTo?: string;
      customerPaymentAccountId?: string;
      customerPaymentAccountName?: string;
    },
    userStudioId?: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'PENDING' || order.dispatchType !== 'POOL' || order.companionId) {
      throw new ForbiddenException('该订单当前不可认领');
    }
    if (userStudioId) {
      const visibleIds = await this.bridgeService.getInboundSharedStudioIds(userStudioId, 'ORDERS');
      if (!visibleIds.includes(order.studioId)) throw new ForbiddenException('无权认领其他工作室的订单');
    }

    const result = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        status: 'PENDING',
        dispatchType: 'POOL',
        companionId: null,
        claimedCsUserId: null,
      },
      data: {
        status: 'CLAIMED',
        claimedCsUserId: csUserId,
        claimedAt: new Date(),
        csWorkWechatId: dto.workWechatId || null,
        csWorkWechatName: dto.workWechatName || null,
        customerPaidTo: dto.customerPaidTo || null,
        customerPaymentAccountId: dto.customerPaymentAccountId || null,
        customerPaymentAccountName: dto.customerPaymentAccountName || null,
      },
    });
    if (result.count === 0) throw new ForbiddenException('订单已被他人认领或状态已变更');

    const updated = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
        claimedCsUser: { select: { id: true, username: true, displayName: true, avatar: true } },
        customer: { select: { wechatId: true, customerCode: true, platform: true } },
      },
    });
    if (!updated) throw new NotFoundException('订单不存在');
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async releaseClaim(orderId: string, csUserId: string, userStudioId: string | undefined, role: string | undefined, urgency?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'CLAIMED') throw new ForbiddenException('该订单当前不是客服认领状态');
    if (role === 'CS' && order.claimedCsUserId !== csUserId) {
      throw new ForbiddenException('只能放回自己认领的订单');
    }
    if (userStudioId) {
      const visibleIds = await this.bridgeService.getInboundSharedStudioIds(userStudioId, 'ORDERS');
      if (!visibleIds.includes(order.studioId)) throw new ForbiddenException('无权操作其他工作室的订单');
    }

    const existingFields = (order.customFields as Record<string, unknown>) || {};
    const result = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'CLAIMED' },
      data: {
        status: 'PENDING',
        dispatchType: 'POOL',
        customFields: { ...existingFields, urgency: urgency || 'now' } as any,
      },
    });
    if (result.count === 0) throw new ForbiddenException('订单状态已变更');

    const updated = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
        claimedCsUser: { select: { id: true, username: true, displayName: true, avatar: true } },
        customer: { select: { wechatId: true, customerCode: true, platform: true } },
      },
    });
    if (!updated) throw new NotFoundException('订单不存在');
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async confirm(orderId: string, companionId: string) {
    return this.workflowService.confirm(orderId, companionId);
  }

  async complete(orderId: string, userStudioId?: string, companionId?: string, role?: string) {
    return this.workflowService.complete(orderId, undefined, userStudioId, companionId, role);
  }

  async cancel(orderId: string, userStudioId?: string, companionId?: string, role?: string, reason?: string) {
    return this.workflowService.cancel(orderId, userStudioId, companionId, role, reason);
  }

  async markRefund(orderId: string, companionId?: string, reason?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new ForbiddenException('订单不存在');
    if (companionId && order.companionId !== companionId) throw new ForbiddenException('只能操作自己的订单');

    // 已完成过的订单在退款时回冲累计流水与客户总消费，避免财务虚高
    if (order.status === 'DONE') {
      await this.reverseOrderRevenue(order);
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        refundedAt: new Date(),
        refundReason: reason || null,
        notes: order.notes ? `${order.notes}\n[退款] ${reason || ''}` : `[退款] ${reason || ''}`,
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

  async markDeposit(orderId: string, companionId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new ForbiddenException('订单不存在');
    if (companionId && order.companionId !== companionId) throw new ForbiddenException('只能操作自己的订单');
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'DEPOSITED',
        depositedAt: new Date(),
        depositAmount: order.amount,
        notes: order.notes ? `${order.notes}\n[存单]` : '[存单]',
      },
    });
    if (order.customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: order.customerId }, select: { notes: true } });
      await this.prisma.customer.update({
        where: { id: order.customerId },
        data: {
          notes: customer?.notes
            ? `${customer.notes}\n[存单 ¥${order.amount || 0}]`
            : `[存单 ¥${order.amount || 0}]`,
        },
      });
    }
    if (order.companionId) {
      await this.prisma.companion
        .update({ where: { id: order.companionId }, data: { status: 'AVAILABLE' } })
        .catch(() => {});
      await this.wsGateway.refreshCompanionBlacklist(order.companionId).catch(() => {});
    }
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', updated);
    return updated;
  }

  /**
   * 单价低于底线 → 推一条 `review:alert`（老板 2026-10-04）：
   * 主陪价、副陪单价（副陪总价 / 时长）任意一边低于底线就提醒，副陪填 0 也算 ——
   * 老板要拿这个去重点盯「主陪 + 搭档」这 2 个人。
   * 底线分两档（老板 2026-10-04）：「机密续单/复购 40-60 是正常的，绝密续单/复购 60-80 是正常的」——
   * **首单** 机密 35 / 绝密 45，**续单 / 复购** 机密 40 / 绝密 60。
   * 店长 / 客服走工作室广播；**老板没有工作室、不在工作室房间里，必须单独通知**，否则收不到。
   */
  private async alertBelowFloorPrice(order: any, session: any, info: any): Promise<void> {
    if (!order?.studioId) return;
    const mode = resolvePriceMode(info?.claimedMode ?? session?.claimedMode, order?.customFields);
    const isRenewal = isRenewalSegment(order?.type, session?.seq);
    const floor = priceStatsFloor(mode, isRenewal);
    const partnerUnit = partnerUnitPriceYuan(info?.coAmount, info?.duration);
    const mainBelow = isBelowPriceFloor(mode, info?.claimedPrice, isRenewal);
    const partnerBelow = !!session?.coCompanionId && isBelowPriceFloor(mode, partnerUnit, isRenewal);
    if (!mainBelow && !partnerBelow) return;
    const ids = [session.companionId, session.coCompanionId].filter(Boolean) as string[];
    const companions = ids.length
      ? await this.prisma.companion
          .findMany({
            where: { id: { in: ids } },
            select: { id: true, user: { select: { username: true, displayName: true } } },
          })
          .catch(() => [] as any[])
      : [];
    const nameOf = (id: string) => {
      const c = companions.find((x: any) => x.id === id);
      return c?.user?.displayName || c?.user?.username || '未知';
    };
    const who = session.coCompanionId
      ? `${nameOf(session.companionId)} + ${nameOf(session.coCompanionId)}`
      : nameOf(session.companionId);
    const customerLabel =
      (order.customFields as any)?.customerWechat || order.orderCode || order.customerId || '';
    const parts: string[] = [];
    if (mainBelow) parts.push(`主陪价 ${info.claimedPrice} 元/小时`);
    if (partnerBelow) parts.push(`副陪单价 ${Math.round((partnerUnit as number) * 100) / 100} 元/小时`);
    const payload = {
      sessionId: session.id,
      orderId: order.id,
      companionId: session.companionId,
      companionName: who,
      level: 'yellow',
      reason: `单价低于底线：${mode}${isRenewal ? '续单 / 复购' : '首单'}（底线 ${floor}），${parts.join('、')}，客户 ${customerLabel}`,
      timestamp: new Date().toISOString(),
    };
    this.wsGateway.broadcastToStudio(order.studioId, 'review:alert', payload);
    const owners = await this.prisma.user
      .findMany({ where: { role: 'OWNER' }, select: { id: true } })
      .catch(() => [] as Array<{ id: string }>);
    for (const u of owners) this.wsGateway.notifyUser(u.id, 'review:alert', payload);
  }

  /** 回冲一笔已完成订单已累计的流水与总消费 */
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

  /**
   * 抢单池状态（老板 2026-09-20 起：只返回「每日立即打名额」，不再有流水门槛）。
   */
  async getPoolStatus(companionId: string) {
    const quota = await this.quota.status(companionId);
    // 没绑工作微信 = 抢不了单（老板 2026-10-02 方案 B）：这里把绑定状态一并下发，让订单池提前提醒。
    const boundWechat = companionId
      ? await this.prisma.workWechat
          .findUnique({ where: { companionId }, select: { wechatId: true } })
          .catch(() => null)
      : null;
    const workWechatId = String(boundWechat?.wechatId || '').trim();
    return {
      tier: quota.tier,
      dailyLimit: quota.dailyLimit,
      balance: quota.balance,
      usedToday: quota.usedToday,
      remaining: quota.remaining,
      todayGranted: (quota as any).todayGranted ?? 0,
      days: (quota as any).days ?? [],
      recentLogs: (quota as any).recentLogs ?? [],
      hasWorkWechat: !!workWechatId,
      workWechatId,
    };
  }

  async countPendingContact(studioId: string) {
    if (!studioId) {
      // 老板（无工作室）看全部待联系订单
      return this.prisma.order.count({
        where: {
          contactStatus: 'not_accepted',
          status: { not: 'CANCELLED' },
        },
      });
    }
    const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
    const studioIds = [studioId, ...bridgedIds];
    return this.prisma.order.count({
      where: {
        studioId: { in: studioIds },
        contactStatus: 'not_accepted',
        status: { not: 'CANCELLED' },
      },
    });
  }

  async findOne(orderId: string, user?: any) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
        companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } },
        coCompanion: { include: { user: { select: { username: true } } } },
        // 转让留痕（老板 2026-10-03「400 订单转给王甲振，怎么没看到转让记录」）：
        // findAll 一直带着 transfers，详情这里却漏了 —— 从「订单详情」按 id 取回来的单
        // 看不到「谁什么时候转给谁」。补齐，口径与 findAll 完全一致。
        transfers: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            createdAt: true,
            reason: true,
            fromCompanion: { select: { id: true, user: { select: { id: true, username: true, displayName: true } } } },
            toCompanion: { select: { id: true, user: { select: { id: true, username: true, displayName: true } } } },
          },
        },
      },
    });
    if (!order) return null;
    if (user) {
      if (user.role === 'COMPANION') {
        const involved = order.companionId === user.companionId || order.coCompanionId === user.companionId;
        if (!involved) throw new ForbiddenException('无权查看该订单');
      } else if ((user.role === 'CS' || user.role === 'ADMIN') && order.studioId !== user.studioId) {
        throw new ForbiddenException('无权查看该订单');
      }
    }
    return maskCustomerWechat(order, user);
  }

  // ── Session management ──

  async getSessions(orderId: string) {
    return this.prisma.orderSession.findMany({
      where: { parentOrderId: orderId },
      orderBy: { seq: 'asc' },
      include: {
        companion: { include: { user: { select: { username: true, displayName: true } } } },
        coCompanion: { include: { user: { select: { username: true, displayName: true } } } },
      },
    });
  }

  /**
   * 谁能给这张单加一段服务（首单 / 续单 / 换主陪）——防止陪玩拿别人的订单编号直接续单、抢客户：
   *   · 这张单现在的主陪 / 副陪本人；
   *   · 这张单历史上任何一段会话里当过主陪 / 副陪的人（接手继续打）；
   *   · 这个客户在自己名下的（客户归属人）；
   *   · 以前服务过这个客户（DONE 单当过主陪 / 副陪）。
   * 其余一律拒。
   */
  private async canActOnOrder(
    order: { id: string; companionId: string | null; coCompanionId: string | null; customerId: string | null },
    companionId: string,
  ): Promise<boolean> {
    if (order.companionId === companionId || order.coCompanionId === companionId) return true;
    const sessionHit = await this.prisma.orderSession
      .count({
        where: { parentOrderId: order.id, OR: [{ companionId }, { coCompanionId: companionId }] },
      })
      .catch(() => 0);
    if (sessionHit > 0) return true;
    if (!order.customerId) return false;
    const customer = await this.prisma.customer
      .findUnique({ where: { id: order.customerId }, select: { companionId: true } })
      .catch(() => null);
    if (customer?.companionId === companionId) return true;
    const served = await this.prisma.order
      .count({
        where: {
          customerId: order.customerId,
          status: 'DONE',
          OR: [{ companionId }, { coCompanionId: companionId }],
        },
      })
      .catch(() => 0);
    return served > 0;
  }

  async addSession(
    orderId: string,
    dto: {
      companionId: string;
      coCompanionId?: string;
      amount: number;
      coAmount?: number;
      duration?: number;
      claimedMode?: string;
      claimedPrice?: number;
      transferScreenshotUrl?: string;
      useDeposit?: boolean;
      /** 发起这次加段的陪玩（控制器从登录态取，别信前端 body.companionId） */
      actorCompanionId?: string;
    },
  ) {
    const sessions = await this.prisma.orderSession.findMany({
      where: { parentOrderId: orderId },
      orderBy: { seq: 'desc' },
      take: 1,
    });
    const last = sessions[0];
    const seq = (last?.seq || 0) + 1;
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    // 老板 2026-10-04：「陪玩去客户 B 的位置点续单」——加一段服务之前先确认**这张单 / 这个客户是你的**。
    // 以前只检查了「要换的主陪属不属于同店」，没检查发起人，拿到别人的订单编号就能直接续单抢客户。
    const actorId = dto.actorCompanionId;
    if (order && actorId && !(await this.canActOnOrder(order, actorId))) {
      throw new ForbiddenException('这不是你的订单 / 客户，不能续单；请让客服或店长处理');
    }
    // 换主陪：主陪必须属于同一工作室或已桥接工作室
    if (dto.companionId) {
      const target = await this.prisma.companion.findUnique({
        where: { id: dto.companionId },
        select: { studioId: true },
      }).catch(() => null);
      if (!target || !order) {
        throw new ForbiddenException('订单或主陪不存在');
      }
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(order.studioId || '');
      if (target.studioId !== order.studioId && !bridgedIds.includes(target.studioId)) {
        throw new ForbiddenException('主陪必须属于同一工作室');
      }
    }
    // 记录续单前仍在计时的会话，用于通知被换掉的旧陪玩并释放其状态
    const previousActive = await this.prisma.orderSession.findMany({
      where: { parentOrderId: orderId, status: 'ACTIVE', startedAt: { not: null } },
      select: { id: true, companionId: true, coCompanionId: true, amount: true, coAmount: true, startedAt: true, totalPausedSec: true },
    });
    // 续单场景：自动结束上一个仍在计时的会话（首单/上一段续单）
    for (const prev of previousActive) {
      const started = prev.startedAt ? new Date(prev.startedAt).getTime() : Date.now();
      const activeSec = Math.max(0, (Date.now() - started) / 1000 - (prev.totalPausedSec || 0));
      const actualHours = Number((activeSec / 3600).toFixed(1));
      await this.prisma.orderSession.update({
        where: { id: prev.id },
        data: { status: 'DONE', endedAt: new Date(), duration: actualHours || 0.1 },
      });
    }
    const session = await this.prisma.orderSession.create({
      data: {
        parentOrderId: orderId,
        seq,
        companionId: dto.companionId,
        coCompanionId: dto.coCompanionId || order?.coCompanionId || last?.coCompanionId || null,
        amount: dto.amount,
        coAmount: dto.coAmount ?? last?.coAmount ?? (order?.coAmount ?? null),
        duration: dto.duration || 1,
        claimedMode: dto.claimedMode ?? null,
        claimedPrice: dto.claimedPrice ?? null,
        transferScreenshotUrl: dto.transferScreenshotUrl ?? null,
        paidByDeposit: dto.useDeposit === true,
        status: 'ACTIVE',
      },
    });

    // 单价低于底线（首单 机密 35 / 绝密 45，续单 / 复购 机密 40 / 绝密 60）：**只提醒、不拦单**，并告诉老板是谁在主陪+搭档一起填低价。
    // 主陪价和副陪单价都看（副陪那段总价 / 时长，填 0 也算），方法内部自己判断要不要推。
    void this
      .alertBelowFloorPrice(order, session, {
        claimedMode: session?.claimedMode,
        claimedPrice: session?.claimedPrice,
        coAmount: session?.coAmount,
        duration: session?.duration,
      })
      .catch(() => null);
    // Notify coCompanion if set
    if (order && session.coCompanionId) {
      const inviter = await this.prisma.companion.findUnique({
        where: { id: session.companionId || '' },
        select: { user: { select: { displayName: true, username: true } } },
      }).catch(() => null);
      const inviterName = inviter?.user?.displayName || inviter?.user?.username || '';
      this.wsGateway.pushOrder(session.coCompanionId, {
        ...session,
        gameName: order.gameName,
        customerId: order.customerId,
        orderId,
        type: 'DUAL_INVITE',
        inviterName,
        expiresInSec: PARTNER_INVITE_TTL_SEC,
      });
      this.schedulePartnerInviteExpiry(session.id, order.studioId || '');
    }

    // 通知被续单换掉的旧陪玩：这一段已结束 + 本段计入流水，并释放其状态
    const newMemberIds = new Set([dto.companionId, session.coCompanionId].filter(Boolean) as string[]);
    for (const prev of previousActive) {
      const replaced = [
        { id: prev.companionId, amount: prev.amount },
        { id: prev.coCompanionId, amount: prev.coAmount ?? prev.amount },
      ].filter((x) => x.id && !newMemberIds.has(x.id as string));
      for (const r of replaced) {
        const companion = await this.prisma.companion
          .findUnique({
            where: { id: r.id as string },
            select: { user: { select: { displayName: true, username: true } } },
          })
          .catch(() => null);
        const name = companion?.user?.displayName || companion?.user?.username || '陪玩';
        this.wsGateway.pushToCompanion(r.id as string, 'order:segment_finished', {
          sessionId: prev.id,
          orderId,
          gameName: order?.gameName || '',
          amount: r.amount ?? 0,
          message: `${name}，你这一段服务已结束，本段计入流水 ¥${Number(r.amount || 0).toFixed(1)}`,
        });
        // 被换掉的旧陪玩：无条件放回空闲
        await this.prisma.companion.update({ where: { id: r.id as string }, data: { status: 'AVAILABLE' } }).catch(() => {});
        await this.wsGateway.refreshCompanionBlacklist(r.id as string).catch(() => {});
        this.wsGateway.broadcastToBridgedStudios(order?.studioId || '', 'status:broadcast', {
          companionId: r.id,
          status: 'AVAILABLE',
        });
      }
    }

    this.wsGateway.broadcastToStudio(order?.studioId || '', 'order:pool_updated', session);
    return session;
  }

  /**
   * 服务端自己把陪玩切到「接单中」时，必须同步推一次黑名单（老板 2026-10-03）。
   *
   * 「接单中」只能由服务端自动进入（开始服务 / 接受搭档邀请），陪玩本人点不出来
   * —— ws.gateway 收到手动 BUSY 直接丢弃。所以客户端根本不知道自己的状态变了：
   * 它会一直停在「空闲」，把「空闲才杀」的那条黑名单继续挂着。徐泽宁接受搭档邀请后
   * 人已经算接单中，客户端却还在杀他刚启动的三角洲，看起来就是「接受了邀请，
   * 却一直不让启动游戏」。
   *
   * 顺序不能反：先落库、再推 —— pushCurrentBlacklist 是照库里的状态组黑名单的。
   */
  private async markCompanionsBusy(ids: Array<string | null | undefined>) {
    for (const id of Array.from(new Set(ids.filter(Boolean) as string[]))) {
      await this.prisma.companion.update({ where: { id }, data: { status: 'BUSY' } }).catch(() => {});
      await this.wsGateway.refreshCompanionBlacklist(id).catch(() => {});
    }
  }

  /** 搭档接受双陪邀请：确认后开始计时，并通知主陪 */
  async acceptPartnerInvite(sessionId: string, partnerId: string) {
    const session = await this.prisma.orderSession.findUnique({
      where: { id: sessionId },
      include: { parentOrder: { select: { id: true, companionId: true, gameName: true, studioId: true } } },
    });
    if (!session) throw new NotFoundException('会话不存在');
    // 允许指定搭档或广播找搭档：未指定搭档时，第一个接受者成为搭档
    if (session.companionId === partnerId) throw new ForbiddenException('不能接受自己的搭档邀请');
    if (session.coCompanionId && session.coCompanionId !== partnerId) throw new ForbiddenException('无权接受此搭档邀请');
    if (session.startedAt) throw new ForbiddenException('该服务已开始');
    // 20 秒未接受则视为过期，防止定时器因服务重启失效后仍能接受过期邀请
    const ageSec = (Date.now() - new Date(session.createdAt).getTime()) / 1000;
    if (ageSec > PARTNER_INVITE_TTL_SEC) {
      // 过期只把「待搭档」撤掉，不结束整段会话：主陪随时能单人开打、也能重新邀请，
      // 别因为搭档没看到就把整张单作废（老板 2026-10-03）。
      await this.prisma.orderSession.update({
        where: { id: sessionId },
        data: { coCompanionId: null },
      }).catch(() => {});
      throw new ForbiddenException('该搭档邀请已过期');
    }

    await this.prisma.order.update({
      where: { id: session.parentOrderId },
      data: {
        coCompanionId: session.coCompanionId || partnerId,
        // 搭档金额也落回订单级：管理端（订单管理 / 看板 / 报表）读的是订单上的 coAmount，
        // 以前「续单 / 客户管理开始首单」这条路只在会话上有，订单级是空的。
        ...(session.coAmount != null ? { coAmount: session.coAmount } : {}),
      },
    }).catch(() => {});

    await this.prisma.order.updateMany({
      where: { id: session.parentOrderId, status: 'GRABBED' },
      data: { status: 'CONFIRMED' },
    }).catch(() => {});

    // 客户归属在「开始服务（打了首单）」时才绑定到主陪。
    if (session.companionId) {
      const parentOrder = await this.prisma.order
        .findUnique({ where: { id: session.parentOrderId }, select: { customerId: true } })
        .catch(() => null);
      if (parentOrder?.customerId) {
        await this.prisma.customer
          .updateMany({ where: { id: parentOrder.customerId }, data: { companionId: session.companionId } })
          .catch(() => {});
      }
    }

    await this.prisma.orderSession.update({
      where: { id: sessionId },
      data: { startedAt: new Date(), coCompanionId: session.coCompanionId || partnerId },
    });

    await this.markCompanionsBusy([session.companionId]);
    // 搭档若在娱乐中接单：先结束娱乐计费并返回本次消费金额。
    let entertainmentFee: number | null = null;
    const partner = await this.prisma.companion.findUnique({
      where: { id: partnerId },
      select: { status: true, studioId: true },
    }).catch(() => null);
    if (partner?.status === 'ENTERTAINMENT') {
      const openLog = await this.prisma.companionTimeLog.findFirst({
        where: { companionId: partnerId, mode: 'ENTERTAINMENT', endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (openLog) {
        const elapsed = Math.max(0, Math.round((Date.now() - new Date(openLog.startedAt).getTime()) / 1000));
        // 娱乐费统一口径（当日流水达标免单），避免和看板/工作台算法不一致
        const { hourlyRate, freeThreshold } = await loadEntertainmentRule(this.prisma, partner?.studioId);
        const { start: entDayStart, end: entDayEnd } = currentBusinessDayRange();
        const entDayRevenue = await this.prisma.order
          .aggregate({
            where: {
              companionId: partnerId,
              status: 'DONE',
              createdAt: { gte: entDayStart, lt: entDayEnd },
            },
            _sum: { amount: true },
          })
          .catch(() => null);
        entertainmentFee = computeEntertainmentFee({
          minutes: elapsed / 60,
          todayRevenue: entDayRevenue?._sum?.amount || 0,
          hourlyRate,
          freeThreshold,
        });
        await this.prisma.companionTimeLog.update({
          where: { id: openLog.id },
          data: { endedAt: new Date(), durationSeconds: elapsed },
        });
      }
    }
    await this.markCompanionsBusy([partnerId]);

    if (session.companionId) {
      this.wsGateway.pushToCompanion(session.companionId, 'order:partner_accepted', {
        sessionId,
        orderId: session.parentOrderId,
        gameName: session.parentOrder?.gameName || '',
        partnerId,
      });
    }
    this.wsGateway.broadcastToStudio(session.parentOrder?.studioId || '', 'order:pool_updated', { id: sessionId });
    return { ok: true, entertainmentFee };
  }

  /** 搭档拒绝双陪邀请：结束该待接受会话，并通知主陪「搭档已拒绝」。 */
  async rejectPartnerInvite(sessionId: string, partnerId: string) {
    const session = await this.prisma.orderSession.findUnique({
      where: { id: sessionId },
      select: { id: true, companionId: true, coCompanionId: true, status: true, startedAt: true, parentOrderId: true },
    });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.startedAt) throw new ForbiddenException('该服务已开始');
    if (session.coCompanionId && session.coCompanionId !== partnerId) throw new ForbiddenException('无权拒绝此搭档邀请');

    await this.prisma.orderSession.update({
      where: { id: sessionId },
      data: { status: 'DONE', endedAt: new Date() },
    }).catch(() => {});

    if (session.companionId) {
      const partner = await this.prisma.companion.findUnique({
        where: { id: partnerId },
        select: { user: { select: { username: true, displayName: true } } },
      }).catch(() => null);
      const partnerName = partner?.user?.displayName || partner?.user?.username || '搭档';
      this.wsGateway.pushToCompanion(session.companionId, 'order:partner_rejected', {
        sessionId,
        orderId: session.parentOrderId,
        partnerName,
      });
    }
    return { ok: true };
  }

  /** 广播找搭档：把双陪会话邀请广播给工作室，任意陪玩可接受 */
  async broadcastPartnerInvite(sessionId: string) {
    const session = await this.prisma.orderSession.findUnique({
      where: { id: sessionId },
      include: { parentOrder: { select: { studioId: true, gameName: true } } },
    });
    if (!session) throw new NotFoundException('会话不存在');
    const inviter = await this.prisma.companion.findUnique({
      where: { id: session.companionId || '' },
      select: { user: { select: { displayName: true, username: true } } },
    }).catch(() => null);
    const inviterName = inviter?.user?.displayName || inviter?.user?.username || '';
    this.wsGateway.broadcastToStudio(session.parentOrder?.studioId || '', 'order:dual_invite', {
      sessionId,
      orderId: session.parentOrderId,
      companionId: session.companionId,
      gameName: session.parentOrder?.gameName || '',
      amount: session.amount,
      duration: session.duration,
      type: 'DUAL_INVITE',
      coCompanionId: null,
      inviterName,
      expiresInSec: PARTNER_INVITE_TTL_SEC,
    });
    this.schedulePartnerInviteExpiry(sessionId, session.parentOrder?.studioId || '');
    return { ok: true };
  }

  /**
   * 搭档邀请到点还没人接受：**只撤掉「待搭档」，不结束会话、不结束订单**（老板 2026-10-03）。
   *
   * 以前超时会把会话标 `DONE`、把 DIRECT 订单也标 `DONE` —— 「被邀请方打的这个订单找不到」
   * 有一大半就是这么来的：陪玩在游戏里没看到横幅（或就差几秒），邀请超时，整段会话作废，
   * 主陪只好重新开始一单，被邀请方记录里什么都没有，两边对不上账。
   * 现在：清掉会话上的搭档、推一条「搭档未回应」，会话保持 ACTIVE —— 主陪可以
   * 直接单人开打，也可以再邀请一次（`addSession` / `broadcastPartnerInvite` 都能重来）。
   */
  private schedulePartnerInviteExpiry(sessionId: string, studioId: string) {
    setTimeout(async () => {
      try {
        const s = await this.prisma.orderSession.findUnique({
          where: { id: sessionId },
          select: { id: true, status: true, startedAt: true, parentOrderId: true, companionId: true },
        });
        if (!s || s.status !== 'ACTIVE' || s.startedAt) return;
        await this.prisma.orderSession.update({
          where: { id: sessionId },
          data: { coCompanionId: null },
        });
        this.wsGateway.broadcastToStudio(studioId, 'order:dual_invite_expired', {
          sessionId,
          orderId: s.parentOrderId,
        });
        // 通知主陪：搭档未回应（超时）——你可以直接开始，或再邀请一次。
        if (s.companionId) {
          this.wsGateway.pushToCompanion(s.companionId, 'order:partner_timeout', {
            sessionId,
            orderId: s.parentOrderId,
          });
        }
        this.wsGateway.broadcastToStudio(studioId, 'order:pool_updated', { id: sessionId, expired: true });
      } catch (e) {
        logger.error('partner invite expiry failed', { error: (e as Error).message, sessionId });
      }
    }, PARTNER_INVITE_TTL_SEC * 1000);
  }

  private async getOwnedSession(id: string, companionId?: string) {
    const s = await this.prisma.orderSession.findUnique({
      where: { id },
      select: {
        id: true,
        companionId: true,
        coCompanionId: true,
        status: true,
        pausedAt: true,
        totalPausedSec: true,
        startedAt: true,
        parentOrderId: true,
      },
    });
    if (!s) throw new NotFoundException('会话不存在');
    if (companionId && s.companionId !== companionId) throw new ForbiddenException('只能操作自己的会话');
    return s;
  }

  async startSession(
    id: string,
    companionId?: string,
    claims?: { claimedMode?: string; claimedPrice?: number; transferScreenshotUrl?: string; duration?: number; useDeposit?: boolean },
  ) {
    const own = await this.prisma.orderSession.findUnique({
      where: { id },
      select: { id: true, companionId: true, parentOrderId: true, claimedPrice: true, coAmount: true, duration: true, seq: true },
    });
    if (!own) throw new NotFoundException('会话不存在');
    const isHandoff = !!(companionId && own.companionId && own.companionId !== companionId);
    if (isHandoff) {
      // 换主陪：允许同工作室的陪玩代为启动该会话
      const [caller, main] = await Promise.all([
        this.prisma.companion.findUnique({ where: { id: companionId! }, select: { studioId: true } }).catch(() => null),
        this.prisma.companion.findUnique({ where: { id: own.companionId! }, select: { studioId: true } }).catch(() => null),
      ]);
      if (!caller || !main || caller.studioId !== main.studioId) {
        throw new ForbiddenException('只能操作自己的会话');
      }
    }
    const data: any = { startedAt: new Date() };
    // 复购单陪这条路只在 startSession 填价（addSession 那条路已经提醒过），
    // 用「这段会话还没记过单价」当幂等条件，避免同一次填价弹两遍。
    let belowFloorNew = false;
    if (claims) {
      if (!claims.claimedMode) throw new BadRequestException('请填写游戏模式');
      if (claims.claimedPrice == null || !Number.isFinite(claims.claimedPrice) || claims.claimedPrice <= 0) throw new BadRequestException('请填写有效单价');
      if (claims.duration == null || !Number.isFinite(claims.duration) || claims.duration <= 0) throw new BadRequestException('请填写有效时长');
      data.claimedMode = claims.claimedMode;
      data.claimedPrice = claims.claimedPrice;
      data.transferScreenshotUrl = claims.transferScreenshotUrl;
      data.duration = claims.duration;
      data.paidByDeposit = claims.useDeposit === true;
      if (own.claimedPrice == null) {
        // 判底线前先看这张单是首单还是续单 / 复购（单子类型 + 这一段是第几段）
        const parentMeta = await this.prisma.order
          .findUnique({ where: { id: own.parentOrderId }, select: { type: true } })
          .catch(() => null);
        const isRenewal = isRenewalSegment(parentMeta?.type, own.seq);
        belowFloorNew =
          isBelowPriceFloor(claims.claimedMode, claims.claimedPrice, isRenewal) ||
          isBelowPriceFloor(claims.claimedMode, partnerUnitPriceYuan(own.coAmount, claims.duration), isRenewal);
      }
    }
    const updated = await this.prisma.orderSession.update({ where: { id }, data });

    const s = await this.prisma.orderSession.findUnique({
      where: { id },
      select: { parentOrderId: true, companionId: true, coCompanionId: true, seq: true },
    });
    if (s) {
      await this.prisma.order.updateMany({
        where: { id: s.parentOrderId, status: 'GRABBED' },
        data: { status: 'CONFIRMED' },
      }).catch(() => {});
      // 客户归属在「开始服务（打了首单）」时才绑定，抢单/指定阶段不绑。
      if (s.companionId) {
        const parentOrder = await this.prisma.order
          .findUnique({ where: { id: s.parentOrderId }, select: { customerId: true } })
          .catch(() => null);
        if (parentOrder?.customerId) {
          await this.prisma.customer
            .updateMany({ where: { id: parentOrder.customerId }, data: { companionId: s.companionId } })
            .catch(() => {});
        }
      }
      await this.markCompanionsBusy([s.companionId, s.coCompanionId]);
      // 单价低于底线（首单 机密 35 / 绝密 45，续单 / 复购 机密 40 / 绝密 60）：提醒老板 / 店长，不拦单。
      if (belowFloorNew && claims) {
        const parent = await this.prisma.order
          .findUnique({
            where: { id: s.parentOrderId },
            select: { id: true, studioId: true, customFields: true, orderCode: true, customerId: true, type: true },
          })
          .catch(() => null);
        if (parent) {
          void this
            .alertBelowFloorPrice(
              parent,
              { id, companionId: s.companionId, coCompanionId: s.coCompanionId, seq: s.seq },
              {
                claimedMode: claims.claimedMode,
                claimedPrice: claims.claimedPrice,
                coAmount: own.coAmount,
                duration: claims.duration,
              },
            )
            .catch(() => null);
        }
      }
      if (isHandoff && s.companionId) {
        this.wsGateway.pushToCompanion(s.companionId, 'order:service_handoff', {
          sessionId: id,
          orderId: s.parentOrderId,
        });
      }
    }
    return updated;
  }
  async pauseSession(id: string, companionId?: string) {
    const s = await this.getOwnedSession(id, companionId);
    if (s.status !== 'ACTIVE' || !s.startedAt) throw new ForbiddenException('只有进行中的服务才能暂停');
    if (s.pausedAt) throw new ForbiddenException('服务已处于暂停状态');
    return this.prisma.orderSession.update({ where: { id }, data: { pausedAt: new Date() } });
  }
  async resumeSession(id: string, companionId?: string) {
    const s = await this.getOwnedSession(id, companionId);
    if (s.status !== 'ACTIVE') throw new ForbiddenException('只有进行中的服务才能继续');
    if (s.pausedAt) {
      const sec = Math.floor((Date.now() - new Date(s.pausedAt).getTime()) / 1000);
      return this.prisma.orderSession.update({
        where: { id },
        data: { pausedAt: null, totalPausedSec: (s.totalPausedSec || 0) + sec },
      });
    }
    return s;
  }
  async endSession(id: string, companionId?: string) {
    const s = await this.getOwnedSession(id, companionId);
    const data: any = { endedAt: new Date(), status: 'DONE' };
    if (s.pausedAt) {
      const sec = Math.floor((Date.now() - new Date(s.pausedAt).getTime()) / 1000);
      data.pausedAt = null;
      data.totalPausedSec = (s.totalPausedSec || 0) + sec;
    }
    if (s.startedAt) {
      const activeSec = Math.max(0, (Date.now() - new Date(s.startedAt).getTime()) / 1000 - (data.totalPausedSec ?? s.totalPausedSec ?? 0));
      data.duration = Number((activeSec / 3600).toFixed(1)) || 0.1;
    }
    const updated = await this.prisma.orderSession.update({ where: { id }, data });
    await this.releaseCompanionsAfterSession(s);
    return updated;
  }

  /**
   * 会话结束后把主陪 / 副陪放回空闲，并广播给同工作室（客服端人员列表不用等轮询）。
   */
  private async releaseCompanionsAfterSession(s: {
    id: string;
    companionId?: string | null;
    coCompanionId?: string | null;
    parentOrderId?: string | null;
  }): Promise<void> {
    const ids = [s.companionId, s.coCompanionId].filter(Boolean) as string[];
    if (!ids.length) return;
    const studioId = s.parentOrderId
      ? (
          await this.prisma.order
            .findUnique({ where: { id: s.parentOrderId }, select: { studioId: true } })
            .catch(() => null)
        )?.studioId
      : null;
    for (const companionId of ids) {
      const released = await releaseCompanionIfIdle(this.prisma, companionId, s.id);
      if (released && studioId) {
        try {
          this.wsGateway.broadcastToStudio(studioId, 'status:broadcast', {
            companionId,
            status: 'AVAILABLE',
          });
        } catch {
          /* 广播失败不影响结束服务本身 */
        }
      }
    }
  }

  async updatePayment(
    orderId: string,
    dto: {
      paymentAccountId?: string;
      companionFeeStatus?: string;
      companionFeeMethod?: string;
      companionFeeAccount?: string;
      companionFeeAmount?: number;
      customerPaidTo?: string;
      customerPaymentAccountId?: string;
      customerPaymentAccountName?: string;
    },
    user: any,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error('订单不存在');
    if (user.role === 'CS' && order.csUserId !== user.id && order.claimedCsUserId !== user.id) {
      throw new Error('只能更新自己发布或认领的订单');
    }

    const data: any = {};
    if (dto.paymentAccountId !== undefined) data.paymentAccountId = dto.paymentAccountId || null;
    if (dto.companionFeeStatus !== undefined) data.companionFeeStatus = dto.companionFeeStatus;
    if (dto.companionFeeMethod !== undefined) data.companionFeeMethod = dto.companionFeeMethod;
    if (dto.companionFeeAccount !== undefined) data.companionFeeAccount = dto.companionFeeAccount;
    if (dto.companionFeeAmount !== undefined) data.companionFeeAmount = dto.companionFeeAmount;
    if (dto.customerPaidTo !== undefined) data.customerPaidTo = dto.customerPaidTo || null;
    if (dto.customerPaymentAccountId !== undefined) data.customerPaymentAccountId = dto.customerPaymentAccountId || null;
    if (dto.customerPaymentAccountName !== undefined) data.customerPaymentAccountName = dto.customerPaymentAccountName || null;
    return this.prisma.order.update({ where: { id: orderId }, data });
  }
}
