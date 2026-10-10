// craftsman-ignore: TS001
import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { canSeeCustomerSource } from '../common/order-privacy';
import { currentBusinessDayRange } from '../common/business-day';
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

  async findAll(user: AuthenticatedUser, sortBy?: string, scope?: string) {
    const where: any = {};

    // 封存（老板 2026-10-04）：默认只列活跃客户；要看「已封存」传 scope=archived。
    if (scope === 'archived') where.archivedAt = { not: null };
    else if (scope !== 'all') where.archivedAt = null;

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
              createdAt: true,
              customFields: true,
              sessions: {
                orderBy: { seq: 'desc' },
                take: 1,
                select: { id: true, startedAt: true, endedAt: true, status: true, pausedAt: true, totalPausedSec: true, coCompanionId: true, coAmount: true, claimedMode: true, claimedPrice: true, duration: true, paidByDeposit: true },
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
   * @param opts.sort `live`（默认：正在打的排最前，再按消费金额 / 时长）/ `spent` / `today` / `hours` / `recent`
   */
  async customerBoard(user: AuthenticatedUser, opts: { sort?: string; companionId?: string } = {}) {
    const isCompanionViewer = user.role === 'COMPANION';
    const scope = isCompanionViewer ? 'own' : user.role === 'OWNER' ? 'all' : 'studio';
    const empty = {
      rows: [],
      companions: [],
      counts: { customers: 0, serving: 0, spentTotal: 0, todaySpentTotal: 0, hoursTotal: 0, companions: 0, unassigned: 0 },
      scope,
      updatedAt: new Date().toISOString(),
    };
    // 陪玩账号没挂 Companion 档案：宁可给空，也不要把全店 / 全站客户漏出去。
    if (isCompanionViewer && !user.companionId) return empty;

    // 封存的客户不在看板上出现（封存 = 这轮不打了、等以后再换人加）
    const customerWhere: any = { isDeletedByCustomer: false, archivedAt: null };
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
            select: {
              id: true,
              customerId: true,
              status: true,
              amount: true,
              createdAt: true,
              customFields: true,
            },
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

    // 客户画像小抄（老板 2026-10-04）：列表这一行直接标出「有几个人陪他打过、最常打机密还是绝密」，
    // 不用点开抽屉也能一眼看出来。口径跟详情抽屉一致：只算已完成（DONE）的会话。
    const sessionDetails = orderIds.length
      ? await this.prisma.orderSession.findMany({
          where: { parentOrderId: { in: orderIds }, status: 'DONE' },
          select: {
            parentOrderId: true,
            companionId: true,
            coCompanionId: true,
            claimedMode: true,
          },
        })
      : ([] as any[]);
    const modeOfOrder = new Map<string, string>();
    for (const o of orders as any[]) {
      const cf = (o.customFields as any) || {};
      const raw = String(cf.gameMode || cf.deltaMission || '').trim();
      modeOfOrder.set(
        o.id,
        !raw ? '未知' : raw.includes('绝密') ? '绝密' : raw.includes('机密') ? '机密' : raw,
      );
    }
    const hints = new Map<string, { companions: Set<string>; modes: Map<string, number> }>();
    for (const c of customers) hints.set(c.id, { companions: new Set(), modes: new Map() });
    for (const s of sessionDetails as any[]) {
      const cid = customerOfOrder.get(s.parentOrderId);
      const hint = cid ? hints.get(cid) : null;
      if (!hint) continue;
      if (s.companionId) hint.companions.add(s.companionId);
      if (s.coCompanionId) hint.companions.add(s.coCompanionId);
      const mode = String(s.claimedMode || '').trim() || modeOfOrder.get(s.parentOrderId) || '未知';
      hint.modes.set(mode, (hint.modes.get(mode) || 0) + 1);
    }

    // 今日（营业日口径，与「实时看板」的今日业绩同一条时间界线：当日 12:00 至次日 12:00）。
    // 老板 2026-10-04：客户看板要和实时看板「同一口径」，两边配合看就齐了。
    //  - 今日消费 / 今日单数：已完成（DONE）的单里，**下单时间**落在本营业日的（实时看板也按 createdAt 取数）；
    //  - 今日时长：本营业日开局的已完成会话 duration 之和。
    const { start: todayStart, end: todayEnd } = currentBusinessDayRange();
    const todaySessionSums = ids.length
      ? await this.prisma.orderSession.groupBy({
          by: ['parentOrderId'],
          where: {
            status: 'DONE',
            startedAt: { gte: todayStart, lt: todayEnd },
            parentOrder: { customerId: { in: ids } },
          },
          _sum: { duration: true },
        })
      : ([] as any[]);
    const todayStats = new Map<string, { spent: number; orders: number; hours: number }>();
    for (const c of customers) todayStats.set(c.id, { spent: 0, orders: 0, hours: 0 });
    for (const o of orders as any[]) {
      if (o.status !== 'DONE') continue;
      if (!(o.createdAt >= todayStart && o.createdAt < todayEnd)) continue;
      const t = todayStats.get(o.customerId);
      if (!t) continue;
      t.spent += Number(o.amount) || 0;
      t.orders += 1;
    }
    for (const g of todaySessionSums as any[]) {
      const cid = customerOfOrder.get(g.parentOrderId);
      const t = cid ? todayStats.get(cid) : null;
      if (t) t.hours += Number(g._sum?.duration) || 0;
    }

    const liveByCustomer = new Map<string, any>();
    for (const s of liveSessions as any[]) {
      const cid = s.parentOrder?.customerId;
      if (cid && !liveByCustomer.has(cid)) liveByCustomer.set(cid, s);
    }

    const rows = customers.map((c) => {
      const st = stats.get(c.id)!;
      const t = todayStats.get(c.id) || { spent: 0, orders: 0, hours: 0 };
      const s = liveByCustomer.get(c.id) || null;
      const owner = c.companionId ? infoOf.get(c.companionId) : null;
      const canSeeSource = canSeeCustomerSource(user, c.studioId);
      const hint = hints.get(c.id);
      const servedBy = hint ? hint.companions.size : 0;
      const topMode =
        hint && hint.modes.size
          ? [...hint.modes.entries()].sort((a, b) => b[1] - a[1])[0][0]
          : '';
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
        servedBy,
        topMode,
        spent: round1(st.spent),
        hours: round1(st.hours),
        todaySpent: round1(t.spent),
        todayOrders: t.orders,
        todayHours: round1(t.hours),
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
      if (sortMode === 'today') {
        if (b.todaySpent !== a.todaySpent) return b.todaySpent - a.todaySpent;
        if (b.todayOrders !== a.todayOrders) return b.todayOrders - a.todayOrders;
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
        todaySpentTotal: round1(rows.reduce((s: number, r: any) => s + r.todaySpent, 0)),
        hoursTotal: round1(rows.reduce((s: number, r: any) => s + r.hours, 0)),
        companions: groups.length,
        unassigned: rows.filter((r: any) => !r.companionId).length,
      },
      scope,
      updatedAt: new Date().toISOString(),
    };
  }
  /**
   * 客户画像（老板 2026-10-04）。
   *
   * 老板原话：「这同一个客户在多少个工作微信上，各自消费了多少、打机密还是绝密、打了多久、
   * 维护多久了，不就能评判这个客户喜欢什么样的陪玩、喜欢什么样的单价等信息了，以后再遇到
   * 这个客户咨询小红书，客服不就应该单独派给什么样的陪玩了。」
   *
   * 口径（跟客户看板列表、盈亏统计一条线）：
   *  - 只统计**已完成（DONE）**的单 / 会话；
   *  - 消费 = 单价 × 实际时长：主陪算 `amount`、副陪算 `coAmount`，两边各算各的；
   *  - 模式（机密 / 绝密）优先取陪玩自己确认的 `session.claimedMode`，没有才退回客服发单时填的
   *    `customFields.gameMode / deltaMission`；
   *  - 单价优先取 `session.claimedPrice`，没有才退回订单单价；
   *  - 「工作微信」= 陪玩抢到这张单时落在单上的工作微信（`customFields.workWechatName`，
   *    来源 `order-dispatch.service.ts` 的自动绑定）；单上没记的，退回「这个陪玩当前绑定的工作微信」，
   *    再没有就按陪玩兜一行（标「未记录工作微信」），保证表里不漏人。
   *
   * 可见范围跟客户管理 / 看板完全一致：陪玩只有自己的客户，店长 / 客服本店，老板全站。
   */
  async customerProfileAnalytics(id: string, user: AuthenticatedUser) {
    const where: any = { id };
    if (user.role === 'COMPANION') {
      where.companionId = user.companionId;
      where.isDeletedByCustomer = false;
    } else if (user.role !== 'OWNER') {
      where.studioId = user.studioId;
    }
    const customer = await this.prisma.customer.findUnique({
      where,
      select: {
        id: true,
        customerCode: true,
        wechatId: true,
        studioId: true,
        status: true,
        companionId: true,
        createdAt: true,
        studio: { select: { name: true } },
      },
    });
    if (!customer) throw new NotFoundException('客户不存在');

    const orders = await this.prisma.order.findMany({
      where: { customerId: id, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        orderCode: true,
        type: true,
        status: true,
        amount: true,
        coAmount: true,
        duration: true,
        gameName: true,
        createdAt: true,
        customFields: true,
        companionId: true,
        coCompanionId: true,
        csWorkWechatId: true,
        csWorkWechatName: true,
      },
    });
    const doneOrders = (orders as any[]).filter((o) => o.status === 'DONE');
    const orderIds = doneOrders.map((o) => o.id);
    const sessions = orderIds.length
      ? await this.prisma.orderSession.findMany({
          where: { parentOrderId: { in: orderIds }, status: 'DONE' },
          orderBy: { seq: 'asc' },
          select: {
            id: true,
            parentOrderId: true,
            companionId: true,
            coCompanionId: true,
            amount: true,
            coAmount: true,
            duration: true,
            claimedMode: true,
            claimedPrice: true,
            startedAt: true,
          },
        })
      : ([] as any[]);

    const num = (v: unknown): number | null => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const normMode = (v: unknown): string => {
      const s = String(v ?? '').trim();
      if (!s) return '未知';
      if (s.includes('绝密')) return '绝密';
      if (s.includes('机密')) return '机密';
      return s;
    };
    const hoursOf = (v: unknown, fallback = 1): number => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    const tsOf = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);
    const DAY = 86_400_000;
    const now = Date.now();

    const sessionsByOrder = new Map<string, any[]>();
    for (const s of sessions as any[]) {
      const list = sessionsByOrder.get(s.parentOrderId) || [];
      list.push(s);
      sessionsByOrder.set(s.parentOrderId, list);
    }

    // 第一遍：每张已完成单先把口径算出来（金额 / 时长 / 模式 / 这张单挂的是哪个工作微信）。
    const metas: Array<{
      order: any;
      orderMode: string;
      orderHours: number;
      spanHours: number;
      orderMoney: number;
      mainUnit: number | null;
      coUnit: number | null;
      recWx: string;
      recWxId: string;
      unitPrices: number[];
      oSessions: any[];
    }> = [];
    const knownWx = new Set<string>();
    const seenCompanions = new Set<string>();
    const modeByOrder = new Map<string, { mode: string; hours: number; money: number }>();
    const prices: number[] = [];
    let totalHours = 0;
    let totalGross = 0;
    let firstDoneAt: Date | null = null;
    let lastDoneAt: Date | null = null;

    for (const o of doneOrders as any[]) {
      const cf = (o.customFields as any) || {};
      const orderMode = normMode(cf.gameMode || cf.deltaMission || '');
      const orderHours = hoursOf(o.duration);
      const mainUnit = num(o.amount);
      const coUnit = num(o.coAmount);
      const recWx = String(
        cf.workWechatName || cf.csWorkWechatName || o.csWorkWechatName || '',
      ).trim();
      const recWxId = String(
        cf.workWechatId || cf.csWorkWechatId || o.csWorkWechatId || '',
      ).trim();
      if (recWx) knownWx.add(recWx);
      const oSessions = sessionsByOrder.get(o.id) || [];
      const spanHours = oSessions.length
        ? oSessions.reduce((s: number, x: any) => s + hoursOf(x.duration, orderHours), 0)
        : orderHours;
      const orderMoney = ((mainUnit ?? 0) + (coUnit ?? 0)) * spanHours;
      const unitPrices: number[] = [];
      if (!oSessions.length) {
        if (mainUnit != null) unitPrices.push(mainUnit);
        if (coUnit != null) unitPrices.push(coUnit);
      } else {
        for (const s of oSessions) {
          const mp = num(s.claimedPrice) ?? num(s.amount) ?? mainUnit;
          const cp = num(s.coAmount) ?? coUnit;
          if (mp != null) unitPrices.push(mp);
          if (cp != null) unitPrices.push(cp);
        }
      }
      for (const p of unitPrices) prices.push(p);

      totalGross += orderMoney;
      totalHours += spanHours;
      if (!firstDoneAt || o.createdAt < firstDoneAt) firstDoneAt = o.createdAt;
      if (!lastDoneAt || o.createdAt > lastDoneAt) lastDoneAt = o.createdAt;

      const oMode = oSessions.length ? normMode(oSessions[0].claimedMode || orderMode) : orderMode;
      const modeEntry = modeByOrder.get(o.id) || { mode: oMode, hours: 0, money: orderMoney };
      modeEntry.mode = oMode;
      modeEntry.hours += spanHours;
      modeByOrder.set(o.id, modeEntry);

      for (const s of oSessions) {
        if (s.companionId) seenCompanions.add(s.companionId);
        if (s.coCompanionId) seenCompanions.add(s.coCompanionId);
      }
      if (o.companionId) seenCompanions.add(o.companionId);
      if (o.coCompanionId) seenCompanions.add(o.coCompanionId);

      metas.push({
        order: o, orderMode, orderHours, spanHours, orderMoney, mainUnit, coUnit,
        recWx, recWxId, unitPrices, oSessions,
      });
    }

    // 第二遍：先查工作微信台账（按陪玩绑定 + 按单上记的号两种都能认），再查陪玩资料。
    const wxList = [...knownWx];
    const firstWorkWechats =
      seenCompanions.size || wxList.length
        ? await this.prisma.workWechat.findMany({
            where: {
              OR: [
                ...(seenCompanions.size ? [{ companionId: { in: [...seenCompanions] } }] : []),
                ...(wxList.length ? [{ wechatId: { in: wxList } }] : []),
              ],
            },
            select: { companionId: true, wechatId: true, nickname: true, status: true },
          })
        : ([] as any[]);
    const wxOwner = new Map<string, string>();
    for (const w of firstWorkWechats as any[]) {
      if (w.wechatId && w.companionId) wxOwner.set(w.wechatId, w.companionId);
      if (w.companionId) seenCompanions.add(w.companionId);
    }

    const ownerId = customer.companionId || null;
    const refIds = [...new Set([...seenCompanions, ...(ownerId ? [ownerId] : [])])];
    const companions = refIds.length
      ? await this.prisma.companion.findMany({
          where: { id: { in: refIds } },
          select: {
            id: true,
            status: true,
            isResigned: true,
            user: { select: { username: true, displayName: true, avatar: true } },
            studio: { select: { id: true, name: true, type: true } },
            pc: { select: { lastHeartbeat: true } },
          },
        })
      : ([] as any[]);
    const infoOf = new Map<string, any>((companions as any[]).map((c) => [c.id, c]));
    const wxByOwner = new Map<string, any>();
    const wxByCode = new Map<string, any>();
    for (const w of firstWorkWechats as any[]) {
      if (w.companionId && !wxByOwner.has(w.companionId)) wxByOwner.set(w.companionId, w);
      if (w.wechatId && !wxByCode.has(w.wechatId)) wxByCode.set(w.wechatId, w);
    }
    const nameOf = (cid?: string | null): string => {
      const c = cid ? infoOf.get(cid) : null;
      return c?.user?.displayName || c?.user?.username || '';
    };
    const ONLINE_MS = 120_000;
    const isOnline = (cid?: string | null): boolean => {
      const hb = cid ? infoOf.get(cid)?.pc?.lastHeartbeat : null;
      return !!hb && now - new Date(hb).getTime() < ONLINE_MS;
    };

    // 每个「工作微信 × 单」一条事件：主陪、副陪各记一条。
    const events: Array<{
      orderId: string;
      companionId: string | null;
      role: 'MAIN' | 'CO';
      hours: number;
      money: number;
      mode: string;
      price: number | null;
      at: Date;
    }> = [];

    for (const m of metas) {
      const o = m.order;
      const wxOwnerId = m.recWx ? wxOwner.get(m.recWx) || null : null;
      const fallbackMain = o.companionId || wxOwnerId;

      if (!m.oSessions.length) {
        if (fallbackMain) {
          events.push({
            orderId: o.id, companionId: fallbackMain, role: 'MAIN', hours: m.orderHours,
            money: (m.mainUnit ?? 0) * m.orderHours, mode: m.orderMode, price: m.mainUnit,
            at: o.createdAt,
          });

        }
        if (o.coCompanionId) {
          events.push({
            orderId: o.id, companionId: o.coCompanionId, role: 'CO', hours: m.orderHours,
            money: (m.coUnit ?? 0) * m.orderHours, mode: m.orderMode, price: m.coUnit,
            at: o.createdAt,
          });

        }
        continue;
      }

      for (const s of m.oSessions) {
        const h = hoursOf(s.duration, m.orderHours);
        const mode = normMode(s.claimedMode || m.orderMode);
        const mainP = num(s.amount) ?? m.mainUnit;
        const coP = num(s.coAmount) ?? m.coUnit;
        const mainPrice = num(s.claimedPrice) ?? mainP;
        const mainId = s.companionId || fallbackMain;
        const coId = s.coCompanionId || o.coCompanionId;
        const at = s.startedAt || o.createdAt;
        if (mainId) {
          events.push({
            orderId: o.id, companionId: mainId, role: 'MAIN', hours: h,
            money: (mainP ?? 0) * h, mode, price: mainPrice, at,
          });

        }
        if (coId) {
          events.push({
            orderId: o.id, companionId: coId, role: 'CO', hours: h,
            money: (coP ?? 0) * h, mode, price: coP, at,
          });

        }
      }
    }

    // 按「工作微信」归一份：单上记了号的按号，没记的按陪玩兜一行。
    const metaById = new Map<string, any>(metas.map((m) => [m.order.id, m]));
    const groups = new Map<string, any>();
    for (const e of events) {
      const m = metaById.get(e.orderId);
      const recWx = m?.recWx || '';
      const recWxId = m?.recWxId || '';
      const key = recWx
        ? 'wx:' + recWx
        : recWxId
          ? 'wxid:' + recWxId
          : 'cp:' + (e.companionId || '__none__');
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          recWx,
          recWxId,
          recorded: !!(recWx || recWxId),
          orderIds: new Set<string>(),
          people: new Map<string, any>(),
          hours: 0,
          money: 0,
          modes: new Map<string, number>(),
          prices: [] as number[],
          firstAt: e.at,
          lastAt: e.at,
        };
        groups.set(key, g);
      }
      if (!g.orderIds.has(e.orderId)) {
        g.orderIds.add(e.orderId);
        const meta: any = metaById.get(e.orderId);
        const span = meta?.spanHours ?? e.hours;
        const money = meta?.orderMoney ?? e.money;
        const mode = meta?.orderMode
          ? meta.oSessions?.length
            ? normMode(meta.oSessions[0].claimedMode || meta.orderMode)
            : meta.orderMode
          : e.mode;
        g.hours += span;
        g.money += money;
        g.modes.set(mode, (g.modes.get(mode) || 0) + span);
        g.prices.push(...((meta?.unitPrices as number[]) || []));
      }
      if (tsOf(e.at) < tsOf(g.firstAt)) g.firstAt = e.at;
      if (tsOf(e.at) > tsOf(g.lastAt)) g.lastAt = e.at;
      if (e.companionId) {
        const p = g.people.get(e.companionId) || {
          companionId: e.companionId, hours: 0, orderIds: new Set<string>(), roles: new Set<string>(),
        };
        p.hours += e.hours;
        p.orderIds.add(e.orderId);
        p.roles.add(e.role);
        g.people.set(e.companionId, p);
      }
    }

    // 再按「陪玩」归一份：工作微信那张表里，一张双陪单只挂在主陪的号上，
    // 副陪不会单独成行；派单建议要按人算，所以这里单独汇总（副陪那份也算进他自己头上）。
    const byCompanion = new Map<string, any>();
    for (const e of events) {
      if (!e.companionId) continue;
      let a = byCompanion.get(e.companionId);
      if (!a) {
        a = {
          companionId: e.companionId,
          orderIds: new Set<string>(),
          roles: new Set<string>(),
          hours: 0,
          money: 0,
          modes: new Map<string, number>(),
          prices: [] as number[],
          wxCounts: new Map<string, number>(),
          firstAt: e.at,
          lastAt: e.at,
        };
        byCompanion.set(e.companionId, a);
      }
      a.orderIds.add(e.orderId);
      a.roles.add(e.role);
      a.hours += e.hours;
      a.money += e.money;
      a.modes.set(e.mode, (a.modes.get(e.mode) || 0) + e.hours);
      if (e.price != null) a.prices.push(e.price);
      const recWx = metaById.get(e.orderId)?.recWx || '';
      if (recWx) a.wxCounts.set(recWx, (a.wxCounts.get(recWx) || 0) + 1);
      if (tsOf(e.at) < tsOf(a.firstAt)) a.firstAt = e.at;
      if (tsOf(e.at) > tsOf(a.lastAt)) a.lastAt = e.at;
    }

    const workWechatList = [...groups.values()]
      .map((g: any) => {
        const people = [...g.people.values()].sort((a: any, b: any) => b.hours - a.hours);
        const main: any = people[0] || null;
        const companionId: string | null = main?.companionId || null;
        const info = companionId ? infoOf.get(companionId) : null;
        const bound = companionId ? wxByOwner.get(companionId) : null;
        const wxRow = g.recWx ? wxByCode.get(g.recWx) : null;
        const modeList = [...g.modes.entries()]
          .map(([mode, hours]) => ({ mode, hours: round1(hours as number) }))
          .sort((x: any, y: any) => y.hours - x.hours);
        const list: number[] = g.prices;
        const roles: Set<string> = main?.roles || new Set();
        const workWechatId = g.recWx || g.recWxId || bound?.wechatId || '';
        return {
          key: g.key,
          recorded: g.recorded,
          hasWorkWechat: !!workWechatId,
          workWechatId,
          workWechatNickname: wxRow?.nickname || bound?.nickname || '',
          boundWorkWechatId: bound?.wechatId || '',
          companionId,
          companionName: nameOf(companionId) || '已删除的陪玩',
          companionAvatar: info?.user?.avatar || null,
          companionsCount: people.length,
          companions: people.slice(0, 5).map((p: any) => ({
            companionId: p.companionId, companionName: nameOf(p.companionId), hours: round1(p.hours),
          })),
          studioId: info?.studio?.id || '',
          studioName: info?.studio?.name || '',
          studioType: info?.studio?.type || '',
          isResigned: !!info?.isResigned,
          online: isOnline(companionId),
          status: info?.status || 'OFFLINE',
          role: roles.has('MAIN') && roles.has('CO') ? 'BOTH' : roles.has('MAIN') ? 'MAIN' : 'CO',
          orders: g.orderIds.size,
          hours: round1(g.hours),
          money: round1(g.money),
          modes: modeList,
          topMode: modeList[0]?.mode || '未知',
          priceMin: list.length ? Math.min(...list) : null,
          priceMax: list.length ? Math.max(...list) : null,
          priceAvg: list.length ? round1(list.reduce((s, x) => s + x, 0) / list.length) : null,
          firstAt: g.firstAt,
          lastAt: g.lastAt,
          maintainDays: Math.floor((now - tsOf(g.firstAt)) / DAY),
          lastDaysAgo: Math.floor((now - tsOf(g.lastAt)) / DAY),
        };
      })
      .sort(
        (a: any, b: any) =>
          b.hours - a.hours ||
          b.money - a.money ||
          Number(b.hasWorkWechat) - Number(a.hasWorkWechat) ||
          String(a.workWechatId).localeCompare(String(b.workWechatId)),
      );

    const modeTotals = new Map<string, { mode: string; orders: number; hours: number; money: number }>();
    for (const m of modeByOrder.values()) {
      const cur = modeTotals.get(m.mode) || { mode: m.mode, orders: 0, hours: 0, money: 0 };
      cur.orders += 1;
      cur.hours += m.hours;
      cur.money += m.money;
      modeTotals.set(m.mode, cur);
    }
    const modes = [...modeTotals.values()]
      .map((m) => ({
        mode: m.mode,
        orders: m.orders,
        hours: round1(m.hours),
        money: round1(m.money),
        ratio: totalHours > 0 ? Math.round((m.hours / totalHours) * 100) : 0,
      }))
      .sort((a, b) => b.hours - a.hours || b.orders - a.orders);

    const topMode = modes[0]?.mode || '未知';
    const priceBand = prices.length
      ? {
          min: Math.min(...prices),
          max: Math.max(...prices),
          avg: round1(prices.reduce((s, x) => s + x, 0) / prices.length),
          samples: prices.length,
        }
      : { min: null, max: null, avg: null, samples: 0 };

    // 派单建议：优先「陪他打过、且打得就是他现在最常打的模式」的人；其次总时长、在线、最近一次。
    const statusLabel: Record<string, string> = {
      AVAILABLE: '空闲',
      BUSY: '接单中',
      ENTERTAINMENT: '娱乐中',
      RESTING: '休息中',
      OFFLINE: '离线',
    };
    const picks = [...byCompanion.values()]
      .filter((a: any) => !infoOf.get(a.companionId)?.isResigned)
      .map((a: any) => {
        const info = infoOf.get(a.companionId);
        const bound = wxByOwner.get(a.companionId);
        const recordedWx =
          [...a.wxCounts.entries()].sort((x: any, y: any) => y[1] - x[1])[0]?.[0] || '';
        const roles: Set<string> = a.roles;
        return {
          companionId: a.companionId,
          companionName: nameOf(a.companionId) || '已删除的陪玩',
          companionAvatar: info?.user?.avatar || null,
          studioName: info?.studio?.name || '',
          workWechatId: recordedWx || bound?.wechatId || '',
          workWechatNickname:
            (recordedWx ? wxByCode.get(recordedWx)?.nickname : bound?.nickname) || '',
          online: isOnline(a.companionId),
          status: info?.status || 'OFFLINE',
          role: roles.has('MAIN') && roles.has('CO') ? 'BOTH' : roles.has('MAIN') ? 'MAIN' : 'CO',
          orders: a.orderIds.size,
          hours: round1(a.hours),
          modeHours: round1(a.modes.get(topMode) || 0),
          topMode,
          priceAvg: a.prices.length
            ? round1(a.prices.reduce((s: number, x: number) => s + x, 0) / a.prices.length)
            : null,
          lastDaysAgo: Math.floor((now - tsOf(a.lastAt)) / DAY),
          _lastAt: a.lastAt,
        };
      })
      .sort(
        (a: any, b: any) =>
          b.modeHours - a.modeHours ||
          b.hours - a.hours ||
          Number(b.online) - Number(a.online) ||
          tsOf(b._lastAt) - tsOf(a._lastAt),
      )
      .slice(0, 3)
      .map(({ _lastAt, ...rest }: any) => rest);

    const priceText =
      priceBand.min != null
        ? `${priceBand.min}~${priceBand.max} 元/小时（均值 ${priceBand.avg}）`
        : '还没有记录到单价';
    const workWechatCount = workWechatList.filter((w: any) => w.hasWorkWechat).length;
    let summary: string;
    if (!doneOrders.length) {
      summary = '这个客户还没有成交记录，先按普通新客派单；第一单落地后，这里会自动给出画像和派单建议。';
    } else {
      const head = `一共成交 ${doneOrders.length} 单、打了 ${round1(totalHours)} 小时，毛收入 ${round1(totalGross)} 元`;
      const wxText = workWechatCount
        ? `，在 ${workWechatCount} 个工作微信上打过`
        : '';
      const modeText = modes.length ? `，最常打「${topMode}」（占 ${modes[0]?.ratio ?? 0}%）` : '';
      const first = picks[0];
      const pickText = first
        ? `优先派给 ${first.companionName}` +
          (first.workWechatId ? `（工作微信 ${first.workWechatId}）` : '') +
          `：他陪这个客户打过 ${first.modeHours > 0 ? first.modeHours + ' 小时' + topMode + '、' : ''}` +
          `共 ${first.hours} 小时 ${first.orders} 单，现在${statusLabel[first.status] || first.status || '离线'}` +
          `${first.online ? '' : '（电脑离线）'}。`
        : '暂时没有可以推荐的陪玩。';
      summary = `这个客户${head}${wxText}${modeText}；习惯单价 ${priceText}。${pickText}`;
    }

    const firstOrderAt = (orders as any[]).length ? (orders as any[])[0].createdAt : null;
    const lastOrderAt = (orders as any[]).length
      ? (orders as any[])[(orders as any[]).length - 1].createdAt
      : null;

    // 老板 2026-10-04：「陪玩端不要显示跟谁打过，只写客户喜好就行了」——
    // 陪玩拿到的画像**只含这个客户自己的偏好**（常打机密/绝密、习惯单价、成交单数/时长/消费），
    // 不含工作微信明细表、不含推荐陪玩、不含经手人数 —— 看不到「跟谁打过」，也就不会泄露别的陪玩。
    if (user.role === 'COMPANION') {
      const prefText = !doneOrders.length
        ? '这个客户还没有成交记录，先按普通新客接待；打过一单后这里会自动给出他的喜好。'
        : `这个客户一共成交 ${doneOrders.length} 单、打了 ${round1(totalHours)} 小时、消费 ${round1(totalGross)} 元` +
          (modes.length ? `，最常打「${topMode}」（占 ${modes[0]?.ratio ?? 0}%）` : '') +
          `；习惯单价 ${priceText}。`;
      return {
        customer: {
          id: customer.id,
          customerCode: customer.customerCode,
          wechatId: customer.wechatId || '',
          studioId: customer.studioId,
          studioName: customer.studio?.name || '',
          status: customer.status,
          ownerCompanionId: ownerId,
          ownerCompanionName: nameOf(ownerId),
          createdAt: customer.createdAt,
          firstOrderAt,
          firstDoneAt,
          lastOrderAt,
          lastDoneAt,
          maintainDays: firstOrderAt ? Math.floor((now - tsOf(firstOrderAt)) / DAY) : 0,
          lastDaysAgo: lastOrderAt ? Math.floor((now - tsOf(lastOrderAt)) / DAY) : null,
        },
        totals: {
          doneOrders: doneOrders.length,
          sessions: (sessions as any[]).length,
          hours: round1(totalHours),
          gross: round1(totalGross),
          modes,
          topMode,
          price: priceBand,
        },
        recommendation: { topMode, priceBand, summary: prefText, picks: [] },
        companionView: true,
        scope: 'own',
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      customer: {
        id: customer.id,
        customerCode: customer.customerCode,
        wechatId: customer.wechatId || '',
        studioId: customer.studioId,
        studioName: customer.studio?.name || '',
        status: customer.status,
        ownerCompanionId: ownerId,
        ownerCompanionName: nameOf(ownerId),
        createdAt: customer.createdAt,
        firstOrderAt,
        firstDoneAt,
        lastOrderAt,
        lastDoneAt,
        maintainDays: firstOrderAt ? Math.floor((now - tsOf(firstOrderAt)) / DAY) : 0,
        lastDaysAgo: lastOrderAt ? Math.floor((now - tsOf(lastOrderAt)) / DAY) : null,
      },
      totals: {
        doneOrders: doneOrders.length,
        sessions: (sessions as any[]).length,
        hours: round1(totalHours),
        gross: round1(totalGross),
        modes,
        topMode,
        price: priceBand,
        workWechatCount,
        workWechatRowCount: workWechatList.length,
        companionCount: byCompanion.size,
        onlineCompanions: [...byCompanion.keys()].filter((cid: string) => isOnline(cid)).length,
      },
      workWechats: workWechatList,
      recommendation: { topMode, priceBand, summary, picks },
      // 陪玩已在上面提前 return（只给「客户喜好」），这里剩 OWNER / ADMIN / CS
      scope: user.role === 'OWNER' ? 'all' : 'studio',
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

  /**
   * 删除客户（管理端）。
   *
   * 老板 2026-10-04：抢单后客户一直没通过、陪玩也没标记的，管理端把这个客户删掉即可。
   * 但订单表对客户是 RESTRICT 外键，只要客户名下还有订单就删不掉；
   * 而且真正成交过的客户删了会把订单 / 业绩一起带走。所以这里分两种情况：
   *   - 名下订单全是「从未成交」的（待抢 / 已抢 / 已确认 / 已取消，无业绩、无会话、无补单申请）
   *     → 连这些僵尸单一起清掉，客户才能真的删掉；
   *   - 只要有一单成交 / 有业绩 / 有服务会话 / 有补单申请
   *     → 明确挡住，不动账目（真要处理由老板点名）。
   */
  /**
   * 封存客户（老板 2026-10-04）：
   *   「客户小红书也不回，那只能把这个客户信息封存起来了，找合适的时候再找别的陪玩加加试试」。
   * 不是删除 —— 档案、订单、业绩、跟进记录全留着，只是从活跃列表里收起来。
   */
  async archive(id: string, user: AuthenticatedUser, reason?: string) {
    const customer = await this.findOne(id, user);
    if ((customer as any).archivedAt) return customer;
    return this.prisma.customer.update({
      where: { id },
      data: {
        archivedAt: new Date(),
        archivedReason: String(reason || '').trim() || null,
        archivedByUserId: user?.id || null,
      },
    });
  }

  /**
   * 解封（老板 2026-10-04）：可以把客户直接改派给另一个陪玩再试一次；
   * 改派 / 解封都会往备注里追加一行，留个「什么时候解封、换给了谁」的痕。
   */
  async unarchive(id: string, user: AuthenticatedUser, opts: { companionId?: string } = {}) {
    const customer = await this.findOne(id, user);
    const data: any = { archivedAt: null, archivedReason: null, archivedByUserId: null };
    let extra = '';
    if (opts.companionId && opts.companionId !== (customer as any).companionId) {
      const target = await this.prisma.companion
        .findUnique({
          where: { id: opts.companionId },
          select: { id: true, user: { select: { username: true, displayName: true } } },
        })
        .catch(() => null);
      if (!target) throw new NotFoundException('陪玩不存在');
      data.companionId = opts.companionId;
      extra = `改派给 ${(target as any).user?.displayName || (target as any).user?.username || opts.companionId}`;
    }
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const line = `[解封重试 ${stamp}] ${extra || '仍归原陪玩'} —— 冷一段时间后换人加微信`;
    const notes = (customer as any).notes ? `${(customer as any).notes}\n${line}` : line;
    return this.prisma.customer.update({ where: { id }, data: { ...data, notes } });
  }

  async delete(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException('客户不存在');
    }

    let orders: any[] = [];
    try {
      orders =
        ((await this.prisma.order.findMany({
          where: { customerId: id },
          select: { id: true, status: true },
        })) as any[]) || [];
    } catch {
      orders = [];
    }
    const orderIds = orders.map((o: any) => o.id).filter(Boolean);

    if (orderIds.length) {
      const blocked = await this.hasSettledOrderHistory(orders, orderIds);
      if (blocked) {
        throw new ConflictException('该客户已有成交 / 业绩记录，不能删除；请改用归属调整或备注说明');
      }
      try {
        await this.prisma.order.deleteMany({ where: { customerId: id } });
      } catch {
        /* 僵尸单清不掉时交给下面的 customer.delete 报错，不吞掉 */
      }
    }

    return this.prisma.customer.delete({ where: { id } });
  }

  /** 客户名下订单里是否已经有「不能删」的痕迹（成交状态 / 业绩 / 服务会话 / 补单申请）。 */
  private async hasSettledOrderHistory(orders: any[], orderIds: string[]): Promise<boolean> {
    const cleanStatuses = ['PENDING', 'GRABBED', 'CONFIRMED', 'CANCELLED'];
    if (orders.some((o) => !cleanStatuses.includes(String(o.status)))) return true;
    const count = async (p: any) => {
      try {
        return Number(await p) || 0;
      } catch {
        return 0;
      }
    };
    const [txCount, sessionCount, supplementCount] = await Promise.all([
      count(this.prisma.transaction.count({ where: { orderId: { in: orderIds } } })),
      count(this.prisma.orderSession.count({ where: { parentOrderId: { in: orderIds } } })),
      count(this.prisma.supplementRequest.count({ where: { orderId: { in: orderIds } } })),
    ]);
    return txCount > 0 || sessionCount > 0 || supplementCount > 0;
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
