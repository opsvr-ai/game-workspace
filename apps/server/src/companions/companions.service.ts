// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeRevenueSplit, effectiveTenureMonths } from '../common/revenue-calculator';
import type { RevenueSplitTier } from '../common/revenue-calculator';
import {
  businessDayKey,
  businessDayRange,
  currentBusinessDayRange,
  currentSettlementMonthRange,
} from '../common/business-day';
import { companionMonthRevenueParts, companionOrderRevenue } from '../common/order-revenue';
import { computeEntertainmentFee, entertainmentBasisRevenue, isEntertainmentFree, loadEntertainmentRule, sumDepositPlayedToday } from '../common/entertainment-fee';
import { roundToJiao } from '../common/money';
import { resolveConfigsRaw } from '../common/studio-config';
import { CompanionRevenueService } from './companion-revenue.service';
import { CompanionAttendanceService } from './companion-attendance.service';
import { CompanionWechatService } from './companion-wechat.service';
import { ExcellenceService } from './excellence.service';
import { BridgeService } from '../studios/bridge.service';
import { StudiosService } from '../studios/studios.service';
import { presence } from '../common/presence';
import { notResignedWhere } from '../common/offboarding';

/**
 * 在线判定的时间阈值（和前端 constants/companions.ts 保持一致）：
 * 陪玩端每 30 秒一次心跳，超过 2 分钟没心跳才算离线；
 * 客服/店长/老板的客户端心跳是「窗口可见才发」，放宽到 5 分钟。
 */
const COMPANION_HEARTBEAT_MS = 120_000;
const STAFF_HEARTBEAT_MS = 300_000;

function seenWithin(seen: string | Date | null | undefined, limit: number, now: number): boolean {
  if (!seen) return false;
  const t = new Date(seen).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t < limit;
}

@Injectable()
export class CompanionsService {
  constructor(
    private prisma: PrismaService,
    private readonly revenueService: CompanionRevenueService,
    private readonly attendanceService: CompanionAttendanceService,
    private readonly wechatService: CompanionWechatService,
    private readonly excellence: ExcellenceService,
    private readonly bridgeService: BridgeService,
    private readonly studiosService: StudiosService,
  ) {}

