// craftsman-ignore: TS001
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { canSeeCustomerSource } from '../common/order-privacy';
import type { UserRole } from '@chunlv/shared';

export interface CreateCustomerDto {
  wechatId: string;
  studioId: string;
  companionId?: string;
  isLegacy?: boolean;
  customerCode?: string;
  platform?: string;
  platformAccount?: string;
  consultDate?: string;
  wechatAddDate?: string;
  notes?: string;
}

export interface UpdateCustomerDto {
  wechatId?: string;
  companionId?: string | null;
  platform?: string;
  platformAccount?: string;
  consultDate?: string;
  wechatAddDate?: string;
  isAccountBanned?: boolean;
  isDeletedByCustomer?: boolean;
  notes?: string;
  scheduledAt?: string | null;
}

interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
  studioId: string | null;
  companionId?: string;
}

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
  ) {}

  async findAll(user: AuthenticatedUser, sortBy?: string) {
    const where: any = {};

    if (user.role === 'COMPANION') {
      where.companionId = user.companionId;
      where.isDeletedByCustomer = false;
    } else if (user.role === 'ADMIN' || user.role === 'CS') {
      where.studioId = user.studioId;
    }

    // Sort: totalSpent=消费金额降序, createdAt=创建时间降序, updatedAt=最近更新降序(默认)
    let orderBy: any = { updatedAt: 'desc' };
    if (sortBy === 'totalSpent') {
      orderBy = { totalSpent: 'desc' };
    } else if (sortBy === 'createdAt') {
      orderBy = { createdAt: 'desc' };
    }

    return this.prisma.customer.findMany({
      where,
      include: {
        companion: {
          include: {
            user: { select: { username: true } },
          },
        },
        followUps: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
          orders: {
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true,
              csUserId: true,
              csUser: { select: { username: true, displayName: true, avatar: true } },
              status: true,
              gameName: true,
              type: true,
              amount: true,
              duration: true,
              customFields: true,
              sessions: {
                orderBy: { seq: 'desc' },
                take: 1,
                select: { id: true, startedAt: true, status: true, pausedAt: true, totalPausedSec: true, coCompanionId: true, coAmount: true, claimedMode: true, claimedPrice: true, duration: true },
              },
            },
          },
      },
      orderBy,
    });
  }

  /**
   * 客户看板（老板 2026-10-03）。
   *
   * 老板原话：「店长端 + 陪玩端 加一个看板，罗列所有的客户，每个客户的消费情况 +
   * 是不是正在跟陪玩打游戏，都列出来，消费金额或者游戏时长或者正在跟陪玩打的排在最上边……
   * 店长需要掌控并知道每个陪玩什么样、每个陪玩的客户现在什么样，要一个动态看板，
   * 让所有人都能一目了然知道自己的陪玩或者自己的客户到底什么样。」
   *
   * 一张表同时回答三个问题：
   *  ① 客户什么样 —— 消费金额（口径 = 已完成单 `DONE`，跟盈亏统计 / 报账一致）、
   *     已完成单数、累计游戏时长（已完成会话 duration 之和，单位小时）、最近一单、
   *     客户状态、客户存款；
   *  ② 陪玩什么样 —— 这个人现在什么状态（接单中 / 娱乐中 / 空闲 / 休息 / 离线）、
   *     电脑在不在线、此刻正在给哪个客户打；
   *  ③ 现在什么样 —— 这个客户此刻是不是正在跟陪玩打、打的哪张单、什么游戏、
   *     已经打了多久、跟谁一起打。
   *
   * 可见范围（和「客户管理」同一套口径，不能因为多了个看板就多看到东西）：
   *  - 陪玩：只有自己的客户（`companionId = 我`）；
   *  - 店长 / 客服：本店；
   *  - 老板：全部工作室。
   *  客户来源（来源平台 / 引流账号）仍然只有「发单工作室的管理端」看得到 —— 这里自己先抹一遍，
   *  不指望响应拦截器（拦截器只认 `customFields` 里那几个键，认不出 `platformAccount` 这一列）。
   *
   * @param opts.sort `live`（默认：正在打的排最前，再按消费金额 / 时长）/ `spent` / `hours` / `recent`
   */
  async customerBoard(user: AuthenticatedUser, opts: { sort?: string; companionId?: string } = {}) {
    const isCompanionViewer = user.role === 'COMPANION';
    const scope = isCompanionViewer ? 'own' : user.role === 'OWNER' ? 'all' : 'studio';
    const empty = {
      rows: [],
      companions: [],
      counts: { customers: 0, serving: 0, spentTotal: 0, hoursTotal: 0, companions: 0, unassigned: 0 },
      scope,
      updatedAt: new Date().toISOString(),
    };
    // 陪玩账号没挂 Companion 档案：宁可给空，也不要把全店 / 全站客户漏出去。
    if (isCompanionViewer && !user.companionId) return empty;

    const customerWhere: any = { isDeletedByCustomer: false };
    if (isCompanionViewer) customerWhere.companionId = user.companionId;
    else if (user.role !== 'OWNER') customerWhere.studioId = user.studioId;
    if (!isCompanionViewer && opts.companionId) customerWhere.companionId = opts.companionId;

    const companionWhere: any = { isResigned: false };
    if (user.role !== 'OWNER') companionWhere.studioId = user.studioId;
    if (isCompanionViewer) companionWhere.id = user.companionId;
    else if (opts.companionId) companionWhere.id = opts.companionId;

    const [customers, scopedCompanions] = await Promise.all([
      this.prisma.customer.findMany({
        where: customerWhere,
        select: {
          id: true,
          customerCode: true,
          wechatId: true,
          studioId: true,
          companionId: true,
          platform: true,
          platformAccount: true,
          status: true,
          scheduledAt: true,
          depositBalance: true,
          createdAt: true,
          studio: { select: { name: true } },
        },
      }),
      this.prisma.companion.findMany({
        where: companionWhere,
        select: {
          id: true,
          status: true,
          user: { select: { username: true, displayName: true, avatar: true } },
          pc: { select: { lastHeartbeat: true } },
        },
      }),
    ]);

    const ids = customers.map((c) => c.id);
    const noRows: any[] = [];
    const [orders, liveSessions] = await Promise.all([
      ids.length
        ? this.prisma.order.findMany({
            where: { customerId: { in: ids } },
            select: { id: true, customerId: true, status: true, amount: true, createdAt: true },
          })
        : Promise.resolve(noRows),
      ids.length
        ? this.prisma.orderSession.findMany({
            where: {
              status: 'ACTIVE',
              startedAt: { not: null },
              endedAt: null,
              parentOrder: { customerId: { in: ids } },
            },
            orderBy: { startedAt: 'desc' },
            select: {
              id: true,
              companionId: true,
              coCompanionId: true,
              amount: true,
              coAmount: true,
              duration: true,
              startedAt: true,
              pausedAt: true,
              totalPausedSec: true,
              parentOrder: {
                select: {
                  id: true,
                  orderCode: true,
                  gameName: true,
                  customerId: true,
                  studio: { select: { name: true } },
                },
              },
            },
          })
        : Promise.resolve(noRows),
    ]);

    // 累计游戏时长：已完成会话的 duration（小时）按订单归到客户身上
    const orderIds = orders.map((o: any) => o.id);
    const durationSums = orderIds.length
      ? await this.prisma.orderSession.groupBy({
          by: ['parentOrderId'],
          where: { parentOrderId: { in: orderIds }, status: 'DONE' },
          _sum: { duration: true },
        })
      : ([] as any[]);

    // 名字 / 头像 / 状态：把「客户归属的陪玩」和「正在一起打的两个陪玩」收进同一份索引。
    const refIds = new Set<string>();
    for (const c of scopedCompanions) refIds.add(c.id);
    for (const c of customers) if (c.companionId) refIds.add(c.companionId);
    for (const s of liveSessions as any[]) {
      if (s.companionId) refIds.add(s.companionId);
      if (s.coCompanionId) refIds.add(s.coCompanionId);
    }
    const refCompanions: any[] = refIds.size
      ? await this.prisma.companion.findMany({
          where: { id: { in: [...refIds] } },
          select: {
            id: true,
            status: true,
            isResigned: true,
            user: { select: { username: true, displayName: true, avatar: true } },
            pc: { select: { lastHeartbeat: true } },
          },
        })
      : noRows;
    const infoOf = new Map<string, any>(refCompanions.map((c) => [c.id, c]));
    const now = Date.now();
    const ONLINE_MS = 120_000;
    const isOnline = (id?: string | null): boolean => {
      if (!id) return false;
      const hb = infoOf.get(id)?.pc?.lastHeartbeat;
      return !!hb && now - new Date(hb).getTime() < ONLINE_MS;
    };
    const nameOf = (id?: string | null): string => {
      const c = id ? infoOf.get(id) : null;
      return c?.user?.displayName || c?.user?.username || '';
    };
    const round1 = (n: unknown) => Math.round((Number(n) || 0) * 10) / 10;

    const stats = new Map<string, { orderCount: number; spent: number; hours: number; lastOrderAt: Date | null; lastDoneAt: Date | null }>();
    for (const c of customers) {
      stats.set(c.id, { orderCount: 0, spent: 0, hours: 0, lastOrderAt: null, lastDoneAt: null });
    }
    const customerOfOrder = new Map<string, string>();
    for (const o of orders as any[]) {
      customerOfOrder.set(o.id, o.customerId);
      const st = stats.get(o.customerId);
      if (!st) continue;
      if (!st.lastOrderAt || o.createdAt > st.lastOrderAt) st.lastOrderAt = o.createdAt;
      if (o.status === 'DONE') {
        st.orderCount += 1;
        st.spent += Number(o.amount) || 0;
        if (!st.lastDoneAt || o.createdAt > st.lastDoneAt) st.lastDoneAt = o.createdAt;
      }
    }
    for (const g of durationSums as any[]) {
      const cid = customerOfOrder.get(g.parentOrderId);
      const st = cid ? stats.get(cid) : null;
      if (st) st.hours += Number(g._sum?.duration) || 0;
    }

    const liveByCustomer = new Map<string, any>();
    for (const s of liveSessions as any[]) {
      const cid = s.parentOrder?.customerId;
      if (cid && !liveByCustomer.has(cid)) liveByCustomer.set(cid, s);
    }

    const rows = customers.map((c) => {
      const st = stats.get(c.id)!;
      const s = liveByCustomer.get(c.id) || null;
      const owner = c.companionId ? infoOf.get(c.companionId) : null;
      const canSeeSource = canSeeCustomerSource(user, c.studioId);
      let live: any = null;
      if (s) {
        let elapsedSec = 0;
        if (s.startedAt) {
          elapsedSec =
            Math.round((now - new Date(s.startedAt).getTime()) / 1000) - (s.totalPausedSec || 0);
          if (s.pausedAt) {
            elapsedSec -= Math.max(0, Math.round((now - new Date(s.pausedAt).getTime()) / 1000));
          }
          elapsedSec = Math.max(0, elapsedSec);
        }
        // 客户归属的那个人是不是这张单的主陪，决定「搭档」显示谁
        const assignedIsMain = !!c.companionId && s.companionId === c.companionId;
        const partnerId = assignedIsMain ? s.coCompanionId : s.companionId;
        const servingId = c.companionId || s.companionId || s.coCompanionId || null;
        live = {
          sessionId: s.id,
          orderId: s.parentOrder?.id || '',
          orderCode: s.parentOrder?.orderCode || '',
          gameName: s.parentOrder?.gameName || '',
          orderStudioName: s.parentOrder?.studio?.name || '',
          startedAt: s.startedAt,
          paused: !!s.pausedAt,
          elapsedSec,
          plannedHours: Number(s.duration) || 0,
          mainCompanionId: s.companionId || null,
          mainCompanionName: nameOf(s.companionId),
          coCompanionId: s.coCompanionId || null,
          coCompanionName: nameOf(s.coCompanionId),
          partnerId: partnerId || null,
          partnerName: nameOf(partnerId),
          servingCompanionId: servingId,
          servingCompanionName: nameOf(servingId),
          role: assignedIsMain ? 'MAIN' : 'CO',
        };
      }
      return {
        customerId: c.id,
        studioId: c.studioId,
        studioName: c.studio?.name || '',
        customerCode: c.customerCode,
        wechatId: c.wechatId || '',
        status: c.status,
        scheduledAt: c.scheduledAt,
        createdAt: c.createdAt,
        depositBalance: round1(c.depositBalance),
        platform: canSeeSource ? c.platform || '' : '',
        platformAccount: canSeeSource ? c.platformAccount || '' : '',
        companionId: c.companionId || null,
        companionName: nameOf(c.companionId),
        companionAvatar: owner?.user?.avatar || null,
        companionStatus: owner?.status || null,
        companionOnline: isOnline(c.companionId),
        companionResigned: !!owner?.isResigned,
        orderCount: st.orderCount,
        spent: round1(st.spent),
        hours: round1(st.hours),
        lastOrderAt: st.lastOrderAt,
        lastDoneAt: st.lastDoneAt,
        live,
      };
    });

    // 排序：默认「正在打的最上边」，然后消费金额、游戏时长、最近一单。
    const sortMode = opts.sort || 'live';
    const liveFirst = (r: any) => (r.live ? 0 : 1);
    const ts = (d: Date | null) => (d ? new Date(d).getTime() : 0);
    rows.sort((a: any, b: any) => {
      if (sortMode === 'recent') return ts(b.lastOrderAt) - ts(a.lastOrderAt);
      if (liveFirst(a) !== liveFirst(b)) return liveFirst(a) - liveFirst(b);
      if (sortMode === 'hours') {
        if (b.hours !== a.hours) return b.hours - a.hours;
        return b.spent - a.spent;
      }
      if (b.spent !== a.spent) return b.spent - a.spent;
      if (b.hours !== a.hours) return b.hours - a.hours;
      return ts(b.lastOrderAt) - ts(a.lastOrderAt);
    });

    // 陪玩分组：店长要「每个陪玩什么样、他的客户现在什么样」，所以再按陪玩归一份汇总。
    const groupIds = new Set<string>();
    for (const c of scopedCompanions) groupIds.add(c.id);
    for (const r of rows) if (r.companionId) groupIds.add(r.companionId);
    const groups = [...groupIds].map((id) => {
      const info = infoOf.get(id);
      const mine = rows.filter((r: any) => r.companionId === id);
      const liveRow: any = mine.find((r: any) => r.live) || null;
      return {
        companionId: id,
        name: nameOf(id) || '已删除的陪玩',
        username: info?.user?.username || '',
        avatar: info?.user?.avatar || null,
        status: info?.status || 'OFFLINE',
        online: isOnline(id),
        resigned: !!info?.isResigned,
        customers: mine.length,
        spent: round1(mine.reduce((s: number, r: any) => s + r.spent, 0)),
        hours: round1(mine.reduce((s: number, r: any) => s + r.hours, 0)),
        servingCustomer: liveRow
          ? {
              customerId: liveRow.customerId,
              customerCode: liveRow.customerCode,
              gameName: liveRow.live.gameName,
              orderCode: liveRow.live.orderCode,
              paused: liveRow.live.paused,
              elapsedSec: liveRow.live.elapsedSec,
            }
          : null,
      };
    });
    const statusRank: Record<string, number> = { BUSY: 0, ENTERTAINMENT: 1, AVAILABLE: 2, RESTING: 3, OFFLINE: 4 };
    groups.sort((a, b) => {
      if (!!a.servingCustomer !== !!b.servingCustomer) return a.servingCustomer ? -1 : 1;
      if (a.online !== b.online) return a.online ? -1 : 1;
      const ra = statusRank[a.status] ?? 5;
      const rb = statusRank[b.status] ?? 5;
      if (ra !== rb) return ra - rb;
      if (b.spent !== a.spent) return b.spent - a.spent;
      return String(a.name).localeCompare(String(b.name), 'zh-CN');
    });

    return {
      rows,
      companions: groups,
      counts: {
        customers: rows.length,
        serving: rows.filter((r: any) => r.live).length,
        spentTotal: round1(rows.reduce((s: number, r: any) => s + r.spent, 0)),
        hoursTotal: round1(rows.reduce((s: number, r: any) => s + r.hours, 0)),
        companions: groups.length,
        unassigned: rows.filter((r: any) => !r.companionId).length,
      },
      scope,
      updatedAt: new Date().toISOString(),
    };
  }
  async findOne(id: string, user?: AuthenticatedUser) {
    const where: any = { id };
    // Studio isolation: non-OWNER users can only see customers in their studio
    if (user && user.role !== 'OWNER') {
      if (user.role === 'COMPANION') {
        where.companionId = user.companionId;
        where.isDeletedByCustomer = false;
      } else {
        where.studioId = user.studioId;
      }
    }
    const customer = await this.prisma.customer.findUnique({
      where,
      include: {
        companion: {
          include: {
            user: { select: { username: true } },
          },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('客户不存在');
    }

    return customer;
  }

  async create(data: CreateCustomerDto) {
    let customerCode = data.customerCode;
    if (!customerCode) {
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
      customerCode = String(next);
    }

    return this.prisma.customer.create({
      data: {
        studioId: data.studioId,
        customerCode,
        wechatId: data.wechatId,
        companionId: data.companionId ?? null,
        platform: data.platform ?? null,
        platformAccount: data.platformAccount ?? null,
        consultDate: data.consultDate ? new Date(data.consultDate) : null,
        wechatAddDate: data.wechatAddDate ? new Date(data.wechatAddDate) : null,
        notes: data.notes ?? null,
      },
      include: {
        companion: {
          include: {
            user: { select: { username: true } },
          },
        },
      },
    });
  }

  async update(id: string, data: UpdateCustomerDto, user?: AuthenticatedUser) {
    const customer = await this.findOne(id, user); // Reuse scoped findOne
    if (!customer) {
      throw new NotFoundException('客户不存在');
    }
    // 桥接共享的客户只读，不能修改对方工作室的客户数据
    if (user && user.role !== 'OWNER' && user.studioId && customer.studioId !== user.studioId) {
      throw new ForbiddenException('共享客户只读，不能修改对方工作室的数据');
    }
    // Prevent cross-studio companionId tampering
    if (user && data.companionId !== undefined) {
      if (user.role === 'COMPANION' && data.companionId !== user.companionId) {
        throw new ForbiddenException('无权修改客户归属');
      }
    }

    const updateData: any = {};

    if (data.wechatId !== undefined) updateData.wechatId = data.wechatId;
    if (data.companionId !== undefined) updateData.companionId = data.companionId;
    if (data.platform !== undefined) updateData.platform = data.platform;
    if (data.platformAccount !== undefined) updateData.platformAccount = data.platformAccount;
    if (data.consultDate !== undefined) updateData.consultDate = data.consultDate ? new Date(data.consultDate) : null;
    if (data.wechatAddDate !== undefined)
      updateData.wechatAddDate = data.wechatAddDate ? new Date(data.wechatAddDate) : null;
    if (data.isAccountBanned !== undefined) updateData.isAccountBanned = data.isAccountBanned;
    if (data.isDeletedByCustomer !== undefined) updateData.isDeletedByCustomer = data.isDeletedByCustomer;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.scheduledAt !== undefined) updateData.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;

    return this.prisma.customer.update({
      where: { id },
      data: updateData,
      include: {
        companion: {
          include: {
            user: { select: { username: true } },
          },
        },
      },
    });
  }

  async delete(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException('客户不存在');
    }

    return this.prisma.customer.delete({ where: { id } });
  }

  async listDeposits(customerId: string, user?: AuthenticatedUser) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { studioId: true, companionId: true },
    });
    if (!customer) throw new NotFoundException('客户不存在');
    if (user?.role === 'COMPANION' && customer.companionId !== user.companionId) {
      throw new ForbiddenException('只能查看自己名下客户的存单');
    }
    if ((user?.role === 'CS' || user?.role === 'ADMIN') && customer.studioId !== user.studioId) {
      throw new ForbiddenException('无权查看其他工作室的客户存单');
    }
    return this.prisma.customerDeposit.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: { companion: { include: { user: { select: { username: true, displayName: true } } } } },
    });
  }

  async createDeposit(
    customerId: string,
    body: { amount: number; screenshotUrl?: string; note?: string },
    user?: AuthenticatedUser,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { studioId: true, companionId: true },
    });
    if (!customer) throw new NotFoundException('客户不存在');
    if (user?.role === 'COMPANION' && customer.companionId !== user.companionId) {
      throw new ForbiddenException('只能给自己名下客户存单');
    }
    if ((user?.role === 'CS' || user?.role === 'ADMIN') && customer.studioId !== user.studioId) {
      throw new ForbiddenException('无权操作其他工作室的客户');
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new ForbiddenException('请填写正确的存单金额');

    const deposit = await this.prisma.customerDeposit.create({
      data: {
        customerId,
        companionId: user?.companionId ?? null,
        amount,
        screenshotUrl: body.screenshotUrl || null,
        note: body.note || null,
      },
    });
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { depositBalance: { increment: amount } },
    });
    return deposit;
  }

  async reassign(id: string, companionId: string | null, user?: AuthenticatedUser) {
    const customer = await this.findOne(id, user); // Validate access
    if (user && user.role !== 'OWNER' && user.studioId && customer.studioId !== user.studioId) {
      throw new ForbiddenException('共享客户只读，不能重新分配');
    }

    if (companionId) {
      const companion = await this.prisma.companion.findUnique({
        where: { id: companionId },
      });
      if (!companion) {
        throw new NotFoundException('陪玩不存在');
      }
    }

    return this.prisma.customer.update({
      where: { id },
      data: { companionId },
      include: {
        companion: {
          include: {
            user: { select: { username: true } },
          },
        },
      },
    });
  }

  async findOrders(id: string, user?: AuthenticatedUser) {
    await this.findOne(id, user); // Validate access

    return this.prisma.order.findMany({
      where: { customerId: id },
      include: {
        companion: {
          include: {
            user: { select: { username: true } },
          },
        },
        coCompanion: {
          include: {
            user: { select: { username: true, displayName: true } },
          },
        },
        // 转让留痕（老板 2026-09-29）：客户管理里也要注明「已于某时转让给某人」。
        transfers: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            createdAt: true,
            reason: true,
            fromCompanion: { select: { id: true, user: { select: { username: true, displayName: true } } } },
            toCompanion: { select: { id: true, user: { select: { username: true, displayName: true } } } },
          },
        },
        sessions: {
          orderBy: { seq: 'asc' },
          select: {
            id: true,
            companionId: true,
            coCompanionId: true,
            startedAt: true,
            endedAt: true,
            status: true,
            pausedAt: true,
            totalPausedSec: true,
            duration: true,
            claimedMode: true,
            claimedPrice: true,
            coAmount: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async detectCustomerType(customerId: string, user?: AuthenticatedUser): Promise<{ type: string; orderCount: number }> {
    await this.findOne(customerId, user); // Validate access
    const count = await this.prisma.order.count({
      where: { customerId, status: 'DONE' },
    });
    if (count === 0) return { type: 'FIRST', orderCount: 0 };
    return { type: 'REPURCHASE', orderCount: count };
  }

  async updateCustomerStatus(customerId: string): Promise<string> {
    const lastOrder = await this.prisma.order.findFirst({
      where: { customerId, status: 'DONE' },
      orderBy: { createdAt: 'desc' },
    });

    let status: string;
    if (!lastOrder) {
      status = 'PENDING_DEVELOPMENT';
    } else {
      const daysSince = Math.floor((Date.now() - lastOrder.createdAt.getTime()) / 86400000);
      if (daysSince <= 7) status = 'ACTIVE';
      else if (daysSince <= 30) status = 'FOLLOW_UP';
      else status = 'LOST';
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { status },
    });
    return status;
  }

  async getOrCreateProfile(customerId: string, user?: AuthenticatedUser) {
    await this.findOne(customerId, user); // Validate access
    let profile = await this.prisma.customerProfile.findUnique({
      where: { customerId },
    });
    if (!profile) {
      profile = await this.prisma.customerProfile.create({
        data: { customerId },
      });
    }
    return profile;
  }

  async updateProfile(customerId: string, data: any, user?: AuthenticatedUser) {
    const customer = await this.findOne(customerId, user); // Validate access
    if (user && user.role !== 'OWNER' && user.studioId && customer.studioId !== user.studioId) {
      throw new ForbiddenException('共享客户只读，不能修改资料');
    }
    return this.prisma.customerProfile.upsert({
      where: { customerId },
      create: { customerId, ...data },
      update: data,
    });
  }

  async getFollowUps(customerId: string, user?: AuthenticatedUser) {
    await this.findOne(customerId, user); // Validate access
    return this.prisma.customerFollowUp.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addFollowUp(dto: {
    customerId: string;
    playerId?: string;
    adminId?: string;
    content: string;
    nextAction?: string;
    /** 下次跟进时间（客服在跟进台账里选的，ISO 字符串） */
    nextFollowUpAt?: string;
    /** 这次是用哪个客服工作微信加的客户 */
    workWechatName?: string;
  }, user?: AuthenticatedUser) {
    const customer = await this.findOne(dto.customerId, user); // Validate access
    if (user && user.role !== 'OWNER' && user.studioId && customer.studioId !== user.studioId) {
      throw new ForbiddenException('共享客户只读，不能添加跟进');
    }
    // 显式列出字段（不再直接把 dto 丢给 prisma）：新加的两个字段要转成日期 / 空值
    const nextFollowUpAt = dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null;
    const followUp = await this.prisma.customerFollowUp.create({
      data: {
        customerId: dto.customerId,
        playerId: dto.playerId,
        adminId: dto.adminId,
        content: dto.content,
        nextAction: dto.nextAction,
        nextFollowUpAt:
          nextFollowUpAt && !Number.isNaN(nextFollowUpAt.getTime()) ? nextFollowUpAt : null,
        workWechatName: dto.workWechatName || null,
      },
    });
    // Auto-update customer status after follow-up
    await this.updateCustomerStatus(dto.customerId);
    return followUp;
  }

  // ── 重复客户档案（老板 2026-09-29：「线上那几条重复的客户档案要不要一起清一轮」）──
  //
  // 线上出现过同一个微信号建了 2~3 条档案（根因是发单时没带原客户ID，服务端就新插一条，
  // 已于 2026-09-29 修掉，见 CreateOrderModal）。这里做两件事：
  //   ① 把「同一个工作室 + 同一个微信号」的重复组查出来（只读，给界面看）；
  //   ② 把一条并到另一条 —— 订单 / 跟进 / 存单 / 接触记录 / 轨迹 / 报账单 / 客户资料全部挪过去，
  //      标量字段「保留的那条为主、空着的用来源补、金额相加、备注拼接」，最后删掉多余那条。

  /** 重复客户档案分组（同一工作室下、微信号相同且非空的档案） */
  async listDuplicateGroups(studioId?: string | null) {
    const where: any = { wechatId: { not: '' } };
    if (studioId) where.studioId = studioId;
    const rows = await this.prisma.customer.findMany({
      where,
      select: {
        id: true,
        studioId: true,
        customerCode: true,
        wechatId: true,
        platform: true,
        platformAccount: true,
        notes: true,
        totalSpent: true,
        depositBalance: true,
        status: true,
        createdAt: true,
        companionId: true,
        _count: { select: { orders: true, followUps: true, deposits: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.studioId}|${row.wechatId.trim()}`;
      const list = groups.get(key) || [];
      list.push(row);
      groups.set(key, list);
    }

    return [...groups.values()]
      .filter((list) => list.length > 1)
      .map((list) => {
        // 默认保留哪一条：先看谁身上有活（订单 > 跟进 > 存单），一样多就留最早那条原始档案。
        // 界面上老板/店长可以改成保留别的，改完再合。
        const score = (c: (typeof list)[number]) =>
          c._count.orders * 100 + c._count.followUps * 10 + c._count.deposits;
        const keep = [...list].sort(
          (a, b) =>
            score(b) - score(a) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        )[0];
        return {
          wechatId: list[0].wechatId,
          keepId: keep.id,
          customers: list.map((c) => ({ ...c, isKeep: c.id === keep.id })),
        };
      });
  }

  /** 把 sourceId 这条档案并进 targetId（保留 targetId），并删掉 sourceId */
  async mergeCustomers(sourceId: string, targetId: string, user?: AuthenticatedUser) {
    if (!sourceId || !targetId || sourceId === targetId) {
      throw new ForbiddenException('要合并的两条档案不能是同一条');
    }
    const [source, target] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: sourceId } }),
      this.prisma.customer.findUnique({ where: { id: targetId } }),
    ]);
    if (!source) throw new NotFoundException('要合并的客户档案不存在');
    if (!target) throw new NotFoundException('要保留的客户档案不存在');
    if (source.studioId !== target.studioId) {
      throw new ForbiddenException('两条档案不在同一个工作室，不能合并');
    }
    if (user && user.role !== 'OWNER' && user.studioId && target.studioId !== user.studioId) {
      throw new ForbiddenException('只能合并本工作室的客户档案');
    }

    const moved = await this.prisma.$transaction(async (tx) => {
      const orders = await tx.order.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });
      const followUps = await tx.customerFollowUp.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });
      const deposits = await tx.customerDeposit.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });
      const contacts = await tx.customerContact.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });
      const tracks = await tx.customerTrack.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });
      const deleteRequests = await tx.customerDeleteRequest.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });
      const screenshots = await tx.battleScreenshot.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });

      // 客户资料是一对一：保留的那条没有就搬过去，两边都有就留保留那条的（来源那条删掉，不残留孤儿行）
      let profileMoved = false;
      const sourceProfile = await tx.customerProfile.findUnique({ where: { customerId: sourceId } });
      if (sourceProfile) {
        const targetProfile = await tx.customerProfile.findUnique({
          where: { customerId: targetId },
        });
        if (targetProfile) {
          await tx.customerProfile.delete({ where: { customerId: sourceId } });
        } else {
          await tx.customerProfile.update({
            where: { customerId: sourceId },
            data: { customerId: targetId },
          });
          profileMoved = true;
        }
      }

      const STATUS_RANK: Record<string, number> = {
        ACTIVE: 3,
        FOLLOW_UP: 2,
        PENDING_DEVELOPMENT: 1,
        LOST: 0,
      };
      const mergedNotes = [
        target.notes,
        source.notes ? `[合并 #${source.customerCode}] ${source.notes}` : '',
      ]
        .map((v) => (v || '').trim())
        .filter(Boolean)
        .join('\n');

      await tx.customer.update({
        where: { id: targetId },
        data: {
          platform: target.platform || source.platform,
          platformAccount: target.platformAccount || source.platformAccount,
          consultDate: target.consultDate || source.consultDate,
          wechatAddDate: target.wechatAddDate || source.wechatAddDate,
          notes: mergedNotes || null,
          totalSpent: target.totalSpent + source.totalSpent,
          depositBalance: target.depositBalance + source.depositBalance,
          status:
            (STATUS_RANK[source.status] || 0) > (STATUS_RANK[target.status] || 0)
              ? source.status
              : target.status,
          companionId: target.companionId || source.companionId,
          scheduledAt: target.scheduledAt || source.scheduledAt,
          isAccountBanned: target.isAccountBanned || source.isAccountBanned,
          isDeletedByCustomer: target.isDeletedByCustomer && source.isDeletedByCustomer,
        },
      });

      await tx.customer.delete({ where: { id: sourceId } });

      return {
        orders: orders.count,
        followUps: followUps.count,
        deposits: deposits.count,
        contacts: contacts.count,
        tracks: tracks.count,
        screenshots: screenshots.count,
        deleteRequests: deleteRequests.count,
        profileMoved,
      };
    });

    return { sourceCode: source.customerCode, targetCode: target.customerCode, ...moved };
  }

  // ── Traffic Pool ──

  async getTrafficPool(studioId: string, platform?: string) {
    const where: any = { studioId };
    if (platform) where.platform = platform;
    return this.prisma.customer.findMany({
      where,
      select: { id: true, customerCode: true, platform: true, platformAccount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getChannelStats(studioId: string) {
    const customers = await this.prisma.customer.findMany({ where: { studioId }, select: { platform: true } });
    const stats: Record<string, number> = {};
    for (const c of customers) {
      stats[c.platform || '未知'] = (stats[c.platform || '未知'] || 0) + 1;
    }
    return stats;
  }
}
