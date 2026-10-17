// craftsman-ignore: TS001,TS003
import { Injectable, NotFoundException, ForbiddenException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { OrderWorkflowService } from './order-workflow.service';
import { OrderDispatchService } from './order-dispatch.service';
import { CsFinanceService } from './cs-finance.service';
import { OrderQueryService } from './order-query.service';
import { OrderExceptionService } from './order-exception.service';
import { OrderSessionService } from './order-session.service';
import { OrderTransferService } from './order-transfer.service';
import { CompanionQuotaService } from './companion-quota.service';
import { ExcellenceService } from '../companions/excellence.service';
import { logger } from '../common/logger';
import { maskCustomerWechat, stripPoolCustomerContact } from '../common/order-privacy';
import { switchCompanionStatus } from '../common/companion-status-switch';
import { resolveConfigsRaw } from '../common/studio-config';
import { DIRECT_ALERT_SECONDS } from './direct-assignment-reminder.service';
import { resolvePriceMode } from '../common/price-rules';
import { PoolScope } from '@chunlv/shared';
import { normalizePoolScope } from '../common/order-outcome';
import {
  DEFAULT_BRIDGE_DELAY_SECONDS,
  PARTNER_INVITE_TTL_SEC,
  SUPPLEMENT_TYPE,
} from './order.constants';

@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly csFinance: CsFinanceService;
  private readonly orderQuery: OrderQueryService;
  private readonly orderException: OrderExceptionService;
  private readonly orderSession: OrderSessionService;
  private readonly orderTransfer: OrderTransferService;

  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
    private bridgeService: BridgeService,
    private readonly workflowService: OrderWorkflowService,
    private readonly dispatchService: OrderDispatchService,
    excellence: ExcellenceService,
    quota: CompanionQuotaService,
    // CS 微信收款 / 资金流水 / 对账子域（Nest 注入）。
    // 参数写成可选只是为了不破坏现有单测里的 `new OrdersService(...)`；这里按同样的依赖补一个实例，
    // 门面就不需要 `!` 非空断言 —— 生产环境漏注册 provider 时 Nest 会直接启动失败，而不是等接口调用才炸。
    csFinance?: CsFinanceService,
    orderTransfer?: OrderTransferService,
    orderSession?: OrderSessionService,
    orderException?: OrderExceptionService,
    orderQuery?: OrderQueryService,
  ) {
    this.csFinance = csFinance ?? new CsFinanceService(prisma, wsGateway);
    this.orderQuery = orderQuery ?? new OrderQueryService(prisma, bridgeService, excellence, quota);
    this.orderException = orderException ?? new OrderExceptionService(prisma, wsGateway, bridgeService, quota);
    this.orderSession = orderSession ?? new OrderSessionService(prisma, wsGateway, bridgeService);
    this.orderTransfer = orderTransfer ?? new OrderTransferService(prisma, wsGateway);
  }

  onModuleInit(): void {
    // 服务重启后，setTimeout 会丢失；这里定时兜底清理过期未接受的搭档邀请，
    // 避免客户管理里一直显示“等待搭档接受/取消邀请”。
    setInterval(() => {
      void this.orderSession.cleanupExpiredPartnerInvites();
      // 同一根因：转让申请是「发起方落库 + 等对方同意」，服务重启也会丢通知，
      // 挂久了界面上就一直有个没人认的申请，一起清。
      void this.orderTransfer.cleanupExpiredTransferRequests();
    }, 30 * 1000);
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
        this.orderSession.schedulePartnerInviteExpiry(session.id, newOrder.studioId || '');
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
    return this.orderQuery.findPool(companionId, studioId);
  }

  async dispatchSummary(user: any) {
    return this.orderQuery.dispatchSummary(user);
  }

  async findAll(user: any, status?: string, scope?: string) {
    return this.orderQuery.findAll(user, status, scope);
  }

  async grab(orderId: string, companionId: string) {
    return this.workflowService.grab(orderId, companionId);
  }

  async findPendingStart(companionId: string) {
    return this.orderQuery.findPendingStart(companionId);
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
  /**
   * 「进游戏对接」——房间码单专用（老板 2026-10-11）。
   *
   * 老板原话：「刚刚胡程硕抢了一个订单，是个游戏的房间码，房间码的话不进游戏对接不了，
   * 进了游戏才能对接，这怎么办？」查实：本店「空闲」状态的黑名单里挂着三角洲
   * （CompanionStatusBlacklist：AVAILABLE → DeltaForceClient-Win64-Shipping）—— 他抢完单
   * 还是「空闲」，一开游戏就被看门狗杀掉，根本进不去房间。而「接单中」只有点「开始首单」
   * （开始计时）时才会自动切，可开始计时的前提又是先点「添加成功」…… 房间码单压根没有
   * 微信可加，于是整条流程卡死。
   *
   * 这条路**只办一件事**：把他切成「接单中」—— 空闲黑名单不再生效，游戏不会被杀，
   * 他才能进房间对接客户。
   *
   * **2026-10-17 改口径（老板：「进去之后客户不喜欢怎么办？也添加成功？」）**：
   * 以前这里顺手把 contactStatus 写成 `added`（等于替他点了「添加成功」）—— 那是错的：
   * 客户人还没见着、微信都还没要，就算「添加成功」，客户立刻进他的「客户管理」，
   * 「首单成功率」的分母也跟着虚高。现在**一个字都不碰 contactStatus**：
   *   - 客户同意加微信 → 他自己点「✅ 添加成功」（客户这时候才进他的「客户管理」，
   *     客户归属也在这时候落到他名下，跟 updateContact 的 'added' 分支同一个口径）；
   *   - 客户不喜欢 / 没给微信 → 他点「❌ 添加失败」，走跟别的单一样的补单审核。
   * 这里只记 customFields.roomJoinedAt，给界面区分「还没进去 / 已经进去过」。
   */
  async joinRoom(orderId: string, user: any) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        studioId: true,
        companionId: true,
        customerId: true,
        customFields: true,
        customer: { select: { id: true, companionId: true } },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'GRABBED' && order.status !== 'CONFIRMED') {
      throw new ForbiddenException('只能对已抢单 / 已确认的订单做「进游戏对接」');
    }
    if (user?.role === 'COMPANION' && order.companionId !== user.companionId) {
      throw new ForbiddenException('这不是你的订单');
    }
    const cf = (order.customFields as any) || {};
    if (!cf.customerRoomCode) {
      throw new BadRequestException('这张单没填房间码，直接用「添加成功」就行');
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      // 只留个记号，不动 contactStatus（见上面 2026-10-17 那段）。
      data: { customFields: { ...cf, roomJoinedAt: new Date().toISOString() } },
      include: { customer: true },
    });
    // 客户归属**不在这里做**：等他真点到「添加成功」时才归他（updateContact 的 'added' 分支），
    // 不然「客户不喜欢」的单也会挂到他名下。
    // 切成「接单中」：空闲黑名单（本店挂着三角洲）立刻撤掉，他才能开着游戏进房间对接。
    if (order.companionId) {
      await switchCompanionStatus(this.prisma, order.companionId, 'BUSY');
      await this.wsGateway.refreshCompanionBlacklist(order.companionId).catch(() => null);
      this.wsGateway.broadcastToBridgedStudios(order.studioId, 'status:broadcast', {
        companionId: order.companionId,
        status: 'BUSY',
        reason: 'room-join',
      });
    }
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', updated);
    return updated;
  }

  /** 陪玩点「添加失败」时建档：同一张单只留一条；被驳回后重新提交会回到待审。 */
  private async upsertSupplementRequest(order: any, body: any): Promise<void> {
    if (!order?.companionId) return;
    const reason = String(body?.failReason || body?.reason || '').trim() || null;
    const evidenceUrl = String(body?.screenshotUrl || body?.evidenceUrl || '').trim() || null;
    const existing = await this.prisma.supplementRequest.findFirst({
      where: { orderId: order.id, type: SUPPLEMENT_TYPE },
    });
    if (existing) {
      // 已经补过的单不再重复开，避免同一张单被反复要名额
      if (existing.status === 'APPROVED') return;
      await this.prisma.supplementRequest.update({
        where: { id: existing.id },
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
        type: SUPPLEMENT_TYPE,
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

  async listSupplements(user: any, scope?: 'pending' | 'due' | 'records' | 'all') {
    return this.orderException.listSupplements(user, scope);
  }

  async supplementSummary(user: any) {
    return this.orderException.supplementSummary(user);
  }

  async decideSupplement(id: string, decision: string, note: string | undefined, user: any) {
    return this.orderException.decideSupplement(id, decision, note, user);
  }

  async supplementOrder(orderId: string, user: any, body: { reason?: string }) {
    return this.orderException.supplementOrder(orderId, user, body);
  }

  async requestRefund(orderId: string, user: any, body: { reason?: string; evidenceUrl?: string }) {
    return this.orderException.requestRefund(orderId, user, body);
  }

  async reviewSupplement(id: string, result: string, user: any) {
    return this.orderException.reviewSupplement(id, result, user);
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

  async recordOutcome(
    orderId: string,
    user: any,
    body: { outcome?: string; reason?: string; note?: string; evidence?: unknown },
  ) {
    return this.orderException.recordOutcome(orderId, user, body);
  }

  async confirmOutcomeWithCs(orderId: string, user: any, body: { note?: string }) {
    return this.orderException.confirmOutcomeWithCs(orderId, user, body);
  }

  async rejectOrderOutcome(orderId: string, user: any, body: { note?: string }) {
    return this.orderException.rejectOrderOutcome(orderId, user, body);
  }

  async reviewOrderOutcome(orderId: string, user: any, body: { responsibility?: string; note?: string }) {
    return this.orderException.reviewOrderOutcome(orderId, user, body);
  }

  async listOrderReviews(
    user: any,
    scope: 'waiting' | 'recheck' | 'archived' | 'decided' = 'waiting',
  ) {
    return this.orderException.listOrderReviews(user, scope);
  }

  async orderReviewSummary(user: any) {
    return this.orderException.orderReviewSummary(user);
  }

  async chaseFeedback(orderId: string, user: any) {
    return this.orderException.chaseFeedback(orderId, user);
  }

  async requestTransfer(
    orderId: string,
    fromCompanionId: string,
    toCompanionId: string,
    reason?: string,
  ) {
    return this.orderTransfer.requestTransfer(orderId, fromCompanionId, toCompanionId, reason);
  }

  async acceptTransferRequest(requestId: string, toCompanionId: string) {
    return this.orderTransfer.acceptTransferRequest(requestId, toCompanionId);
  }

  async rejectTransferRequest(requestId: string, toCompanionId: string, reason?: string) {
    return this.orderTransfer.rejectTransferRequest(requestId, toCompanionId, reason);
  }

  async cancelTransferRequest(requestId: string, fromCompanionId: string) {
    return this.orderTransfer.cancelTransferRequest(requestId, fromCompanionId);
  }

  async listMyTransferRequests(companionId: string) {
    return this.orderTransfer.listMyTransferRequests(companionId);
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
    return this.orderQuery.findUrgent(studioId, user);
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
    return this.csFinance!.listCsFollowup(studioId, user);
  }

  // 客服养好的客户重新派单后，被谁抢走、陪玩用什么微信、最终去了线下/桥接/线上
  async listCsConverted(studioId: string, user?: { id: string; role: string }) {
    return this.csFinance!.listCsConverted(studioId, user);
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
   *  - 应收 = 客户按业绩（单价 × 时长，双陪算两份）；
   *  - 应返还 = 绝密单返还给接单方（默认 15 元/人/小时，双陪 ×2）；机密首单不结、不返还。
   */
  async listEscalatedPoolOrders(studioId: string, opts?: { month?: string; csUserId?: string }) {
    return this.csFinance!.listEscalatedPoolOrders(studioId, opts);
  }

  async listMoneyFlows(orderId: string) {
    return this.csFinance!.listMoneyFlows(orderId);
  }

  async addMoneyFlow(
    orderId: string,
    data: { direction: string; amount: number; counterpart: string; counterpartId?: string; note?: string },
  ) {
    return this.csFinance!.addMoneyFlow(orderId, data);
  }

  // 客服每个工作微信的余额 = 流入(客户转入) - 流出(转给陪玩/桥接等) - 店长转走的余额
  // 客服角色只看自己绑定的工作微信，店长/老板看本工作室全部。
  async listCsWechatBalances(studioId: string, csUserId?: string) {
    return this.csFinance!.listCsWechatBalances(studioId, csUserId);
  }

  // 店长把客服微信里的余额转走，记录一笔清零业绩，让系统余额归零
  async clearCsWechatBalance(studioId: string, workWechatId: string, note?: string) {
    return this.csFinance!.clearCsWechatBalance(studioId, workWechatId, note);
  }

  // 店长转走余额统计：本月 / 今年 / 累计，跨所有客服工作微信
  async getCsWechatBalanceSummary(studioId: string) {
    return this.csFinance!.getCsWechatBalanceSummary(studioId);
  }

  // 客服工作微信收款明细：按微信聚合相关订单的每一笔业绩，并标出问题单。
  async listCsWechatFlow(studioId: string) {
    return this.csFinance!.listCsWechatFlow(studioId);
  }

  // 客服记完业绩后，检查这单账是否还有异常；有异常就提醒负责的客服去修改。
  async checkAndNotifyCsAnomaly(orderId: string) {
    return this.csFinance!.checkAndNotifyCsAnomaly(orderId);
  }

  async listMoneyReconciliation(studioId: string) {
    return this.csFinance!.listMoneyReconciliation(studioId);
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

  async markRefund(orderId: string, companionId?: string, reason?: string, label = '退款') {
    return this.orderException.markRefund(orderId, companionId, reason, label);
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

  private async alertBelowFloorPrice(order: any, session: any, info: any): Promise<void> {
    return this.orderSession.alertBelowFloorPrice(order, session, info);
  }

  async getPoolStatus(companionId: string) {
    return this.orderQuery.getPoolStatus(companionId);
  }

  async countPendingContact(studioId: string) {
    return this.orderQuery.countPendingContact(studioId);
  }

  async findOne(orderId: string, user?: any) {
    return this.orderQuery.findOne(orderId, user);
  }

  async getSessions(orderId: string) {
    return this.orderSession.getSessions(orderId);
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
    return this.orderSession.addSession(orderId, dto);
  }

  async acceptPartnerInvite(sessionId: string, partnerId: string) {
    return this.orderSession.acceptPartnerInvite(sessionId, partnerId);
  }

  async rejectPartnerInvite(sessionId: string, partnerId: string) {
    return this.orderSession.rejectPartnerInvite(sessionId, partnerId);
  }

  async broadcastPartnerInvite(sessionId: string) {
    return this.orderSession.broadcastPartnerInvite(sessionId);
  }

  // 门面委托（单测 orders.addsession-guard.test.ts 会直接调它校验归属判断）。
  async canActOnOrder(
    order: { id: string; companionId: string | null; coCompanionId: string | null; customerId: string | null },
    companionId: string,
  ): Promise<boolean> {
    return this.orderSession.canActOnOrder(order, companionId);
  }

  async startSession(
    id: string,
    companionId?: string,
    claims?: { claimedMode?: string; claimedPrice?: number; transferScreenshotUrl?: string; duration?: number; useDeposit?: boolean },
  ) {
    return this.orderSession.startSession(id, companionId, claims);
  }

  async pauseSession(id: string, companionId?: string) {
    return this.orderSession.pauseSession(id, companionId);
  }

  async resumeSession(id: string, companionId?: string) {
    return this.orderSession.resumeSession(id, companionId);
  }

  async endSession(id: string, companionId?: string) {
    return this.orderSession.endSession(id, companionId);
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