  /**
   * 人员列表：陪玩 + 客服 + 店长 + 老板，统一返回，附带各自的在线状态。
   *
   * 默认**不含已离职的人**：老板 2026-09-26 反馈「点了离职没反应」，
   * 就是因为离职的人在各种名单里照旧出现。要查离职人员传 includeResigned=true。
   */
  async listPersonnel(user: any, includeBridged = false, includeResigned = false) {
    const where: any = { role: { in: ['COMPANION', 'CS', 'ADMIN', 'OWNER'] } };
    if (user.role !== 'OWNER') {
      if (includeBridged && user.studioId) {
        const bridgedIds = await this.bridgeService.getBridgedStudioIds(user.studioId);
        where.studioId = { in: [user.studioId, ...bridgedIds] };
      } else {
        // 员工管理等页面只看本工作室；老板才看全部。
        where.studioId = user.studioId;
      }
    }
    if (!includeResigned) {
      // 历史数据兜底：老代码只写了 Companion.isResigned，没有 User.resignedAt
      Object.assign(where, notResignedWhere());
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        role: true,
        displayName: true,
        avatar: true,
        isAuthorized: true,
        resignedAt: true,
        studio: { select: { id: true, name: true, type: true } },
        companion: {
          select: {
            id: true,
            status: true,
            games: true,
            realName: true,
            phone: true,
            monthlyRevenue: true,
            isResigned: true,
            isSeniorStaff: true,
            pc: { select: { lastHeartbeat: true, currentMode: true } },
          },
        },
      },
    });

    // 客服/店长/老板 的在线状态来自 cs.client.version.<userId> 的 lastSeen
    const csRecords = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: 'cs.client.version.' } },
    });
    const csSeen = new Map<string, string | null>();
    for (const r of csRecords) {
      const uid = r.key.replace('cs.client.version.', '');
      const v = (r.value as any) || {};
      csSeen.set(uid, v.lastSeen || null);
    }

    // 客服 / 店长 / 老板 的在线状态还看「客户端连接在不在」：
    // cs-heartbeat 是「窗口可见才发」的，最小化 / 收进托盘就停发，
    // 只有它当依据的话，客户端开着也会被判成离线（老板 2026-09-21 报的「hanlei1 又掉线了」）。
    const staffPresence = (uid: string): string | null => {
      const at = presence.onlineAs(uid);
      return at ? at.toISOString() : null;
    };
    const newestSeen = (a?: string | null, b?: string | null): string | null => {
      const ta = a ? new Date(a).getTime() : 0;
      const tb = b ? new Date(b).getTime() : 0;
      if (!Number.isFinite(ta)) return b || null;
      if (!Number.isFinite(tb)) return a || null;
      return ta >= tb ? a || null : b || null;
    };

    const companionIds = users.filter((u) => u.companion).map((u) => u.companion!.id);
    const excellence = await this.excellence.computeForCompanions(companionIds);

    // 进行中的订单：让人员列表能显示陪玩当前在打什么（首单/续费/复购 + 游戏）
    const activeOrders = companionIds.length
      ? await this.prisma.order.findMany({
          where: {
            status: 'CONFIRMED',
            OR: [{ companionId: { in: companionIds } }, { coCompanionId: { in: companionIds } }],
          },
          select: { companionId: true, coCompanionId: true, type: true, gameName: true },
        })
      : [];
    const activeOrderByCompanion = new Map<string, { type: string; gameName: string }>();
    for (const o of activeOrders) {
      const targetId = o.companionId || o.coCompanionId;
      if (targetId) activeOrderByCompanion.set(targetId, { type: o.type, gameName: o.gameName });
    }

    // 在线与否一律在服务端按服务器时间算好再下发。
    // 以前是前端拿「自己电脑的系统时间」减心跳时间戳，客户机时间不准（差几分钟很常见）
    // 时整张人员列表会全变离线 —— 老板 2026-09-26 报的「陪玩全部离线状态」就是这个。
    const nowMs = Date.now();
    const heartbeatOf = (u: (typeof users)[number]): string | Date | null =>
      u.companion?.pc?.lastHeartbeat ?? newestSeen(csSeen.get(u.id), staffPresence(u.id));
    const isOnlineFor = (u: (typeof users)[number]): boolean => {
      const hb = heartbeatOf(u);
      if (hb) {
        const limit = u.role === 'COMPANION' ? COMPANION_HEARTBEAT_MS : STAFF_HEARTBEAT_MS;
        return seenWithin(hb, limit, nowMs);
      }
      // 没有心跳：陪玩退回「工作状态」；客服/店长/老板没有状态可退，就是离线。
      return !!u.companion?.status && u.companion.status !== 'OFFLINE';
    };

    return users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      displayName: u.displayName,
      avatar: u.avatar,
      isAuthorized: u.isAuthorized,
      resignedAt: u.resignedAt,
      studioId: u.studio?.id ?? null,
      studioName: u.studio?.name ?? null,
      studioType: u.studio?.type ?? null,
      companionId: u.companion?.id ?? null,
      status: u.companion?.status ?? null,
      games: u.companion?.games ?? [],
      realName: u.companion?.realName ?? null,
      phone: u.companion?.phone ?? null,
      monthlyRevenue: u.companion?.monthlyRevenue ?? null,
      isResigned: !!u.resignedAt || (u.companion?.isResigned ?? false),
      isSeniorStaff: u.companion?.isSeniorStaff ?? false,
      lastHeartbeat: heartbeatOf(u),
      isOnline: isOnlineFor(u),
      currentMode: u.companion?.pc?.currentMode ?? null,
      currentOrder: u.companion ? activeOrderByCompanion.get(u.companion.id) ?? null : null,
      isExcellent: u.companion ? excellence.get(u.companion.id)?.isExcellent ?? false : false,
      tier: u.companion ? excellence.get(u.companion.id)?.tier ?? 'MIDDLE' : 'MIDDLE',
      rankScore: u.companion ? excellence.get(u.companion.id)?.rankScore ?? 0 : 0,
      renewRate: u.companion ? excellence.get(u.companion.id)?.renewRate ?? 0 : 0,
      repurchaseRate: u.companion ? excellence.get(u.companion.id)?.repurchaseRate ?? 0 : 0,
      // 首单成功率（老板 2026-10-04 首页看板要用）：跟续单率 / 复购率同一套口径，
      // 在这里一起下发，省得首页再逐个去问一次。
      newRate: u.companion ? excellence.get(u.companion.id)?.newRate ?? 0 : 0,
      orderCount: u.companion ? excellence.get(u.companion.id)?.orderCount ?? 0 : 0,
    }));
  }

  async findAll(user: any, includeBridged = false, includeResigned = false) {
    const where: any = {};
    if (!includeResigned) {
      // 跟人员列表（listPersonnel）同一个口径：默认**不返回已离职的人**。
      // 以前这里不过滤，离职的人会一直留在「进程黑名单 / 白名单 / 改单 / 考勤筛选」
      // 这些下拉里（老板 2026-10-03 又报了一次「秦硕都离职了怎么还在名单里」）。
      // 确实要看离职人员的，显式传 includeResigned=true。
      where.user = { resignedAt: null };
      where.isResigned = false;
    }
    if (user.role !== 'OWNER') {
      if (includeBridged && user.studioId) {
        const bridgedIds = await this.bridgeService.getBridgedStudioIds(user.studioId);
        where.studioId = { in: [user.studioId, ...bridgedIds] };
      } else {
        where.studioId = user.studioId;
      }
    }
    const companions = await this.prisma.companion.findMany({
      where,
      include: {
        user: { select: { id: true, username: true, avatar: true, displayName: true } },
        pc: { select: { currentMode: true, isThrottled: true, lastHeartbeat: true } },
      },
    });

    // Derive processStatus from recent kill logs (30min window)
    const ids = companions.map((c) => c.id);
    if (ids.length === 0) return [];

    const excellence = await this.excellence.computeForCompanions(ids);

    const recentKills = await this.prisma.processKillLog.groupBy({
      by: ['companionId'],
      where: { companionId: { in: ids }, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
      _count: { id: true },
    });
    const killMap = new Map(recentKills.map((k) => [k.companionId, k._count.id]));

    const blockedKills = await this.prisma.processKillLog.findMany({
      where: {
        companionId: { in: ids },
        resultText: { contains: 'REPEAT_KILL_ALERT' },
        createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
      },
      select: { companionId: true },
      distinct: ['companionId'],
    });
    const blockedSet = new Set(blockedKills.map((k) => k.companionId));

    // Today's order counts per companion（营业日 12:00 至次日 12:00）
    const { start: todayStart, end: todayEnd } = currentBusinessDayRange();
    const todayOrders = await this.prisma.order.groupBy({
      by: ['companionId'],
      where: { companionId: { in: ids }, createdAt: { gte: todayStart, lt: todayEnd }, status: { not: 'CANCELLED' } },
      _count: { id: true },
    });
    const orderCounts = new Map(todayOrders.map((o) => [o.companionId, o._count.id]));

    // Today's budan counts
    const budanData = await this.prisma.order.findMany({
      where: { companionId: { in: ids }, createdAt: { gte: todayStart, lt: todayEnd } },
      select: { companionId: true, customFields: true, notes: true },
    });
    const budanCounts = new Map<string, number>();
    budanData.forEach((o) => {
      if ((o.customFields as any)?.deltaNote?.includes('补单') || o.notes?.includes('补单')) {
        budanCounts.set(o.companionId!, (budanCounts.get(o.companionId!) || 0) + 1);
      }
    });

    return companions.map((c) => ({
      ...c,
      // 报账微信码只有财务/客服/店长看得到；陪玩只能看自己的（自己的那份在「报账」页里）
      payoutQrUrl: user.role === 'COMPANION' ? null : c.payoutQrUrl,
      processStatus: blockedSet.has(c.id) ? 'BLOCKED' : (killMap.get(c.id) || 0) >= 1 ? 'WARNING' : 'NORMAL',
      todayOrderCount: (orderCounts.get(c.id) || 0) + (budanCounts.get(c.id) || 0),
      tier: excellence.get(c.id)?.tier ?? 'MIDDLE',
      rankScore: excellence.get(c.id)?.rankScore ?? 0,
    }));
  }

  /**
   * 实时看板（老板 2026-10-03）：
   * 「谁跟谁在接单中 / 谁谁娱乐中 / 谁谁空闲中，也显示正在打什么游戏、打了多久等等，
   *  让管理端派单的时候也方便，一目了然，不用挨个问。」
   *
   * 口径：
   *  - 在线 = 机器有心跳（跟人员列表同一个 2 分钟阈值，见 constants/companions.ts）；
   *  - 接单中 = 有一段 ACTIVE 且已开始、没结束的会话；主陪和副陪各占一行，互相写清搭档是谁；
   *  - 娱乐 / 休息 / 空闲 = Companion.status；
   *  - 时长 = 从 startedAt 到现在，扣掉累计暂停（暂停中的那一段也扣）。
   *
   * 隐私：只下发客户**编号**，不下发客户微信 —— 看板是派单用的，不是给谁抄客户的。
   *
   * 2026-10-04 扩展（老板：「这个看板也给陪玩端加上……把桥接工作室的也加进来，但不显示他们挣了多少，
   * 只标注订单信息，方便蠢驴电竞线下找不到人的时候可以邀请桥接工作室的陪玩」）：
   *  - 可见范围：老板 = 全站；店长 / 客服 / 陪玩 = 本店 + **桥接工作室**（方便照着看板去邀请桥接的人）；
   *  - 金额保护：桥接工作室的人一律不显示业绩/本单金额（只留订单信息：在打什么、跟谁、多久、单号）；
   *    陪玩端更是只在**自己那一格**显示业绩，同店同事也不给看，免得把别人的收入摊在所有人面前。
   */
  async liveBoard(user: any) {
    const viewerIsCompanion = user.role === 'COMPANION';
    const myCompanionId: string | null = viewerIsCompanion ? (user.companionId || null) : null;

    const where: any = { isResigned: false, user: { resignedAt: null } };
    let ownStudioId: string | null = null;
    if (user.role !== 'OWNER') {
      if (!user.studioId) {
        // 没挂工作室的账号（异常数据）：宁可给空，也绝不能因为 studioId 为空把全站漏出去。
        return {
          rows: [],
          updatedAt: new Date().toISOString(),
          counts: { serving: 0, entertainment: 0, available: 0, resting: 0, offline: 0 },
        };
      }
      const ownId: string = user.studioId;
      ownStudioId = ownId;
      let studioIds: string[] = [ownId];
      try {
        const bridged = await this.bridgeService.getBridgedStudioIds(ownId);
        studioIds = [...new Set([...studioIds, ...(bridged || [])])];
      } catch {
        // 桥接表查不到就退回只看本店，别把整个看板拖挂。
      }
      where.studioId = studioIds.length > 1 ? { in: studioIds } : ownId;
    }

    const companions = await this.prisma.companion.findMany({
      where,
      include: {
        user: { select: { id: true, username: true, displayName: true, avatar: true } },
        studio: { select: { id: true, name: true, type: true } },
        pc: { select: { lastHeartbeat: true, currentMode: true } },
      },
    });
    const ids = companions.map((c) => c.id);
    if (ids.length === 0) return { rows: [], updatedAt: new Date().toISOString() };

    const sessions = await this.prisma.orderSession.findMany({
      where: {
        status: 'ACTIVE',
        startedAt: { not: null },
        endedAt: null,
        OR: [{ companionId: { in: ids } }, { coCompanionId: { in: ids } }],
      },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        companionId: true,
        coCompanionId: true,
        startedAt: true,
        pausedAt: true,
        totalPausedSec: true,
        duration: true,
        amount: true,
        coAmount: true,
        parentOrder: {
          select: {
            id: true,
            orderCode: true,
            gameName: true,
            customFields: true,
            customer: { select: { customerCode: true } },
            studio: { select: { name: true } },
          },
        },
      },
    });

    // 今日业绩 / 今日单数 / 今日接单时长（老板 2026-10-03：「看板上要能直接看到业绩」）。
    // 业绩口径与结算完全一致：走 companionOrderRevenue（主陪扣掉搭档与分给别人的部分、
    // 搭档拿 coAmount）——不在这里另起一套算法，否则看板跟报账/结算对不上。
    const { start: dayStart, end: dayEnd } = currentBusinessDayRange();
    const dayNow = new Date();
    const todayOrders = await this.prisma.order.findMany({
      where: {
        status: 'DONE',
        createdAt: { gte: dayStart, lt: dayEnd },
        OR: [{ companionId: { in: ids } }, { coCompanionId: { in: ids } }],
      },
      select: { companionId: true, coCompanionId: true, amount: true, coAmount: true, customFields: true },
    });
    const todayRevMap = new Map<string, number>();
    const todayCountMap = new Map<string, number>();
    for (const o of todayOrders) {
      const involved = Array.from(new Set([o.companionId, o.coCompanionId].filter(Boolean) as string[]));
      for (const cid of involved) {
        const rev = companionOrderRevenue(o as any, cid);
        if (!rev) continue;
        todayRevMap.set(cid, (todayRevMap.get(cid) || 0) + rev);
        todayCountMap.set(cid, (todayCountMap.get(cid) || 0) + 1);
      }
    }
    // 今日接单时长：与首页仪表盘同源（CompanionTimeLog mode=BUSY），跨营业日只算落在今天那段。
    const busyLogs = await this.prisma.companionTimeLog.findMany({
      where: {
        companionId: { in: ids },
        mode: 'BUSY',
        startedAt: { lt: dayEnd },
        OR: [{ endedAt: null }, { endedAt: { gte: dayStart } }],
      },
      select: { companionId: true, startedAt: true, endedAt: true },
    });
    const todayWorkSecMap = new Map<string, number>();
    for (const l of busyLogs) {
      const from = Math.max(l.startedAt.getTime(), dayStart.getTime());
      const to = Math.min((l.endedAt || dayNow).getTime(), dayEnd.getTime());
      const sec = Math.round((to - from) / 1000);
      if (sec > 0) todayWorkSecMap.set(l.companionId, (todayWorkSecMap.get(l.companionId) || 0) + sec);
    }

    // 一个人同一时刻只可能有一段会话；同一个会话给主陪和副陪各生成一份视角。
    const byCompanion = new Map<string, any>();
    for (const s of sessions) {
      const base = {
        sessionId: s.id,
        orderId: s.parentOrder?.id || '',
        orderCode: s.parentOrder?.orderCode || '',
        gameName: s.parentOrder?.gameName || '',
        duration: s.duration ?? 1,
        startedAt: s.startedAt,
        pausedAt: s.pausedAt,
        totalPausedSec: s.totalPausedSec || 0,
        customerCode: s.parentOrder?.customer?.customerCode || '',
        orderStudioName: s.parentOrder?.studio?.name || '',
        mainCompanionId: s.companionId,
        coCompanionId: s.coCompanionId,
        amount: s.amount,
        coAmount: s.coAmount,
      };
      if (s.companionId && !byCompanion.has(s.companionId)) {
        byCompanion.set(s.companionId, { ...base, roleInSession: 'MAIN' });
      }
      if (s.coCompanionId && !byCompanion.has(s.coCompanionId)) {
        byCompanion.set(s.coCompanionId, { ...base, roleInSession: 'CO' });
      }
    }

    const nameOf = (id?: string | null) => {
      if (!id) return '';
      const c = companions.find((x) => x.id === id);
      return c?.user?.displayName || c?.user?.username || '';
    };
    const now = Date.now();
    const ONLINE_MS = 120_000;

    const rows = companions.map((c) => {
      const hb = c.pc?.lastHeartbeat ? new Date(c.pc.lastHeartbeat).getTime() : 0;
      const online = !!hb && now - hb < ONLINE_MS;
      const s = byCompanion.get(c.id) || null;
      const isOwnStudio = !ownStudioId ? true : c.studioId === ownStudioId;
      const earningsHidden =
        (viewerIsCompanion && c.id !== myCompanionId) || (user.role !== 'OWNER' && !isOwnStudio);
      let elapsedSec = 0;
      if (s?.startedAt) {
        elapsedSec = Math.max(0, Math.round((now - new Date(s.startedAt).getTime()) / 1000) - (s.totalPausedSec || 0));
        if (s.pausedAt) {
          elapsedSec -= Math.max(0, Math.round((now - new Date(s.pausedAt).getTime()) / 1000));
        }
        elapsedSec = Math.max(0, elapsedSec);
      }
      const partnerId = s ? (s.roleInSession === 'MAIN' ? s.coCompanionId : s.mainCompanionId) : null;
      return {
        companionId: c.id,
        name: c.user?.displayName || c.user?.username || '',
        username: c.user?.username || '',
        avatar: c.user?.avatar || null,
        status: c.status,
        online,
        lastHeartbeat: c.pc?.lastHeartbeat || null,
        studioName: c.studio?.name || '',
        // 桥接工作室的人：只标注在不在忙、在打什么，不给业绩。
        isBridged: !isOwnStudio,
        earningsHidden,
        todayRevenue: earningsHidden ? null : roundToJiao(todayRevMap.get(c.id) || 0),
        todayOrders: todayCountMap.get(c.id) || 0,
        todayMinutes: Math.round((todayWorkSecMap.get(c.id) || 0) / 60),
        serving: s
          ? {
              sessionId: s.sessionId,
              orderId: s.orderId,
              orderCode: s.orderCode,
              gameName: s.gameName,
              duration: s.duration,
              customerCode: s.customerCode,
              orderStudioName: s.orderStudioName,
              startedAt: s.startedAt,
              paused: !!s.pausedAt,
              elapsedSec,
              role: s.roleInSession,
              partnerId,
              partnerName: nameOf(partnerId),
              myAmount: earningsHidden ? null : (s.roleInSession === 'MAIN' ? s.amount : s.coAmount ?? null),
            }
          : null,
      };
    });

    // 排序：接单中 → 娱乐 → 空闲 → 休息 → 离线（同一组内按名字排，看着稳）。
    const rank = (r: any) => {
      // 有活跃会话就是「打单中」——哪怕客户端刚好掉线：订单还在跑，派单的人更需要先看到
      // 这一对，而不是把人藏进「离线」堆里（前端会在这一格上标「客户端已掉线」）。
      if (r.serving) return 0;
      if (!r.online) return 9;
      if (r.status === 'ENTERTAINMENT') return 1;
      if (r.status === 'AVAILABLE') return 2;
      if (r.status === 'RESTING') return 3;
      return 4;
    };
    rows.sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), 'zh'));

    return {
      rows,
      updatedAt: new Date().toISOString(),
      counts: {
        serving: rows.filter((r) => r.serving).length,
        entertainment: rows.filter((r) => r.online && !r.serving && r.status === 'ENTERTAINMENT').length,
        available: rows.filter((r) => r.online && !r.serving && r.status === 'AVAILABLE').length,
        resting: rows.filter((r) => r.online && !r.serving && r.status === 'RESTING').length,
        offline: rows.filter((r) => !r.online && !r.serving).length,
      },
    };
  }

  async findOne(id: string) {
    return this.prisma.companion.findUnique({
      where: { id },
      include: {
        user: { select: { username: true, avatar: true, displayName: true } },
        pc: true,
        timeLogs: { take: 20, orderBy: { startedAt: 'desc' } },
      },
    });
  }

  async updateStatus(id: string, status: string, user: any) {
    if (user.companionId !== id) throw new ForbiddenException('只能更新自己的状态');
    const now = new Date();
    // 客户端即使状态没变化，也会周期性上报状态；这里把状态上报视为有效在线心跳，
    // 避免 WebSocket 掉线但客户端仍活跃时被误判为离线。
    await this.prisma.companionPC.upsert({
      where: { companionId: id },
      create: { companionId: id, lastHeartbeat: now },
      update: { lastHeartbeat: now },
    }).catch(() => {});
    const current = await this.prisma.companion.findUnique({
      where: { id },
      select: { status: true },
    });
    // 已是当前状态：无需重复操作，直接返回，避免重置计时/计费。
    if (current && current.status === status) {
      return { id, status: current.status, alreadyInStatus: true };
    }
    // 接单状态只能由「开始服务（首单/续单/复购）」自动进入，不能手动点，防止陪玩借“接单”状态玩黑名单游戏。
    if (status === 'BUSY') {
      throw new BadRequestException('接单状态由开始服务自动进入，无法手动切换');
    }
    // 服务进行中（有已开始的会话）不允许切换到空闲/娱乐/休息等状态，必须先结束服务。
    if (status !== 'BUSY') {
      const active = await this.prisma.orderSession.findFirst({
        where: {
          OR: [{ companionId: id }, { coCompanionId: id }],
          status: 'ACTIVE',
          startedAt: { not: null },
        },
        select: { id: true },
      });
      if (active) {
        throw new BadRequestException('你正在接单，要想切换请先结束服务');
      }
    }
    // 娱乐中 / 接单中不能直接点「休息」。
    if (status === 'RESTING' && current && current.status !== 'AVAILABLE' && current.status !== 'OFFLINE') {
      throw new BadRequestException('当前状态不能直接休息，请先切回空闲');
    }

    return this.applyStatusChange(id, status, now);
  }

  /**
   * 陪玩端「无操作 60 多分钟」自动休息（老板 2026-10-04 要求：
   * 「很多陪玩怎么说都不听，经常出去吃饭或者睡觉没电休眠」）。
   *
   * 口径跟手动点「休息」完全一致（老板 2026-10-04 二次拍板：
   * 「他点娱乐中 他人就没了，该计费计费 谁让他不切换的」）：
   * **只有「空闲」会自动休息**；「娱乐中」一律拒绝 —— 人走了照常按娱乐计费，
   * 想停就自己切「休息」。「接单中」（有进行中的服务会话）同样拒绝：
   * 那一单正在给客户打，绝不能把机器自动睡过去。
   */
  async autoRestOnIdle(id: string, user: any) {
    if (user.companionId !== id) throw new ForbiddenException('只能更新自己的状态');
    const now = new Date();
    await this.prisma.companionPC
      .upsert({
        where: { companionId: id },
        create: { companionId: id, lastHeartbeat: now },
        update: { lastHeartbeat: now },
      })
      .catch(() => {});

    const current = await this.prisma.companion.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!current) throw new NotFoundException('陪玩不存在');
    // 已经是休息：当成成功（客户端重试时不要报错，也不重置计时）。
    if (current.status === 'RESTING') return { id, status: 'RESTING', alreadyInStatus: true };
    // 只有「空闲」会自动休息：娱乐中不动（老板 2026-10-04「该计费计费 谁让他不切换的」）。
    if (current.status !== 'AVAILABLE') {
      throw new BadRequestException('当前状态不能自动休息');
    }
    const active = await this.prisma.orderSession.findFirst({
      where: {
        OR: [{ companionId: id }, { coCompanionId: id }],
        status: 'ACTIVE',
        startedAt: { not: null },
      },
      select: { id: true },
    });
    if (active) throw new BadRequestException('正在接单，不能自动休息');

    return this.applyStatusChange(id, 'RESTING', now);
  }

  /**
   * 状态落库 + 维护计时日志（手动切状态和无操作自动休息共用）。
   * 关闭上一个计时日志、开新状态的，用于统计各状态时长 / 娱乐计费，
   * 然后把 Companion.status 改掉。
   */
  private async applyStatusChange(id: string, status: string, now: Date) {
    const openLog = await this.prisma.companionTimeLog.findFirst({
      where: { companionId: id, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (openLog) {
      const elapsed = Math.max(0, Math.round((now.getTime() - new Date(openLog.startedAt).getTime()) / 1000));
      await this.prisma.companionTimeLog.update({
        where: { id: openLog.id },
        data: { endedAt: now, durationSeconds: elapsed },
      });
    }
    await this.prisma.companionTimeLog.create({
      data: { companionId: id, mode: status, startedAt: now, endedAt: null, durationSeconds: 0 },
    });

    return this.prisma.companion.update({ where: { id }, data: { status } });
  }

  /** 是否有“已开始的进行中服务会话”（作为主陪或副陪）。 */
  async hasActiveServiceSession(companionId: string): Promise<boolean> {
    const session = await this.prisma.orderSession.findFirst({
      where: {
        OR: [{ companionId }, { coCompanionId: companionId }],
        status: 'ACTIVE',
        startedAt: { not: null },
      },
      select: { id: true },
    });
    return !!session;
  }

  /** 上线/心跳时解析正确的在线状态：有进行中服务 → BUSY；原本离线 → AVAILABLE；否则保持原状态。 */
  async resolvePresenceStatus(companionId: string, currentStatus?: string | null): Promise<string> {
    if (await this.hasActiveServiceSession(companionId)) return 'BUSY';
    if (!currentStatus || currentStatus === 'OFFLINE') return 'AVAILABLE';
    return currentStatus;
  }

  async getRanking(studioId: string | null, type: string, allStudios = false) {
    return this.revenueService.getRanking(studioId, type, allStudios);
  }

  async getRevenue(id: string) {
    const transactions = await this.prisma.transaction.findMany({
      where: { companionId: id, status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      companionId: id,
      transactions,
      total: transactions.reduce((s: number, t: { amount: number }) => s + t.amount, 0),
    };
  }

  /**
   * 报账口径：统一用营业日（每天 12:00 为界）。
   * 老板 2026-09-20：「每天中午 12 点前打的单、报的账都算前一天的」。
   * day 传 'YYYY-MM-DD' 表示补报那一天；不传就是当前营业日。
   */
  private getBusinessRange(day?: string): { start: Date; end: Date; day: string } {
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
      const { start, end } = businessDayRange(day);
      return { start, end, day };
    }
    const { start, end } = currentBusinessDayRange();
    return { start, end, day: businessDayKey(new Date()) };
  }

  /** 已经报过账的场次 id（报账单 description 里存了 items[].sessionId） */
  private async getReportedSessionIds(companionId: string, since: Date): Promise<Set<string>> {
    const reports = await this.prisma.expenseReport
      .findMany({
        where: { companionId, type: 'TODAY_REVENUE', createdAt: { gte: since } },
        select: { description: true },
      })
      .catch(() => [] as Array<{ description: string | null }>);
    const ids = new Set<string>();
    for (const r of reports) {
      try {
        const parsed = JSON.parse(r.description || '{}');
        for (const item of parsed?.items || []) {
          if (item?.sessionId) ids.add(item.sessionId);
        }
      } catch {
        /* 描述不是 JSON 就跳过 */
      }
    }
    return ids;
  }

  async getDormantCustomers(companionId: string) {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const all = await this.prisma.customer.findMany({
      where: { companionId },
      select: {
        id: true,
        wechatId: true,
        totalSpent: true,
        createdAt: true,
        orders: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
    });
    const dormant = all.filter((c) => {
      const lastOrder = c.orders[0]?.createdAt;
      return (!lastOrder || lastOrder < weekAgo) && new Date(c.createdAt).getTime() < Date.now() - 3 * 86400000;
    });
    return {
      total: all.length,
      dormant: dormant.length,
      list: dormant.map((c) => ({
        id: c.id,
        wechatId: c.wechatId,
        lastContact: c.orders[0]?.createdAt || c.createdAt,
      })),
    };
  }

  /**
   * 陪玩端通知偏好（老板 2026-10-01）：**只有「接单中 / 娱乐中」这两种状态能自己关**
   * （娱乐中默认弹、接单中默认不弹）；空闲 / 挂机（休息）不受这里影响、一律弹。
   */
  async getNotifyPrefs(companionId: string) {
    const c = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { notifyWhileBusy: true, notifyWhileEntertainment: true },
    });
    return {
      notifyWhileBusy: c?.notifyWhileBusy ?? false,
      notifyWhileEntertainment: c?.notifyWhileEntertainment ?? true,
    };
  }

  async setNotifyPrefs(
    companionId: string,
    prefs: { notifyWhileBusy?: boolean; notifyWhileEntertainment?: boolean },
  ) {
    const data: any = {};
    if (typeof prefs.notifyWhileBusy === 'boolean') data.notifyWhileBusy = prefs.notifyWhileBusy;
    if (typeof prefs.notifyWhileEntertainment === 'boolean')
      data.notifyWhileEntertainment = prefs.notifyWhileEntertainment;
    if (Object.keys(data).length === 0) return this.getNotifyPrefs(companionId);
    await this.prisma.companion.update({ where: { id: companionId }, data });
    return this.getNotifyPrefs(companionId);
  }

  async getTodaySessions(companionId: string, day?: string) {
    const { start, end } = this.getBusinessRange(day);
    const reportedIds = await this.getReportedSessionIds(companionId, start);
    const sessions = await this.prisma.orderSession.findMany({
      where: {
        OR: [{ companionId }, { coCompanionId: companionId }],
        createdAt: { gte: start, lt: end },
      },
      include: {
        companion: { include: { user: { select: { username: true, displayName: true } } } },
        coCompanion: { include: { user: { select: { username: true, displayName: true } } } },
        parentOrder: { select: { id: true, gameName: true, orderCode: true, customerId: true, type: true, serviceType: true, customFields: true, customer: { select: { wechatId: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((s) => {
      const isPartner = s.coCompanionId === companionId;
      const myAmount = isPartner ? (s.coAmount ?? 0) : s.amount;
      const mainName = s.companion?.user?.displayName || s.companion?.user?.username || null;
      const coName = s.coCompanion?.user?.displayName || s.coCompanion?.user?.username || null;
      const dual = !!s.coCompanionId || (s.parentOrder?.customFields as any)?.deltaCount === '双';
      const unitPrice = isPartner
        ? (s.coAmount ?? 0) / (s.duration || 1)
        : (s.claimedPrice ?? (s.duration ? s.amount / s.duration : s.amount));
      const started = s.startedAt ? new Date(s.startedAt).getTime() : null;
      const ended = s.endedAt ? new Date(s.endedAt).getTime() : (started ?? Date.now());
      const actualSec = started != null ? Math.max(0, (ended - started) / 1000 - (s.totalPausedSec || 0)) : 0;
      const actualHours = actualSec / 3600;
      const systemAmount = unitPrice * actualHours;
      return {
        id: s.id,
        reported: reportedIds.has(s.id),
        seq: s.seq,
        parentOrderId: s.parentOrder?.id,
        gameName: s.parentOrder?.gameName,
        orderCode: s.parentOrder?.orderCode,
        type: s.parentOrder?.type,
        serviceType: s.parentOrder?.serviceType || (s.parentOrder?.customFields as any)?.serviceType || 'PLAY_WITH',
        customerWechat: s.parentOrder?.customer?.wechatId || (s.parentOrder?.customFields as any)?.customerWechat || '',
        amount: s.amount,
        coAmount: s.coAmount,
        myAmount,
        isPartner,
        dual,
        duration: s.duration,
        actualHours,
        unitPrice,
        systemAmount,
        claimedMode: s.claimedMode,
        claimedPrice: unitPrice,
        transferScreenshotUrl: s.transferScreenshotUrl,
        status: s.status,
        mainName,
        coName,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        createdAt: s.createdAt,
      };
    });
  }

  /**
   * 历史没报过账的场次（最近 14 个营业日内）——用于「补报」，
   * 防止晚上 23 点接的单过零点就再也报不了。
   */
  async getUnreportedSessions(companionId: string, days = 14) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const reportedIds = await this.getReportedSessionIds(companionId, since);
    const sessions = await this.prisma.orderSession.findMany({
      where: {
        OR: [{ companionId }, { coCompanionId: companionId }],
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    const pendingIds = sessions.map((s) => s.id).filter((id) => !reportedIds.has(id));
    if (pendingIds.length === 0) return [];
    const all = await this.getSessionsByIds(companionId, pendingIds);
    return all;
  }

  private async getSessionsByIds(companionId: string, ids: string[]) {
    const sessions = await this.prisma.orderSession.findMany({
      where: { id: { in: ids } },
      include: {
        companion: { include: { user: { select: { username: true, displayName: true } } } },
        coCompanion: { include: { user: { select: { username: true, displayName: true } } } },
        parentOrder: {
          select: {
            id: true,
            gameName: true,
            orderCode: true,
            customerId: true,
            type: true,
            serviceType: true,
            customFields: true,
            customer: { select: { wechatId: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((s) => {
      const isPartner = s.coCompanionId === companionId;
      const myAmount = isPartner ? (s.coAmount ?? 0) : s.amount;
      const unitPrice = isPartner
        ? (s.coAmount ?? 0) / (s.duration || 1)
        : (s.claimedPrice ?? (s.duration ? s.amount / s.duration : s.amount));
      const started = s.startedAt ? new Date(s.startedAt).getTime() : null;
      const ended = s.endedAt ? new Date(s.endedAt).getTime() : (started ?? Date.now());
      const actualSec = started != null ? Math.max(0, (ended - started) / 1000 - (s.totalPausedSec || 0)) : 0;
      const mainName = s.companion?.user?.displayName || s.companion?.user?.username || null;
      const coName = s.coCompanion?.user?.displayName || s.coCompanion?.user?.username || null;
      return {
        id: s.id,
        seq: s.seq,
        reported: false,
        mainName,
        coName,
        parentOrderId: s.parentOrder?.id,
        gameName: s.parentOrder?.gameName,
        orderCode: s.parentOrder?.orderCode,
        type: s.parentOrder?.type,
        serviceType: s.parentOrder?.serviceType || (s.parentOrder?.customFields as any)?.serviceType || 'PLAY_WITH',
        customerWechat: s.parentOrder?.customer?.wechatId || (s.parentOrder?.customFields as any)?.customerWechat || '',
        amount: s.amount,
        coAmount: s.coAmount,
        myAmount,
        isPartner,
        dual: !!s.coCompanionId || (s.parentOrder?.customFields as any)?.deltaCount === '双',
        duration: s.duration,
        actualHours: actualSec / 3600,
        unitPrice,
        systemAmount: unitPrice * (actualSec / 3600),
        claimedMode: s.claimedMode,
        claimedPrice: unitPrice,
        transferScreenshotUrl: s.transferScreenshotUrl,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        createdAt: s.createdAt,
      };
    });
  }

  /**
   * 本营业月「只算自己那份」的流水（老板 2026-10-07 口径 A；2026-10-08 老板再确认「只算自己」）。
   *
   * 拆成 primary / co / split 三块给陪玩端首页摊开显示 —— 他当**搭档**挣的那份是他自己的（实打实到手的钱），
   * 而**搭档（别人）那份永远不进他的数**：主陪只拿自己那格填的「主陪金额」、搭档只拿「搭档金额」。
   */
  private async computeMonthRevenue(
    companionId: string,
  ): Promise<{ total: number; primary: number; co: number; split: number }> {
    const { start, end } = currentSettlementMonthRange();
    const orders = await this.prisma.order.findMany({
      where: {
        status: 'DONE',
        createdAt: { gte: start, lt: end },
        OR: [{ companionId }, { coCompanionId: companionId }],
      },
      select: { amount: true, coAmount: true, companionId: true, coCompanionId: true, customFields: true },
    });
    const parts = companionMonthRevenueParts(orders, companionId);
    return {
      total: roundToJiao(parts.total),
      primary: roundToJiao(parts.primary),
      co: roundToJiao(parts.co),
      split: roundToJiao(parts.split),
    };
  }

  async getWorkbench(companionId: string) {
    const { start: today, end: tomorrow } = currentBusinessDayRange();

    // 今日流水（老板 2026-10-07「口径 A：谁的钱算谁的」）：主陪算「主陪金额」、搭档算
    // 「搭档金额」，他当搭档打的那份也进今日流水。以前只查 companionId（他自己当主陪的单），
    // 当搭档挣的一分不加，同一天「今日」和「本月」两个数就对不上。
    const todayOrders = await this.prisma.order.findMany({
      where: {
        status: 'DONE',
        createdAt: { gte: today, lt: tomorrow },
        OR: [{ companionId }, { coCompanionId: companionId }],
      },
      select: { companionId: true, coCompanionId: true, amount: true, coAmount: true, customFields: true },
    });
    const todayRevenue = todayOrders.reduce((s, o) => s + companionOrderRevenue(o as any, companionId), 0);

    // 订单分型（口径 A：主陪算「主陪金额」、搭档算「搭档金额」；他当搭档打的那份也算他自己打过的单）
    // 范围 = 本营业月（当月 1 日 12:00 至次月 1 日 12:00），跟顶上「本月流水」是同一批单。
    const { start: monthTypeStart, end: monthTypeEnd } = currentSettlementMonthRange();
    const typeOrders = await this.prisma.order.findMany({
      where: {
        status: 'DONE',
        createdAt: { gte: monthTypeStart, lt: monthTypeEnd },
        OR: [{ companionId }, { coCompanionId: companionId }],
      },
      select: {
        type: true,
        createdAt: true,
        companionId: true,
        coCompanionId: true,
        amount: true,
        coAmount: true,
        customFields: true,
      },
    });
    const orderStats = ['NEW', 'RENEW', 'REPURCHASE', 'TIP'].map((type) => {
      const rows = typeOrders.filter((o) => o.type === type);
      return {
        type,
        count: rows.length,
        amount: rows.reduce((s, o) => s + companionOrderRevenue(o as any, companionId), 0),
      };
    });
    const totalCount = orderStats.reduce((s, o) => s + o.count, 0);
    const statsMap: Record<string, any> = {};
    orderStats.forEach(({ type, count, amount }) => {
      statsMap[type] = {
        count,
        amount: roundToJiao(amount),
        ratio: totalCount > 0 ? Math.round((count / totalCount) * 100) : 0,
      };
    });

    // Today's order type breakdown（营业日 12:00 至次日 12:00；口径同上）
    const { start: todayStart, end: todayEnd } = currentBusinessDayRange();
    const todayTypeOrders = typeOrders.filter((o) => o.createdAt >= todayStart && o.createdAt < todayEnd);
    const todayStats: Record<string, any> = {};
    ['NEW', 'RENEW', 'REPURCHASE', 'TIP'].forEach((t) => {
      const rows = todayTypeOrders.filter((o) => o.type === t);
      todayStats[t] = {
        count: rows.length,
        amount: roundToJiao(rows.reduce((s, o) => s + companionOrderRevenue(o as any, companionId), 0)),
      };
    });
    const todayTotal = Object.values(todayStats).reduce((s: number, v: any) => s + v.amount, 0);
    Object.keys(todayStats).forEach((k) => {
      todayStats[k].ratio = todayTotal > 0 ? Math.round((todayStats[k].amount / todayTotal) * 100) : 0;
    });

    // Fetch today's budan/notes in one query
    const todayBudanOrders = await this.prisma.order.findMany({
      where: { companionId, status: 'DONE', createdAt: { gte: todayStart, lte: todayEnd } },
      select: { customFields: true, notes: true },
    });
    // 阈值配置：按「本店店长填的 → 老板全局默认 → 代码兜底」解析
    const studioRow = await this.prisma.companion
      .findUnique({ where: { id: companionId }, select: { studioId: true } })
      .catch(() => null);
    const workbenchStudioId = studioRow?.studioId;
    const scopedCfg = await resolveConfigsRaw(this.prisma, workbenchStudioId, [
        'revenue.free_threshold',
        'entertainment.revenue_threshold',
      'entertainment.deposit_threshold',
      'revenue.unlock_threshold',
    ]);
    const unlockThreshold = (scopedCfg['revenue.unlock_threshold'] as number) ?? 200;
    const freeThreshold = (scopedCfg['revenue.free_threshold'] as number) ?? 300;
    const entertainmentThreshold = (scopedCfg['entertainment.revenue_threshold'] as number) ?? 200;
    const entertainmentDepositThreshold = (scopedCfg['entertainment.deposit_threshold'] as number) ?? 500;

    // Time logs for today
    const timeLogs = await this.prisma.companionTimeLog.findMany({
      where: {
        companionId,
        startedAt: { gte: today },
      },
    });

    const durations = { entertainment: 0, work: 0, idle: 0, rest: 0 };
    for (const log of timeLogs) {
      const seconds = log.durationSeconds || 0;
      if (log.mode === 'ENTERTAINMENT') durations.entertainment += seconds;
      else if (log.mode === 'WORK') durations.work += seconds;
      else if (log.mode === 'IDLE') durations.idle += seconds;
      else durations.rest += seconds;
    }

    const formatDuration = (sec: number) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    const entertainmentMinutes = Math.floor(durations.entertainment / 60);
    const { hourlyRate } = await loadEntertainmentRule(this.prisma, workbenchStudioId);
    // 老板 2026-10-04：「打存单也算在娱乐那个门槛里」——
    // 门槛看「今天到手的钱」：订单流水 + 今天打掉的存单（存单常加在老的续单上，订单取数算不到今天）。
    const depositPlayedMap = await sumDepositPlayedToday(this.prisma, [companionId], {
      start: todayStart,
      end: todayEnd,
    });
    const todayDepositPlayed = depositPlayedMap.get(companionId) || 0;
    const entertainmentBasis = entertainmentBasisRevenue(todayRevenue, todayDepositPlayed);
    // 娱乐随时可进：门槛内免费，否则按小时计费（报账时体现）。
    // 算法统一在 common/entertainment-fee.ts，跟看板、搭档结算、余额预警同一套。
    const entertainmentFee = computeEntertainmentFee({
      minutes: durations.entertainment / 60,
      todayRevenue: entertainmentBasis,
      hourlyRate,
      freeThreshold: entertainmentThreshold,
    });

    // Online companions (same studio) — also fetch split mode info
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: {
        studioId: true,
        status: true,
        monthlyRevenue: true,
        revenueShare: true,
        createdAt: true,
        isSeniorStaff: true,
        studio: { select: { splitMode: true } },
      },
    });
    const onlineCompanions = await this.prisma.companion.findMany({
      where: { studioId: companion?.studioId, status: { in: ['AVAILABLE', 'BUSY', 'ENTERTAINMENT'] } },
      select: {
        id: true,
        status: true,
        user: { select: { username: true, avatar: true, displayName: true } },
      },
    });

    // Compute split mode display info
    const splitMode = companion?.studio?.splitMode ?? 'TIERED';
    let tierInfo: {
      mode: string;
      companionPct?: number;
      monthlyRevenue?: number;
      tiers?: RevenueSplitTier[];
      tenureMonths?: number;
      topTierBlocked?: boolean;
    } = { mode: splitMode };

    // 本营业月业绩（口径 A，个人视角，只算自己那份）——分成阶梯与「订单占比 → 全月」共用这一份，只查一次
    const monthRev = await this.computeMonthRevenue(companionId);
    const monthRevenue = monthRev.total;

    if (splitMode === 'FIXED') {
      tierInfo = {
        mode: 'FIXED',
        companionPct: Math.round((companion?.revenueShare ?? 0.6) * 100),
        // 固定分成也要给「本月流水」：以前这里没给，陪玩端就退回「最近 30 天流水」那个兜底 ——
        // 同一个「本月流水」在固定分成的工作室显示的是 30 天的数（还把上个月的钱也算进来了，
        // 老板 2026-10-08 问「本月流水你把别人的加进去干啥」）。
        monthlyRevenue: monthRevenue,
      };
    } else {
      // TIERED：严格按营业月流水计算当前所在阶梯
      // 分成阶梯也按店解析（线上上活的就是这一处）
      const tiersCfg = await resolveConfigsRaw(this.prisma, companion?.studioId, [
        'revenue.share_tiers',
      ]);
      const tiers: RevenueSplitTier[] = (tiersCfg['revenue.share_tiers'] as any) ?? [];
      if (monthRevenue > 0) {
        const tenureMonths = effectiveTenureMonths(companion!.createdAt, companion!.isSeniorStaff);
        const topTier = tiers.find((t) => t.max === null) || tiers[tiers.length - 1];
        const topTierBlocked =
          topTier != null && monthRevenue >= topTier.min && tenureMonths < 6;
        const splitResult = computeRevenueSplit({
          splitMode,
          totalRevenue: monthRevenue,
          revenueShare: companion?.revenueShare,
          tiers: tiers.length > 0 ? tiers : undefined,
          monthlyRevenue: monthRevenue,
          tenureMonths,
        });
        tierInfo = {
          mode: splitResult.mode,
          companionPct: splitResult.companionPct,
          monthlyRevenue: splitResult.monthlyRevenue,
          tiers,
          tenureMonths,
          topTierBlocked,
        };
      } else {
        const tenureMonths = effectiveTenureMonths(companion!.createdAt, companion!.isSeniorStaff);
        tierInfo = {
          mode: 'TIERED',
          companionPct: tiers[0]?.companion ?? 50,
          monthlyRevenue: 0,
          tiers,
          tenureMonths,
          topTierBlocked: false,
        };
      }
    }

    // Total revenue and balance for entertainment fee check
    const totalRevenue = await this.prisma.transaction.aggregate({
      where: { companionId, status: 'APPROVED' },
      _sum: { amount: true },
    });
    const totalRev = totalRevenue._sum.amount || 0;
    const wallet = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { balance: true, deposit: true },
    });
    const availableFunds = (wallet?.balance || 0) + (wallet?.deposit || 0);
    const buffer30min = Math.round((hourlyRate / 2) * 100) / 100; // half-hour cost
    const feeBalanceWarning = entertainmentFee >= availableFunds - buffer30min;
    const feeBalanceAlert = entertainmentFee >= availableFunds;

    // Analytics: contact conversion rates
    // 微信添加成功率 = 已添加 ÷ (抢单数+补单数) = added / monthlyAll
    // 转化率 = 添加完成数量 ÷ 开始服务数量 = (added+DONE) / (CONFIRMED+DONE)
    const [addedCount, convertedCount, startedCount, monthlyAll] = await Promise.all([
      this.prisma.order.count({ where: { companionId, contactStatus: 'added' } }),
      this.prisma.order.count({ where: { companionId, contactStatus: 'added', status: 'DONE' } }),
      this.prisma.order.count({ where: { companionId, status: { in: ['CONFIRMED', 'DONE'] } } }),
      this.prisma.order.count({
        where: {
          companionId,
          status: { not: 'CANCELLED' },
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
    ]);
    const wechatAddRate = monthlyAll > 0 ? Math.round((addedCount / monthlyAll) * 100) : 0;
    const conversionRate = startedCount > 0 ? Math.round((convertedCount / startedCount) * 100) : 0;
    // 续单率 / 复购率跟评分系统用同一份口径（按客户算 + 最近 30 天）。
    // 这里原来按「订单类型」算，而线上几乎没人点「续单 / 复购」按钮（全库 0 条续单、1 条复购），
    // 结果陪玩端会出现「评分说明写 85%、看板写 0%」两套数（老板 2026-10-04 定稿口径时一起收口）。
    const scoreNow = await this.excellence.computeOne(companionId).catch(() => null);
    const renewRate = scoreNow?.renewRate ?? 0;
    const repurchaseRate = scoreNow?.repurchaseRate ?? 0;

    return {
      todayRevenue: roundToJiao(todayRevenue),
      // 本营业月流水（口径 A，只算自己那份）：跟 orderStats 各分型金额之和一致，「订单占比 → 全月」标题用这个
      monthRevenue: roundToJiao(monthRevenue),
      // 同一笔钱拆开（当主陪 / 当搭档 / 跨店分成）—— 首页摊开显示给陪玩看，明说「搭档的钱不算在里面」
      monthRevenueParts: { primary: monthRev.primary, co: monthRev.co, split: monthRev.split },
      orderStats: statsMap,
      todayStats,
      totalCount,
      unlockThreshold,
      isUnlocked: todayRevenue >= unlockThreshold,
      freeThreshold,
      entertainmentMinutes,
      entertainmentFee,
      hourlyRate,
      // 娱乐门槛口径（老板 2026-10-04）：订单流水 + 今天打掉的存单
      todayDepositPlayed: roundToJiao(todayDepositPlayed),
      entertainmentBasis: roundToJiao(entertainmentBasis),
      entertainmentFreeToday: isEntertainmentFree(entertainmentBasis, entertainmentThreshold),
      totalRevenue: roundToJiao(totalRev),
      availableFunds: roundToJiao(availableFunds),
      feeBalanceWarning,
      feeBalanceAlert,
      entertainmentThreshold,
      entertainmentDepositThreshold,
      isEntertainmentUnlocked: true,
      // New analytics metrics
      todayOrderCount: todayBudanOrders.length,
      monthlyOrderCount: monthlyAll,
      wechatAddRate,
      conversionRate,
      renewRate,
      repurchaseRate,
      todayBudanCount: todayBudanOrders.filter((o) =>
        (((o.customFields as Record<string, unknown> | null)?.deltaNote as string) || o.notes || '').includes('补单'),
      ).length,
      currentStatus: companion?.status ?? 'OFFLINE',
      splitMode,
      tierInfo,
      statusDurations: {
        entertainment: formatDuration(durations.entertainment),
        work: formatDuration(durations.work),
        idle: formatDuration(durations.idle),
        rest: formatDuration(durations.rest),
      },
      onlineCompanions,
    };
  }

  async getWallet(companionId: string) {
    return this.revenueService.getWallet(companionId);
  }

  // ── 报账微信码（老板 2026-09-29）──────────────────────────────────────────
  // 「每个陪玩在报账那里给他留个位置，让陪玩自己上传自己的报账微信码，
  //   每次报账点开这个码，拿手机扫一扫就可以了。」
  // 所以收款码挂在陪玩档案上（Companion.payoutQrUrl）：陪玩自己传一次，财务在
  // 「陪玩审核 + 支取」「报账与支取统计」里点开就能扫，不用每次在群里要图。

  /** 我（陪玩）的报账微信码 */
  async getMyPayoutQr(companionId: string) {
    if (!companionId) throw new ForbiddenException('只有陪玩能设置自己的报账微信码');
    const row = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { id: true, payoutQrUrl: true, payoutQrUpdatedAt: true },
    });
    if (!row) throw new NotFoundException('陪玩不存在');
    return { payoutQrUrl: row.payoutQrUrl || null, payoutQrUpdatedAt: row.payoutQrUpdatedAt || null };
  }

  /** 上传 / 更换我（陪玩）的报账微信码 */
  async setMyPayoutQr(companionId: string, url?: string | null) {
    if (!companionId) throw new ForbiddenException('只有陪玩能设置自己的报账微信码');
    const clean = (url || '').trim();
    if (!clean) throw new BadRequestException('请先上传收款码图片');
    if (!/^(https?:\/\/|\/)\S+$/.test(clean)) {
      throw new BadRequestException('收款码地址不合法');
    }
    const row = await this.prisma.companion.update({
      where: { id: companionId },
      data: { payoutQrUrl: clean, payoutQrUpdatedAt: new Date() },
      select: { payoutQrUrl: true, payoutQrUpdatedAt: true },
    });
    return { payoutQrUrl: row.payoutQrUrl, payoutQrUpdatedAt: row.payoutQrUpdatedAt };
  }

  // Check if companion can enter entertainment mode: needs undrawn balance > 0
  async checkEntertainmentBlocked(companionId: string) {
    return this.revenueService.checkEntertainmentBlocked(companionId);
  }

  async requestWithdraw(companionId: string, amount: number, note?: string) {
    const wallet = await this.getWallet(companionId);
    if (amount > wallet.withdrawable) {
      throw new ForbiddenException(`可支取金额不足，当前可支取: ¥${wallet.withdrawable}`);
    }
    const studioRow = await this.prisma.companion
      .findUnique({ where: { id: companionId }, select: { studioId: true } })
      .catch(() => null);
    const [scopedLimit, usedCount] = await Promise.all([
      resolveConfigsRaw(this.prisma, studioRow?.studioId ?? null, ['withdraw.monthly_limit']),
      this.prisma.walletTransaction.count({
        where: {
          companionId,
          type: 'WITHDRAW',
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            lt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
          },
        },
      }),
    ]);
    const limit = Number(scopedLimit['withdraw.monthly_limit'] ?? 2);
    if (limit > 0 && usedCount >= limit) {
      throw new ForbiddenException(`本月支取次数已达上限（${limit} 次）`);
    }
    return this.prisma.walletTransaction.create({
      data: {
        companionId,
        type: 'WITHDRAW',
        amount,
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance,
        status: 'PENDING',
        note: note?.trim() || undefined,
      },
    });
  }

  // TASK-08: No-customer proof upload (creates expense report for review)
  async requestProofNoCustomer(companionId: string, note: string) {
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { studioId: true },
    });
    if (!companion?.studioId) throw new Error('未找到工作室');
    return this.prisma.expenseReport.create({
      data: {
        companionId,
        studioId: companion.studioId,
        type: 'NO_CUSTOMER_PROOF',
        amount: 0,
        description: note,
        status: 'PENDING',
      },
    });
  }

  // ── Resignation ──

  /**
   * 陪玩离职：清账 + 释放工位与工作微信 + 停用账号。
   * 具体动作统一收在 StudiosService.resignEmployee（客服/店长离职走同一条路），
   * 这里只做「陪玩 id → 用户 id」的转换，避免两处逻辑漂移。
   */
  async resignCompanion(companionId: string) {
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { userId: true },
    });
    if (!companion) return { success: false };
    return this.studiosService.resignEmployee(companion.userId);
  }

  // ── Work WeChat Management ──

  async listWorkWechats(studioId: string, user?: any) {
    return this.wechatService.listWorkWechats(studioId, user);
  }

  async addWorkWechat(studioId: string, wechatId: string, type?: string) {
    return this.wechatService.addWorkWechat(studioId, wechatId, type);
  }

  async updateWorkWechatNickname(id: string, nickname: string, user?: any) {
    return this.wechatService.updateWorkWechatNickname(id, nickname, user);
  }

  async bindWechat(id: string, companionId: string) {
    return this.wechatService.bindWechat(id, companionId);
  }

  async unbindWechat(id: string) {
    return this.wechatService.unbindWechat(id);
  }

  async bindCsUser(id: string, csUserId: string) {
    return this.wechatService.bindCsUser(id, csUserId);
  }

  async unbindCsUser(id: string) {
    return this.wechatService.unbindCsUser(id);
  }

  async deleteWorkWechat(id: string, user?: any) {
    return this.wechatService.deleteWorkWechat(id, user);
  }

  // ── 陪玩自己提交工作微信 + 管理端审核（老板 2026-10-02）──

  async getMyWorkWechat(companionId: string) {
    return this.wechatService.getMyWorkWechat(companionId);
  }

  async submitMyWorkWechat(companionId: string, wechatId?: string | null) {
    return this.wechatService.submitMyWorkWechat(companionId, wechatId);
  }

  async listWorkWechatRequests(studioId: string, status?: string, opts?: { allStudios?: boolean }) {
    return this.wechatService.listWorkWechatRequests(studioId, status, opts);
  }

  async countPendingWorkWechatRequests(studioId: string) {
    return this.wechatService.countPendingWorkWechatRequests(studioId);
  }

  async approveWorkWechatRequest(id: string, reviewerId?: string) {
    return this.wechatService.approveWorkWechatRequest(id, reviewerId);
  }

  async rejectWorkWechatRequest(id: string, reason?: string, reviewerId?: string) {
    return this.wechatService.rejectWorkWechatRequest(id, reason, reviewerId);
  }

  // ── Attendance ──

  async ensureAttendance(companionId: string) {
    return this.attendanceService.ensureAttendance(companionId);
  }

  async finalizeAttendance(companionId: string) {
    return this.attendanceService.finalizeAttendance(companionId);
  }

  async getAttendance(filters: { companionId?: string; dateFrom?: string; dateTo?: string }) {
    return this.attendanceService.getAttendance(filters);
  }

  /** 客服 / 店长考勤（老板 2026-10-04：这三个职位都要考勤，各自能单独开关）。 */
  async ensureStaffAttendance(userId: string, role: string) {
    return this.attendanceService.ensureStaffAttendance(userId, role);
  }

  async finalizeStaffAttendance(userId: string, role: string) {
    return this.attendanceService.finalizeStaffAttendance(userId, role);
  }

  async getStaffAttendance(filters: {
    studioId?: string | null;
    userId?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    return this.attendanceService.getStaffAttendance(filters);
  }

  /** 今日考勤汇总（运营看板用：谁迟到、谁早退、谁没打卡）。 */
  async getAttendanceToday(studioId: string | null) {
    return this.attendanceService.summarizeToday(studioId);
  }

  /** 我（陪玩）今天的考勤（陪玩端首页用）。 */
  async getMyAttendanceToday(companionId: string) {
    return this.attendanceService.myToday(companionId);
  }

  // ── Status Blacklist CRUD ──
  async getStatusBlacklist(studioId: string, status: string) {
    return this.prisma.companionStatusBlacklist.findMany({
      where: { studioId, status },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addStatusBlacklist(studioId: string, status: string, processName: string, displayName?: string) {
    return this.prisma.companionStatusBlacklist.create({
      data: { studioId, status, processName, displayName: displayName || null },
    });
  }

  async removeStatusBlacklist(id: string) {
    return this.prisma.companionStatusBlacklist.delete({ where: { id } });
  }

  async listStatusBlacklists(studioId: string) {
    studioId = await this.resolveStudioId(studioId);
    return this.prisma.companionStatusBlacklist.findMany({
      where: { studioId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 老板（OWNER）没有 studioId 时，默认落到第一个工作室。 */
  private async resolveStudioId(studioId: string): Promise<string> {
    if (studioId) return studioId;
    const first = await this.prisma.studio.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    return first?.id || '';
  }

  // ── Manual financial adjustment (ADMIN/OWNER) ──
  async updateFinance(
    companionId: string,
    data: {
      todayRevenue?: number;
      totalRevenue?: number;
      totalWithdrawn?: number;
      pendingWithdraw?: number;
      withdrawable?: number;
      deposit?: number;
      note?: string;
    },
    operatorId: string,
  ) {
    const note = data.note || '管理员手动调整';
    const logs: Promise<any>[] = [];

    if (data.totalRevenue !== undefined) {
      const cur = await this.prisma.companion.findUnique({
        where: { id: companionId },
        select: { monthlyRevenue: true },
      });
      const old = cur?.monthlyRevenue || 0;
      await this.prisma.companion.update({ where: { id: companionId }, data: { monthlyRevenue: data.totalRevenue } });
      logs.push(
        this.prisma.walletTransaction.create({
          data: {
            companionId,
            type: 'SETTLEMENT',
            amount: data.totalRevenue - old,
            balanceBefore: old,
            balanceAfter: data.totalRevenue,
            note,
            reviewedById: operatorId,
            status: 'APPROVED',
          },
        }),
      );
    }

    if (data.totalWithdrawn !== undefined) {
      const agg = await this.prisma.walletTransaction.aggregate({
        where: { companionId, type: 'WITHDRAW', status: 'APPROVED' },
        _sum: { amount: true },
      });
      const cur = agg._sum.amount || 0;
      const diff = data.totalWithdrawn - cur;
      if (diff !== 0)
        logs.push(
          this.prisma.walletTransaction.create({
            data: {
              companionId,
              type: 'WITHDRAW',
              amount: diff,
              balanceBefore: cur,
              balanceAfter: data.totalWithdrawn,
              note,
              reviewedById: operatorId,
              status: 'APPROVED',
            },
          }),
        );
    }

    if (data.pendingWithdraw !== undefined) {
      const agg = await this.prisma.walletTransaction.aggregate({
        where: { companionId, type: 'WITHDRAW', status: 'PENDING' },
        _sum: { amount: true },
      });
      const cur = agg._sum.amount || 0;
      const diff = data.pendingWithdraw - cur;
      if (diff !== 0)
        logs.push(
          this.prisma.walletTransaction.create({
            data: {
              companionId,
              type: 'WITHDRAW',
              amount: diff,
              balanceBefore: cur,
              balanceAfter: data.pendingWithdraw,
              note,
              reviewedById: operatorId,
              status: 'PENDING',
            },
          }),
        );
    }

    if (data.withdrawable !== undefined) {
      const cur = await this.prisma.companion.findUnique({ where: { id: companionId }, select: { balance: true } });
      const old = cur?.balance || 0;
      await this.prisma.companion.update({ where: { id: companionId }, data: { balance: data.withdrawable } });
      logs.push(
        this.prisma.walletTransaction.create({
          data: {
            companionId,
            type: 'SETTLEMENT',
            amount: data.withdrawable - old,
            balanceBefore: old,
            balanceAfter: data.withdrawable,
            note: note + ' (待支取)',
            reviewedById: operatorId,
            status: 'APPROVED',
          },
        }),
      );
    }

    if (data.deposit !== undefined) {
      const cur = await this.prisma.companion.findUnique({ where: { id: companionId }, select: { deposit: true } });
      const old = cur?.deposit || 0;
      await this.prisma.companion.update({ where: { id: companionId }, data: { deposit: data.deposit } });
      logs.push(
        this.prisma.walletTransaction.create({
          data: {
            companionId,
            type: 'DEPOSIT',
            amount: data.deposit - old,
            balanceBefore: old,
            balanceAfter: data.deposit,
            note,
            reviewedById: operatorId,
            status: 'APPROVED',
          },
        }),
      );
    }

    await Promise.all(logs);
    return { success: true };
  }

  /** 手动标记/取消老员工（跳过 6 个月工龄门槛）。 */
  async setSeniorStaff(companionId: string, isSeniorStaff: boolean) {
    return this.prisma.companion.update({
      where: { id: companionId },
      data: { isSeniorStaff },
    });
  }
}
