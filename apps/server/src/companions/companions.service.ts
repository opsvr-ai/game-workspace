// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeRevenueSplit } from '../common/revenue-calculator';
import type { RevenueSplitTier } from '../common/revenue-calculator';
import { currentBusinessDayRange, currentSettlementMonthRange } from '../common/business-day';
import { companionOrderRevenue } from '../common/order-revenue';
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
  async listPersonnel(user: any) {
    const where: any = { role: { in: ['COMPANION', 'CS', 'ADMIN', 'OWNER'] } };
    if (user.role !== 'OWNER') where.studioId = user.studioId;

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
      lastHeartbeat: u.companion?.pc?.lastHeartbeat ?? csSeen.get(u.id) ?? null,
      currentMode: u.companion?.pc?.currentMode ?? null,
      isExcellent: u.companion ? excellence.get(u.companion.id)?.isExcellent ?? false : false,
      tier: u.companion ? excellence.get(u.companion.id)?.tier ?? 'LOW' : 'LOW',
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
      tier: excellence.get(c.id)?.tier ?? 'LOW',
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
    const current = await this.prisma.companion.findUnique({
      where: { id },
      select: { status: true },
    });
    // 已是当前状态：无需重复操作，直接返回，避免重置计时/计费。
    if (current && current.status === status) {
      return { id, status: current.status, alreadyInStatus: true };
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
    const now = new Date();
    let entertainmentFee: number | null = null;
    const openLog = await this.prisma.companionTimeLog.findFirst({
      where: { companionId: id, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (openLog) {
      const elapsed = Math.max(0, Math.round((now.getTime() - new Date(openLog.startedAt).getTime()) / 1000));
      // 从「娱乐」切到「空闲」时，计算本次娱乐消费金额。
      if (current?.status === 'ENTERTAINMENT' && status === 'AVAILABLE') {
        const rateCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'entertainment.hourly_rate' } });
        const hourlyRate = Number(rateCfg?.value ?? 60);
        entertainmentFee = roundToJiao(Math.floor(elapsed / 60) * (hourlyRate / 60));
      }
      await this.prisma.companionTimeLog.update({
        where: { id: openLog.id },
        data: { endedAt: now, durationSeconds: elapsed },
      });
    }
    await this.prisma.companionTimeLog.create({
      data: { companionId: id, mode: status, startedAt: now, endedAt: null, durationSeconds: 0 },
    });

    const updated = await this.prisma.companion.update({ where: { id }, data: { status } });
    return { ...updated, entertainmentFee };
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

  private async getDayStartHour(): Promise<number> {
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: 'studio.day_start_hour' } });
    return parseInt((cfg?.value as string) || '0', 10) || 0;
  }

  private async getTodayRange(): Promise<{ start: Date; end: Date }> {
    const h = await this.getDayStartHour();
    const now = new Date();
    const start = new Date(now);
    start.setHours(h, 0, 0, 0);
    if (now.getHours() < h) start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
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

  async getTodaySessions(companionId: string) {
    const { start } = await this.getTodayRange();
    const sessions = await this.prisma.orderSession.findMany({
      where: {
        OR: [{ companionId }, { coCompanionId: companionId }],
        createdAt: { gte: start },
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
    const rateCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'entertainment.hourly_rate' } });
    const hourlyRate = (rateCfg?.value as number) ?? 60; // default ¥60/hour
    const entertainmentFee = roundToJiao(entertainmentMinutes * (hourlyRate / 60));

    // Online companions (same studio) — also fetch split mode info
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: {
        studioId: true,
        status: true,
        monthlyRevenue: true,
        revenueShare: true,
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
    let tierInfo: { mode: string; companionPct?: number; monthlyRevenue?: number } = { mode: splitMode };

    if (splitMode === 'FIXED') {
      tierInfo = {
        mode: 'FIXED',
        companionPct: Math.round((companion?.revenueShare ?? 0.6) * 100),
      };
    } else {
      // TIERED：严格按营业月流水计算当前所在阶梯
      const monthRevenue = await this.computeMonthRevenue(companionId);
      if (monthRevenue > 0) {
        const config = await this.prisma.systemConfig.findUnique({
          where: { key: 'revenue.share_tiers' },
        });
        const tiers: RevenueSplitTier[] = (config?.value as any) ?? [];
        const splitResult = computeRevenueSplit({
          splitMode,
          totalRevenue: monthRevenue,
          revenueShare: companion?.revenueShare,
          tiers: tiers.length > 0 ? tiers : undefined,
          monthlyRevenue: monthRevenue,
        });
        tierInfo = {
          mode: splitResult.mode,
          companionPct: splitResult.companionPct,
          monthlyRevenue: splitResult.monthlyRevenue,
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
      isEntertainmentUnlocked: todayRevenue >= entertainmentThreshold,
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

  async requestWithdraw(companionId: string, amount: number) {
    const wallet = await this.getWallet(companionId);
    if (amount > wallet.withdrawable) {
      throw new ForbiddenException(`可支取金额不足，当前可支取: ¥${wallet.withdrawable}`);
    }
    return this.prisma.walletTransaction.create({
      data: {
        companionId,
        type: 'WITHDRAW',
        amount,
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance,
        status: 'PENDING',
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
    return this.prisma.companion.update({
      where: { id: companionId },
      data: { status: 'OFFLINE', balance: 0, deposit: 0, frozen: 0, monthlyRevenue: 0 },
    });
  }

  // ── Work WeChat Management ──

  async listWorkWechats(studioId: string) {
    return this.wechatService.listWorkWechats(studioId);
  }

  async addWorkWechat(studioId: string, wechatId: string, type?: string) {
    return this.wechatService.addWorkWechat(studioId, wechatId, type);
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

  async deleteWorkWechat(id: string) {
    return this.wechatService.deleteWorkWechat(id);
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
  async getStatusBlacklist(companionId: string, status: string) {
    return this.prisma.companionStatusBlacklist.findMany({
      where: { companionId, status },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addStatusBlacklist(companionId: string, status: string, processName: string) {
    return this.prisma.companionStatusBlacklist.create({
      data: { companionId, status, processName },
    });
  }

  async removeStatusBlacklist(id: string) {
    return this.prisma.companionStatusBlacklist.delete({ where: { id } });
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
}
