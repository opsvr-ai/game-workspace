// craftsman-ignore: TS001,TS003
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { OrderWorkflowService } from './order-workflow.service';
import { OrderDispatchService } from './order-dispatch.service';
import { currentBusinessDayRange } from '../common/business-day';
import { ExcellenceService } from '../companions/excellence.service';
import { roundToJiao } from '../common/money';
import { logger } from '../common/logger';
import { maskCustomerWechat } from '../common/order-privacy';

const PARTNER_INVITE_TTL_SEC = 15;

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
    private bridgeService: BridgeService,
    private readonly workflowService: OrderWorkflowService,
    private readonly dispatchService: OrderDispatchService,
    private readonly excellence: ExcellenceService,
  ) {}

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
        status: dto.dispatchType === 'DIRECT' && dto.companionId ? 'CONFIRMED' : 'PENDING',
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
          dispatchCount: 1,
          firstDispatchedAt: new Date().toISOString(),
          dispatchHistory: [{ at: new Date().toISOString(), action: 'DISPATCH' }],
        },
        paymentAccountId: (dto as any).paymentAccountId || null,
      },
      include: { customer: true },
    });

    // BROADCAST: send to ALL idle companions
    if (dto.dispatchType === 'BROADCAST' && studioId) {
      const csUser = await this.prisma.user.findUnique({
        where: { id: dto.csUserId },
        select: { username: true, role: true },
      });
      this.wsGateway.broadcastToIdleCompanions(studioId, 'order:urgent', {
        ...newOrder,
        _createdBy: csUser?.username || '未知',
        _creatorRole: csUser?.role || 'CS',
        _broadcast: true,
      });
    }

    // Urgent orders: broadcast to all IDLE companions (first-come-first-served)
    const isUrgent = (dto as any).urgency === 'now';
    if (studioId && isUrgent) {
      const csUser = await this.prisma.user.findUnique({
        where: { id: dto.csUserId },
        select: { username: true, role: true },
      });
      const bridgeWindowCfg = await this.prisma.systemConfig.findUnique({
        where: { key: 'dispatch.bridge_immediate_window_sec' },
      });
      const bridgeWindowSec = Number(bridgeWindowCfg?.value ?? 60);
      const payload = {
        ...newOrder,
        _createdBy: csUser?.username || '未知',
        _creatorRole: csUser?.role || 'CS',
      };
      const sent = await this.wsGateway.broadcastToQualifiedIdleCompanions(studioId, 'order:urgent', payload);
      if (sent === 0) {
        // 2. 桥接线下（DIRECT）空闲
        const bridgeDirectSent = await this.wsGateway.broadcastToBridgedIdleCompanionsByType(
          studioId,
          'DIRECT',
          'order:urgent',
          payload,
        );
        const fallbackToLocalAndOnline = async () => {
          const stillPending = await this.prisma.order.findFirst({
            where: { id: newOrder.id, status: 'PENDING' },
            select: { id: true },
          });
          if (!stillPending) return;
          // 3. 线下中等马/下等马空闲
          const localSent = await this.wsGateway.broadcastToIdleCompanions(studioId, 'order:urgent', payload);
          if (localSent === 0) {
            // 4. 线上俱乐部（RENTAL）空闲
            await this.wsGateway.broadcastToBridgedIdleCompanionsByType(
              studioId,
              'RENTAL',
              'order:urgent',
              payload,
            );
          }
        };
        if (bridgeDirectSent === 0) {
          await fallbackToLocalAndOnline();
        } else {
          // 桥接线下限时内未接，则回落到线下中等马/下等马 → 线上俱乐部
          setTimeout(() => {
            void fallbackToLocalAndOnline();
          }, bridgeWindowSec * 1000);
        }
      }
    }

    // DIRECT: 指定给某个陪玩，右下角弹窗提醒他
    if (dto.dispatchType === 'DIRECT' && dto.companionId) {
      const csUser = await this.prisma.user.findUnique({
        where: { id: dto.csUserId },
        select: { username: true, role: true },
      });
      this.wsGateway.notifyCompanion(dto.companionId, 'order:urgent', {
        ...newOrder,
        _createdBy: csUser?.username || '未知',
        _creatorRole: csUser?.role || 'CS',
        _direct: true,
      });
    }

    // Auto-create first session when order is created
    if (newOrder.companionId) {
      if (newOrder.dispatchType === 'DIRECT' && !newOrder.coCompanionId) {
        await this.prisma.companion
          .update({ where: { id: newOrder.companionId }, data: { status: 'BUSY' } })
          .catch(() => {});
      }
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

    const [priorityCfg, bridgeCfg, middleCfg, lowCfg, onlineCfg, studio] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'pool.priority_delay_seconds' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'pool.bridge_delay_seconds' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'pool.middle_delay_seconds' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'pool.low_delay_seconds' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'pool.online_delay_seconds' } }),
      studioId
        ? this.prisma.studio.findUnique({ where: { id: studioId }, select: { type: true } })
        : null,
    ]);
    const priorityDelay = Number(priorityCfg?.value ?? 0) * 1000;
    const bridgeDelay = Number(bridgeCfg?.value ?? 30) * 1000;
    const middleDelay = Number(middleCfg?.value ?? 60) * 1000;
    const lowDelay = Number(lowCfg?.value ?? 120) * 1000;
    const onlineDelay = Number(onlineCfg?.value ?? 180) * 1000;
    const studioType = studio?.type ?? 'DIRECT';

    // 当前陪玩的段位（只对自家工作室订单生效）
    let tier = 'LOW';
    if (companionId) {
      const ex = await this.excellence.computeOne(companionId);
      tier = ex?.tier || 'LOW';
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        customer: { select: { wechatId: true, customerCode: true, platform: true } },
        csUser: { select: { username: true, avatar: true, displayName: true, role: true } },
        studio: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // 已过消失时间、标记为待客服处理的订单不再出现在抢单池；
    // 按「上等马 → 桥接 → 中等马 → 下等马 → 线上」分别延迟可见。
    const now = Date.now();
    const isCompanion = !!companionId;
    return orders.filter((o) => {
      if ((o.customFields as any)?.poolExpired) return false;
      let delay: number;
      if (!studioId) {
        delay = 0; // 老板（无工作室）看全部订单，立即可见
      } else if (studioType === 'RENTAL') {
        delay = onlineDelay;
      } else if (o.studioId !== studioId) {
        delay = bridgeDelay; // 桥接工作室订单
      } else {
        // 管理端/客服没有陪玩身份，不应受段位可见延迟影响，自己发的单立即可见
        delay = !isCompanion
          ? 0
          : tier === 'TOP' ? priorityDelay : tier === 'MIDDLE' ? middleDelay : lowDelay;
      }
      return now - new Date(o.createdAt).getTime() >= delay;
    });
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
    const disappearCfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'pool.immediate_disappear_minutes' },
    });
    const disappearSeconds = Number(disappearCfg?.value ?? 10) * 60;
    const where: any = { studioId, status: 'PENDING', dispatchType: 'POOL' };
    // 客服只看自己发布的待处理单，店长/老板看全工作室
    if (user && user.role === 'CS') where.csUserId = user.id;
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
          const isScheduled = cf.urgency === 'later';
          const waitingSeconds = Math.max(0, Math.floor((now - o.createdAt.getTime()) / 1000));
          const poolExpired = !!cf.poolExpired;
          const availableCompanions =
            !isScheduled && waitingSeconds >= 300
              ? await this.getSoonEndingCompanions(studioId)
              : [];
          return {
            ...o,
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
            customFields: cf,
            availableCompanions,
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
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
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

  async redispatch(orderId: string, studioId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'PENDING' || order.dispatchType !== 'POOL') {
      throw new ForbiddenException('该订单当前不可重新派单');
    }
    if (studioId && order.studioId !== studioId) {
      throw new ForbiddenException('无权操作其他工作室的订单');
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

  async markPoolHandled(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
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
    const where: any = { companionId: { not: null } };
    if (studioId) where.studioId = studioId;
    if (user && user.role === 'CS') where.csUserId = user.id;
    const bridgeCfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'pool.bridge_return_jueju_cents' },
    });
    const juejuCents = Number(bridgeCfg?.value ?? 1500);

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

  // 客服每个工作微信的余额 = 流入(客户转入) - 流出(转给陪玩/桥接等)
  async listCsWechatBalances(studioId: string) {
    const wechats = await this.prisma.workWechat.findMany({
      where: { studioId, type: 'STUDIO' },
    });
    const orders = await this.prisma.order.findMany({
      where: { studioId },
      select: { customFields: true, moneyFlows: true },
    });

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
      return {
        id: w.id,
        wechatId: w.wechatId,
        csUserId: w.csUserId,
        inTotal,
        outTotal,
        balance: inTotal - outTotal,
      };
    });
  }

  async listMoneyReconciliation(studioId: string) {
    const [orders, bridgeCfg] = await Promise.all([
      this.prisma.order.findMany({
        where: { studioId },
        include: {
          moneyFlows: true,
          customer: { select: { wechatId: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.systemConfig.findUnique({ where: { key: 'pool.bridge_return_jueju_cents' } }),
    ]);
    const juejuCents = Number(bridgeCfg?.value ?? 1500);

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
      const visibleIds = await this.bridgeService.getVisibleStudioIds(userStudioId);
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
      const visibleIds = await this.bridgeService.getVisibleStudioIds(userStudioId);
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

  async getPoolStatus(companionId: string) {
    const { start: today, end: tomorrow } = currentBusinessDayRange();

    const todayOrders = await this.prisma.order.findMany({
      where: {
        companionId,
        status: 'DONE',
        createdAt: { gte: today, lt: tomorrow },
      },
    });
    const todayRevenue = todayOrders.reduce((s, o) => s + o.amount, 0);

    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'revenue.unlock_threshold' },
    });
    const threshold = (config?.value as number) ?? 100;

    // 今日剩余新客抢单名额（按段位，失败单不占名额）
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { studioId: true },
    });
    const ex = await this.excellence.computeOne(companionId);
    const tier = ex?.tier || 'LOW';
    const limitKey = tier === 'TOP'
      ? 'dispatch.top_tier_daily_new_limit'
      : tier === 'MIDDLE'
        ? 'dispatch.middle_tier_daily_new_limit'
        : 'dispatch.low_tier_daily_new_limit';
    const limitCfg = await this.prisma.systemConfig.findUnique({ where: { key: limitKey } });
    const limit = Number(limitCfg?.value ?? (tier === 'TOP' ? 999 : tier === 'MIDDLE' ? 2 : 1));
    const used = await this.prisma.order.count({
      where: {
        companionId,
        type: 'NEW',
        status: { in: ['GRABBED', 'CONFIRMED', 'DONE'] },
        contactStatus: { not: 'not_accepted' },
        grabbedAt: { gte: today },
        ...(companion?.studioId ? { studioId: companion.studioId } : {}),
      },
    });

    return {
      todayRevenue: roundToJiao(todayRevenue),
      threshold,
      isUnlocked: todayRevenue >= threshold,
      newQuota: {
        tier,
        limit,
        used,
        remaining: Math.max(0, limit - used),
      },
    };
  }

  async countPendingContact(studioId: string) {
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
    // 换主陪：主陪必须属于同一工作室
    if (dto.companionId) {
      const target = await this.prisma.companion.findUnique({
        where: { id: dto.companionId },
        select: { studioId: true },
      }).catch(() => null);
      if (!target || target.studioId !== order?.studioId) {
        throw new ForbiddenException('主陪必须属于同一工作室');
      }
    }
    // 记录续单前仍在计时的会话，用于通知被换掉的旧陪玩并释放其状态
    const previousActive = await this.prisma.orderSession.findMany({
      where: { parentOrderId: orderId, status: 'ACTIVE', startedAt: { not: null } },
      select: { id: true, companionId: true, coCompanionId: true, amount: true, coAmount: true },
    });
    // 续单场景：自动结束上一个仍在计时的会话（首单/上一段续单）
    await this.prisma.orderSession.updateMany({
      where: { parentOrderId: orderId, status: 'ACTIVE', startedAt: { not: null } },
      data: { status: 'DONE', endedAt: new Date() },
    });
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
      select: { status: true },
    }).catch(() => null);
    if (partner?.status === 'ENTERTAINMENT') {
      const openLog = await this.prisma.companionTimeLog.findFirst({
        where: { companionId: partnerId, mode: 'ENTERTAINMENT', endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (openLog) {
        const elapsed = Math.max(0, Math.round((Date.now() - new Date(openLog.startedAt).getTime()) / 1000));
        const rateCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'entertainment.hourly_rate' } });
        const hourlyRate = Number(rateCfg?.value ?? 60);
        entertainmentFee = roundToJiao(Math.floor(elapsed / 60) * (hourlyRate / 60));
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
      select: { id: true, companionId: true, pausedAt: true, totalPausedSec: true },
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
      if (!claims.useDeposit && !claims.transferScreenshotUrl) throw new BadRequestException('请上传客户转账截图');
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
    await this.getOwnedSession(id, companionId);
    return this.prisma.orderSession.update({ where: { id }, data: { pausedAt: new Date() } });
  }
  async resumeSession(id: string, companionId?: string) {
    const s = await this.getOwnedSession(id, companionId);
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
    const updated = await this.prisma.orderSession.update({ where: { id }, data });
    return updated;
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
