// craftsman-ignore: TS001,TS003
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { OrderSessionService } from './order-session.service';
import { stripPoolCustomerContact } from '../common/order-privacy';
import { resolveConfigsRaw } from '../common/studio-config';
import { DIRECT_ALERT_SECONDS } from './direct-assignment-reminder.service';
import { resolvePriceMode } from '../common/price-rules';
import { PoolScope } from '@chunlv/shared';
import { normalizePoolScope } from '../common/order-outcome';
import { DEFAULT_BRIDGE_DELAY_SECONDS, PARTNER_INVITE_TTL_SEC } from './order.constants';

/**
 * 订单创建：号段生成 / 客户与参单校验 / 入池与派单 / 搭档会话初始化 / 发布推送。
 *
 * 从 OrdersService 拆出，方法体原样搬运，行为与拆分前一致。
 */
@Injectable()
export class OrderCreateService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
    private orderSession: OrderSessionService,
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
    /** 代打：客户/订单仍归主陪，实际服务人只拿金额和时长，不抢客户 KPI。 */
    proxyMode?: boolean;
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
    // 陪玩手上已经有一张 GRABBED / CONFIRMED 的单时，不允许再新建第二张。
    // 2026-10-27 张权：1800 还没开始服务，客户端又建出 1801，订单管理看起来像凭空发布一单。
    if (creator?.role === 'COMPANION' && !dto.proxyMode) {
      const me = await this.prisma.companion
        .findUnique({ where: { userId: dto.csUserId }, select: { id: true } })
        .catch(() => null);
      if (me) {
        const pending = await this.prisma.order.findFirst({
          where: {
            status: { in: ['GRABBED', 'CONFIRMED'] },
            OR: [{ companionId: me.id }, { coCompanionId: me.id }],
          },
          select: { id: true, orderCode: true, createdAt: true, updatedAt: true },
        });
        if (pending) {
          // 老数据里存在「抢了但从来没开始、也没有任何会话」的僵尸单（徐建业 1090，
          // 2026-10-13 抢的，7 天没动）。这种单不该拦住新首单，先自动作废。
          const activeSession = await this.prisma.orderSession.findFirst({
            where: { parentOrderId: pending.id, status: 'ACTIVE' },
            select: { id: true },
          }).catch(() => null);
          const staleMs = Date.now() - new Date(pending.updatedAt || pending.createdAt).getTime();
          if (!activeSession && staleMs > 24 * 60 * 60 * 1000) {
            await this.prisma.order.update({
              where: { id: pending.id },
              data: {
                status: 'CANCELLED',
                notes: `超过 24 小时未开始且无服务记录，系统自动作废（原单号 ${pending.orderCode || ''}）`,
              },
            }).catch(() => {});
          } else {
            throw new BadRequestException(
              `你手上还有订单 ${pending.orderCode || ''} 没结束，先处理完再建新单`,
            );
          }
        }
      }
    }
    // 老板 2026-10-23：陪玩正在服务 A 时，不能再开 B/C 的续单 / 复购；
    // 否则他一边挂 A 的长会话，一边给 10 个客户各开 1 小时复购，复购率直接刷到 100%。
    if (creator?.role === 'COMPANION' && (dto.type === 'RENEW' || dto.type === 'REPURCHASE') && !dto.proxyMode) {
      const me = await this.prisma.companion
        .findUnique({ where: { userId: dto.csUserId }, select: { id: true } })
        .catch(() => null);
      if (me) {
        const active = await this.prisma.orderSession.findFirst({
          where: {
            status: 'ACTIVE',
            startedAt: { not: null },
            OR: [{ companionId: me.id }, { coCompanionId: me.id }],
          },
          select: { id: true, parentOrder: { select: { orderCode: true } } },
        });
        if (active) {
          throw new BadRequestException(
            `你正在服务订单 ${active.parentOrder?.orderCode || ''}，先结束当前服务再开续单 / 复购`,
          );
        }
      }
    }
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

    // Resolve customerId: create a placeholder if not provided.
    // 陪玩无客户ID时先校验，别先建一条空客户档案再拒绝（老板 2026-10-22）。
    if (creator?.role === 'COMPANION' && !dto.customerId) {
      const roomOnly = (dto as any).roomCodeOnly === true;
      if (roomOnly) {
        if (!String((dto as any).customerRoomCode || '').trim()) {
          throw new BadRequestException('房间码单必须填写房间码');
        }
      } else if (!String(dto.customerWechat || '').trim()) {
        throw new BadRequestException('陪玩发布的订单必须填写客户微信（房间码单除外）');
      }
    }
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

    // 老板 2026-10-22：陪玩自己创建客户必须有微信；陪玩发布的订单不能是空客户。
    // 放在老客归属校验之后，先报「不是你的客户」，再报资料缺失。房间码单是明确例外。
    if (creator?.role === 'COMPANION') {
      const roomOnly = (dto as any).roomCodeOnly === true;
      const roomCode = String((dto as any).customerRoomCode || '').trim();
      if (roomOnly) {
        if (!roomCode) throw new BadRequestException('房间码单必须填写房间码');
      } else {
        const customerFields = [
          dto.customerWechat,
          (dto as any).customerNickname,
          (dto as any).customerAccountId,
          (dto as any).customerPlatformAccount,
          (dto as any).customerYy,
          (dto as any).customerGameId,
          (dto as any).customerRoomCode,
        ].map((v) => String(v ?? '').trim()).filter(Boolean);
        if (dto.customerId) {
          const existing = await this.prisma.customer
            .findUnique({
              where: { id: dto.customerId },
              select: { wechatId: true, platform: true, platformAccount: true, notes: true },
            })
            .catch(() => null);
          const existingInfo = [
            existing?.wechatId,
            existing?.platform,
            existing?.platformAccount,
            existing?.notes,
          ].some((v) => String(v ?? '').trim());
          if (!existingInfo && customerFields.length === 0) {
            throw new BadRequestException('客户没有微信/客户资料，不能发布订单；请先补全客户资料');
          }
        } else if (!String(dto.customerWechat || '').trim()) {
          throw new BadRequestException('陪玩发布的订单必须填写客户微信（房间码单除外）');
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
          customerRoomCode: String(dto.customerRoomCode || '')
            .replace(/^\s*房间码\s*[:：]?\s*/i, '')
            .trim() || undefined,
          customerGameId: (dto as any).customerGameId,
          // 房间码单标记：客户信息只有房间码，方便列表 / 详情区分「还没补微信」的单。
          roomCodeOnly: (dto as any).roomCodeOnly === true ? true : undefined,
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
          // 代打：订单客户/主陪仍是原主陪；副陪只拿 coAmount，不拿客户 KPI。
          proxyMode: dto.proxyMode === true ? true : undefined,
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
          orderId: newOrder.id,
          type: 'DUAL_INVITE',
          proxyMode: (newOrder.customFields as any)?.proxyMode === true,
          inviterName,
          expiresInSec: PARTNER_INVITE_TTL_SEC,
        });
        this.orderSession.schedulePartnerInviteExpiry(session.id, newOrder.studioId || '');
      }

      // 双陪续单 / 复购：这条路不经过 addSession / startSession，单价没人检查 ——
      // 在会话建出来的这一刻按「续单 / 复购」的底线提醒一次（徐泽宁那对复购填 35 就是这么漏的）。
      // 单陪的交给 startSession 填价那一步提醒，这里只管有搭档、别处不会触发的。
      if (session?.coCompanionId && (newOrder.type === 'REPURCHASE' || newOrder.type === 'RENEW')) {
        void this.orderSession
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

  /** 弹窗停留时长（秒）：设置里没填就 15。 */
  async getPopupSeconds(studioId: string | null): Promise<number> {
    const cfg = await resolveConfigsRaw(this.prisma, studioId, ['pool.popup_seconds']).catch(
      () => ({}) as Record<string, unknown>,
    );
    const raw = Number((cfg as Record<string, unknown>)['pool.popup_seconds']);
    return Number.isFinite(raw) && raw > 0 ? raw : 15;
  }
}
