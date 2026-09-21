// craftsman-ignore: TS001,TS003
import { Injectable, NotFoundException, ForbiddenException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { OrderWorkflowService } from './order-workflow.service';
import { OrderDispatchService } from './order-dispatch.service';
import { CompanionQuotaService } from './companion-quota.service';
import { ExcellenceService } from '../companions/excellence.service';
import { logger } from '../common/logger';
import { maskCustomerWechat } from '../common/order-privacy';
import { releaseCompanionIfIdle } from '../common/companion-presence';
import { computeEntertainmentFee, loadEntertainmentRule } from '../common/entertainment-fee';
import { currentBusinessDayRange } from '../common/business-day';
import { resolveConfigsRaw } from '../common/studio-config';

const PARTNER_INVITE_TTL_SEC = 60;

/** 「桥接工作室等待」默认值（秒）：库里没配置时用它。 */
const DEFAULT_BRIDGE_DELAY_SECONDS = 30;

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
    }, 30 * 1000);
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

    // 弹窗只服务「广播」和「指定」两种方式：入池订单只进抢单池，不弹窗。
    const isUrgent = (dto as any).urgency === 'now';
    const popupCreator = await this.prisma.user.findUnique({
      where: { id: dto.csUserId },
      select: { username: true, role: true },
    });
    // 弹窗停留时长（设置里可配，默认 20 秒）随单下发，
    // 让网页里的卡片和陪玩端置顶小窗用同一个数（老板 2026-09-22 要求弹窗别一闪而过）。
    const popupCfg = await resolveConfigsRaw(this.prisma, studioId ?? null, [
      'pool.popup_seconds',
    ]).catch(() => ({}) as Record<string, unknown>);
    const popupSecondsRaw = Number((popupCfg as Record<string, unknown>)['pool.popup_seconds']);
    const popupSeconds = Number.isFinite(popupSecondsRaw) && popupSecondsRaw > 0 ? popupSecondsRaw : 20;
    const popupPayload = {
      ...newOrder,
      _createdBy: popupCreator?.username || '未知',
      _creatorRole: popupCreator?.role || 'CS',
      _popupSeconds: popupSeconds,
    };

    // BROADCAST: 右下角弹窗给本店在线陪玩（接单中/娱乐中默认不打扰，可自行打开）
    if (dto.dispatchType === 'BROADCAST' && studioId) {
      await this.wsGateway.broadcastNewOrder(studioId, {
        ...popupPayload,
        _broadcast: true,
      });
      // 桥接工作室那边也弹一次，但要等「桥接工作室等待」到了才弹，
      // 保证本店陪玩仍然先有这段先手；不等它跑完，先把响应返回去。
      void this.wsGateway.broadcastUrgentToBridgedStudios(
        studioId,
        newOrder.id,
        { ...popupPayload, _broadcast: true, _bridged: true },
        await this.getBridgeDelayMs(studioId),
      );
    }

    // DIRECT: 指定给某个陪玩，右下角弹窗提醒他
    if (dto.dispatchType === 'DIRECT' && dto.companionId) {
      this.wsGateway.notifyCompanion(dto.companionId, 'order:urgent', {
        ...popupPayload,
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
    }

    if (studioId && newOrder.dispatchType === 'POOL') {
      if (isUrgent) {
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
      if (isUrgent) {
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
      OR: companionId ? [{ companionId: null }, { companionId: companionId }] : [{ companionId: null }],
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
      let delay: number;
      if (!studioId) {
        delay = 0; // 老板（无工作室）看全部订单，立即可见
      } else if (studioType === 'RENTAL') {
        delay = onlineDelay;
      } else if (o.studioId !== studioId) {
        delay = bridgeDelay; // 桥接工作室订单
      } else if (cf.broadcast === true) {
        // 客服按「广播」发的急单：自家工作室所有人立即可见，不再排段位，
        // 避免错过 15 秒弹窗的人还要再等 60/120 秒。
        delay = 0;
      } else {
        // 管理端/客服没有陪玩身份，不应受段位可见延迟影响，自己发的单立即可见
        delay = !isCompanion
          ? 0
          : tier === 'TOP' ? priorityDelay : tier === 'MIDDLE' ? middleDelay : lowDelay;
      }
      return now - new Date(o.createdAt).getTime() >= delay;
    });

    // 老板 2026-09-21：订单池里只看得到「还没被抢走」的单，陪玩一忙、一看视频就以为
    // 工作室没单，其实是被人抢走了。现在把今天（营业日 12:00 起）已经被抢的单也一起
    // 返回，前端灰掉显示，让大家看得到「今天发过这些单」。
    // 只对陪玩端（有 companionId）返回；管理端/客服在「全部订单」里本来就看得见。
    if (!companionId) return available;

    const taken = await this.findTakenPoolOrders(companionId, studioId);
    return [...available, ...taken];
  }

  /**
   * 今天（营业日 12:00 起）已经被抢走 / 已在服务的订单池订单 —— 陪玩端的灰色记录。
   * 刻意不带客户微信号、来源账号、二维码：只是让陪玩看到「今天有这些单、被谁抢了」，
   * 别人的客户信息一条都不给。
   */
  private async findTakenPoolOrders(companionId: string, studioId?: string) {
    const { start } = currentBusinessDayRange();
    const where: any = {
      dispatchType: 'POOL',
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
        type: true,
        status: true,
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

  async findAll(user: any, status?: string) {
    const where: any = {};
    if (status) where.status = status;
    // Role-based filtering (showAll only bypasses for OWNER — security fix C4)
    if (user.role === 'COMPANION') {
      where.OR = [
        { companionId: user.companionId },
        { coCompanionId: user.companionId },
      ];
      if (!status) where.NOT = { status: 'PENDING', dispatchType: 'POOL' };
    } else if (user.role === 'CS') {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(user.studioId);
      where.studioId = { in: [user.studioId, ...bridgedIds] };
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
            studio: { select: { id: true, name: true } },
          },
        },
        coCompanion: { include: { user: { select: { username: true } } } },
        sessions: {
          orderBy: { seq: 'desc' },
          take: 1,
          select: { id: true, startedAt: true, endedAt: true, duration: true, totalPausedSec: true, seq: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    // 隐私：非发布者看不到来源账号；副陪（搭档）看不到主陪的客户微信。
    return orders.map((o) => {
      const masked = maskCustomerWechat(o, user);
      const cf = masked.customFields as any;
      if (o.csUserId !== user.id && cf?.customerSourceAccount) {
        return { ...masked, customFields: { ...cf, customerSourceAccount: '***' } };
      }
      return masked;
    });
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
      orderBy: { createdAt: 'asc' },
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

    // 已消失（待客服处理）的订单排最前
    return list.sort((a, b) => Number(b.poolExpired) - Number(a.poolExpired));
  }

  async markCsContact(
    orderId: string,
    status: string,
    evidenceUrl?: string,
    extra?: { workWechatId?: string; workWechatName?: string; addResult?: string },
    user?: { id: string; role: string },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (user?.role === 'CS' && order.csUserId !== user.id) {
      throw new ForbiddenException('只能处理自己发布的订单');
    }
    const cf = (order.customFields as any) || {};
    const result = extra?.addResult;
    const contactStatus = result === 'passed' ? 'added' : result === 'failed' ? 'not_accepted' : 'pending';
    const poolHandled = status === 'added';
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        contactStatus,
        customFields: {
          ...cf,
          csContactAt: new Date().toISOString(),
          csContactEvidenceUrl: evidenceUrl || '',
          ...(extra?.workWechatId !== undefined ? { csWorkWechatId: extra.workWechatId } : {}),
          ...(extra?.workWechatName !== undefined ? { csWorkWechatName: extra.workWechatName } : {}),
          ...(result === 'passed' ? { csCultivated: true } : {}),
          ...(status === 'added' ? { poolHandled } : {}),
        },
      },
    });
  }

  async redispatch(orderId: string, studioId?: string, user?: { id: string; role: string }) {
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
        customer: true,
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
    return orders.filter((o) => {
      return o.contactStatus === 'pending' || o.contactStatus === 'added' || o.contactStatus === 'not_accepted';
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
    return {
      tier: quota.tier,
      dailyLimit: quota.dailyLimit,
      balance: quota.balance,
      usedToday: quota.usedToday,
      remaining: quota.remaining,
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
      await this.prisma.orderSession.update({
        where: { id: sessionId },
        data: { status: 'DONE', endedAt: new Date() },
      }).catch(() => {});
      throw new ForbiddenException('该搭档邀请已过期');
    }

    await this.prisma.order.update({
      where: { id: session.parentOrderId },
      data: { coCompanionId: session.coCompanionId || partnerId },
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

    if (session.companionId) {
      await this.prisma.companion.update({ where: { id: session.companionId }, data: { status: 'BUSY' } }).catch(() => {});
    }
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
    await this.prisma.companion.update({ where: { id: partnerId }, data: { status: 'BUSY' } }).catch(() => {});

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

  /** 20 秒内未接受搭档邀请则自动取消该待接受会话 */
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
          data: { status: 'DONE', endedAt: new Date() },
        });
        // 复购/直接派单的双陪邀请超时未接受：把订单也结束，避免卡在「进行中」
        await this.prisma.order.updateMany({
          where: {
            id: s.parentOrderId,
            status: 'CONFIRMED',
            dispatchType: 'DIRECT',
            sessions: { none: { status: 'ACTIVE' } },
          },
          data: { status: 'DONE' },
        }).catch(() => {});
        this.wsGateway.broadcastToStudio(studioId, 'order:dual_invite_expired', {
          sessionId,
          orderId: s.parentOrderId,
        });
        // 通知主陪：搭档未回应（超时）。
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
      select: { id: true, companionId: true, parentOrderId: true },
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
    if (claims) {
      if (!claims.claimedMode) throw new BadRequestException('请填写游戏模式');
      if (claims.claimedPrice == null || !Number.isFinite(claims.claimedPrice) || claims.claimedPrice <= 0) throw new BadRequestException('请填写有效单价');
      if (claims.duration == null || !Number.isFinite(claims.duration) || claims.duration <= 0) throw new BadRequestException('请填写有效时长');
      data.claimedMode = claims.claimedMode;
      data.claimedPrice = claims.claimedPrice;
      data.transferScreenshotUrl = claims.transferScreenshotUrl;
      data.duration = claims.duration;
      data.paidByDeposit = claims.useDeposit === true;
    }
    const updated = await this.prisma.orderSession.update({ where: { id }, data });

    const s = await this.prisma.orderSession.findUnique({
      where: { id },
      select: { parentOrderId: true, companionId: true, coCompanionId: true },
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
      if (s.companionId) {
        await this.prisma.companion.update({ where: { id: s.companionId }, data: { status: 'BUSY' } }).catch(() => {});
      }
      if (s.coCompanionId) {
        await this.prisma.companion.update({ where: { id: s.coCompanionId }, data: { status: 'BUSY' } }).catch(() => {});
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
