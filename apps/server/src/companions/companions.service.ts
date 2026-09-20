// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeRevenueSplit, effectiveTenureMonths } from '../common/revenue-calculator';
import type { RevenueSplitTier } from '../common/revenue-calculator';
import {
  businessDayKey,
  businessDayRange,
  currentBusinessDayRange,
  currentSettlementMonthRange,
} from '../common/business-day';
import { companionOrderRevenue } from '../common/order-revenue';
import { computeEntertainmentFee, loadEntertainmentRule } from '../common/entertainment-fee';
import { roundToJiao } from '../common/money';
import { CompanionRevenueService } from './companion-revenue.service';
import { CompanionAttendanceService } from './companion-attendance.service';
import { CompanionWechatService } from './companion-wechat.service';
import { ExcellenceService } from './excellence.service';
import { BridgeService } from '../studios/bridge.service';

@Injectable()
export class CompanionsService {
  constructor(
    private prisma: PrismaService,
    private readonly revenueService: CompanionRevenueService,
    private readonly attendanceService: CompanionAttendanceService,
    private readonly wechatService: CompanionWechatService,
    private readonly excellence: ExcellenceService,
    private readonly bridgeService: BridgeService,
  ) {}

  /** 人员列表：陪玩 + 客服 + 店长 + 老板，统一返回，附带各自的在线状态。 */
  async listPersonnel(user: any, includeBridged = false) {
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

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        role: true,
        displayName: true,
        avatar: true,
        isAuthorized: true,
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

    return users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      displayName: u.displayName,
      avatar: u.avatar,
      isAuthorized: u.isAuthorized,
      studioId: u.studio?.id ?? null,
      studioName: u.studio?.name ?? null,
      studioType: u.studio?.type ?? null,
      companionId: u.companion?.id ?? null,
      status: u.companion?.status ?? null,
      games: u.companion?.games ?? [],
      realName: u.companion?.realName ?? null,
      phone: u.companion?.phone ?? null,
      monthlyRevenue: u.companion?.monthlyRevenue ?? null,
      isResigned: u.companion?.isResigned ?? false,
      isSeniorStaff: u.companion?.isSeniorStaff ?? false,
      lastHeartbeat: u.companion?.pc?.lastHeartbeat ?? csSeen.get(u.id) ?? null,
      currentMode: u.companion?.pc?.currentMode ?? null,
      currentOrder: u.companion ? activeOrderByCompanion.get(u.companion.id) ?? null : null,
      isExcellent: u.companion ? excellence.get(u.companion.id)?.isExcellent ?? false : false,
      tier: u.companion ? excellence.get(u.companion.id)?.tier ?? 'MIDDLE' : 'MIDDLE',
      rankScore: u.companion ? excellence.get(u.companion.id)?.rankScore ?? 0 : 0,
      renewRate: u.companion ? excellence.get(u.companion.id)?.renewRate ?? 0 : 0,
      repurchaseRate: u.companion ? excellence.get(u.companion.id)?.repurchaseRate ?? 0 : 0,
      orderCount: u.companion ? excellence.get(u.companion.id)?.orderCount ?? 0 : 0,
    }));
  }

  async findAll(user: any, includeBridged = false) {
    const where: any = {};
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
      processStatus: blockedSet.has(c.id) ? 'BLOCKED' : (killMap.get(c.id) || 0) >= 1 ? 'WARNING' : 'NORMAL',
      todayOrderCount: (orderCounts.get(c.id) || 0) + (budanCounts.get(c.id) || 0),
      tier: excellence.get(c.id)?.tier ?? 'MIDDLE',
      rankScore: excellence.get(c.id)?.rankScore ?? 0,
    }));
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

    // 关闭上一个计时日志，并开启新状态的计时日志（用于统计各状态时长/娱乐计费）。
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

    const updated = await this.prisma.companion.update({ where: { id }, data: { status } });
    return updated;
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

  async getRanking(studioId: string, type: string) {
    return this.revenueService.getRanking(studioId, type);
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

  /** 陪玩端通知偏好：打单 / 娱乐中是否也弹新单（默认不打扰） */
  async getNotifyPrefs(companionId: string) {
    const c = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { notifyWhileBusy: true },
    });
    return { notifyWhileBusy: c?.notifyWhileBusy ?? false };
  }

  async setNotifyPrefs(companionId: string, prefs: { notifyWhileBusy?: boolean }) {
    const data: any = {};
    if (typeof prefs.notifyWhileBusy === 'boolean') data.notifyWhileBusy = prefs.notifyWhileBusy;
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

  private async computeMonthRevenue(companionId: string): Promise<number> {
    const { start, end } = currentSettlementMonthRange();
    const orders = await this.prisma.order.findMany({
      where: {
        status: 'DONE',
        createdAt: { gte: start, lt: end },
        OR: [{ companionId }, { coCompanionId: companionId }],
      },
      select: { amount: true, coAmount: true, companionId: true, coCompanionId: true, customFields: true },
    });
    return orders.reduce((sum, o) => sum + companionOrderRevenue(o, companionId), 0);
  }

  async getWorkbench(companionId: string) {
    const { start: today, end: tomorrow } = currentBusinessDayRange();

    // Today's revenue from completed orders
    const todayOrders = await this.prisma.order.findMany({
      where: {
        companionId,
        status: 'DONE',
        createdAt: { gte: today, lt: tomorrow },
      },
    });
    const todayRevenue = todayOrders.reduce((s, o) => s + o.amount, 0);

    // Order type breakdown (single query with groupBy)
    const typeStats = await this.prisma.order.groupBy({
      by: ['type'],
      where: { companionId, status: 'DONE' },
      _sum: { amount: true },
      _count: { id: true },
    });
    const orderStats = ['NEW', 'RENEW', 'REPURCHASE', 'TIP'].map((type) => {
      const row = typeStats.find((r) => r.type === type);
      return { type, count: row?._count?.id ?? 0, amount: row?._sum?.amount ?? 0 };
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

    // Today's order type breakdown（营业日 12:00 至次日 12:00）
    const { start: todayStart, end: todayEnd } = currentBusinessDayRange();
    const todayTypeStats = await this.prisma.order.groupBy({
      by: ['type'],
      where: { companionId, status: 'DONE', createdAt: { gte: todayStart, lt: todayEnd } },
      _sum: { amount: true },
      _count: { id: true },
    });
    const todayStats: Record<string, any> = {};
    ['NEW', 'RENEW', 'REPURCHASE', 'TIP'].forEach((t) => {
      const row = todayTypeStats.find((r) => r.type === t);
      todayStats[t] = { count: row?._count?.id ?? 0, amount: roundToJiao(row?._sum?.amount ?? 0) };
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
    // Config thresholds
    const [unlockCfg, freeCfg, entRevenueCfg, entDepositCfg] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'revenue.unlock_threshold' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'revenue.free_threshold' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'entertainment.revenue_threshold' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'entertainment.deposit_threshold' } }),
    ]);
    const unlockThreshold = (unlockCfg?.value as number) ?? 200;
    const freeThreshold = (freeCfg?.value as number) ?? 300;
    const entertainmentThreshold = (entRevenueCfg?.value as number) ?? 200;
    const entertainmentDepositThreshold = (entDepositCfg?.value as number) ?? 500;

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
    const { hourlyRate } = await loadEntertainmentRule(this.prisma);
    // 娱乐随时可进：当日流水 ≥ 门槛则免费，否则按小时计费（报账时体现）。
    // 算法统一在 common/entertainment-fee.ts，跟看板、搭档结算、余额预警同一套。
    const entertainmentFee = computeEntertainmentFee({
      minutes: durations.entertainment / 60,
      todayRevenue,
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

    if (splitMode === 'FIXED') {
      tierInfo = {
        mode: 'FIXED',
        companionPct: Math.round((companion?.revenueShare ?? 0.6) * 100),
      };
    } else {
      // TIERED：严格按营业月流水计算当前所在阶梯
      const monthRevenue = await this.computeMonthRevenue(companionId);
      const config = await this.prisma.systemConfig.findUnique({
        where: { key: 'revenue.share_tiers' },
      });
      const tiers: RevenueSplitTier[] = (config?.value as any) ?? [];
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
    const renewRate = statsMap.RENEW?.ratio || 0;
    const repurchaseRate = statsMap.REPURCHASE?.ratio || 0;

    return {
      todayRevenue: roundToJiao(todayRevenue),
      orderStats: statsMap,
      todayStats,
      totalCount,
      unlockThreshold,
      isUnlocked: todayRevenue >= unlockThreshold,
      freeThreshold,
      entertainmentMinutes,
      entertainmentFee,
      hourlyRate,
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

  // Check if companion can enter entertainment mode: needs undrawn balance > 0
  async checkEntertainmentBlocked(companionId: string) {
    return this.revenueService.checkEntertainmentBlocked(companionId);
  }

  async requestWithdraw(companionId: string, amount: number, note?: string) {
    const wallet = await this.getWallet(companionId);
    if (amount > wallet.withdrawable) {
      throw new ForbiddenException(`可支取金额不足，当前可支取: ¥${wallet.withdrawable}`);
    }
    const [limitCfg, usedCount] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'withdraw.monthly_limit' } }),
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
    const limit = Number(limitCfg?.value ?? 2);
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

  async resignCompanion(companionId: string) {
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { userId: true },
    });
    await this.prisma.companion.update({
      where: { id: companionId },
      data: { status: 'OFFLINE', balance: 0, deposit: 0, frozen: 0, monthlyRevenue: 0, isResigned: true },
    });
    if (companion?.userId) {
      await this.prisma.user.update({
        where: { id: companion.userId },
        data: { isAuthorized: false },
      });
    }
    return { success: true };
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
