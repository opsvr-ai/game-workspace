// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeRevenueSplit } from '../common/revenue-calculator';
import type { RevenueSplitTier } from '../common/revenue-calculator';
import { CompanionRevenueService } from './companion-revenue.service';
import { CompanionAttendanceService } from './companion-attendance.service';
import { CompanionWechatService } from './companion-wechat.service';

@Injectable()
export class CompanionsService {
  constructor(
    private prisma: PrismaService,
    private readonly revenueService: CompanionRevenueService,
    private readonly attendanceService: CompanionAttendanceService,
    private readonly wechatService: CompanionWechatService,
  ) {}

  async findAll(user: any) {
    const where: any = {};
    if (user.role !== 'OWNER') where.studioId = user.studioId;
    const companions = await this.prisma.companion.findMany({
      where,
      include: {
        user: { select: { username: true, avatar: true, displayName: true } },
        pc: { select: { currentMode: true, isThrottled: true, lastHeartbeat: true } },
      },
    });

    // Derive processStatus from recent kill logs (30min window)
    const ids = companions.map((c) => c.id);
    if (ids.length === 0) return [];

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

    // Today's order counts per companion
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayOrders = await this.prisma.order.groupBy({
      by: ['companionId'],
      where: { companionId: { in: ids }, createdAt: { gte: todayStart, lte: todayEnd }, status: { not: 'CANCELLED' } },
      _count: { id: true },
    });
    const orderCounts = new Map(todayOrders.map((o) => [o.companionId, o._count.id]));

    // Today's budan counts
    const budanData = await this.prisma.order.findMany({
      where: { companionId: { in: ids }, createdAt: { gte: todayStart, lte: todayEnd } },
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
    return this.prisma.companion.update({ where: { id }, data: { status } });
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

  async getWorkbench(companionId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Today's revenue from completed orders
    const todayOrders = await this.prisma.order.findMany({
      where: {
        companionId,
        status: 'DONE',
        createdAt: { gte: today, lt: tomorrow },
      },
    });
    const todayRevenue = todayOrders.reduce((s, o) => s + o.amount, 0);

    // Order type breakdown
    const orderStats = await Promise.all(
      ['NEW', 'RENEW', 'REPURCHASE', 'TIP'].map(async (type) => {
        const orders = await this.prisma.order.findMany({
          where: { companionId, type, status: 'DONE' },
          select: { amount: true },
        });
        const count = orders.length;
        const amount = orders.reduce((s, o) => s + o.amount, 0);
        return { type, count, amount };
      }),
    );
    const totalCount = orderStats.reduce((s, o) => s + o.count, 0);
    const statsMap: Record<string, any> = {};
    orderStats.forEach(({ type, count, amount }) => {
      statsMap[type] = {
        count,
        amount: Math.round(amount * 100) / 100,
        ratio: totalCount > 0 ? Math.round((count / totalCount) * 100) : 0,
      };
    });

    // Today's order type breakdown
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayBreakdownOrders = await this.prisma.order.findMany({
      where: { companionId, status: 'DONE', createdAt: { gte: todayStart, lte: todayEnd } },
      select: { type: true, amount: true, customFields: true, notes: true },
    });
    const todayStats: Record<string, any> = {};
    ['NEW', 'RENEW', 'REPURCHASE', 'TIP'].forEach((t) => {
      todayStats[t] = { count: 0, amount: 0 };
    });
    todayBreakdownOrders.forEach((o) => {
      todayStats[o.type].count++;
      todayStats[o.type].amount += o.amount;
    });
    const todayTotal = todayBreakdownOrders.reduce((s, o) => s + o.amount, 0);
    Object.keys(todayStats).forEach((k) => {
      todayStats[k].amount = Math.round(todayStats[k].amount * 100) / 100;
      todayStats[k].ratio = todayTotal > 0 ? Math.round((todayStats[k].amount / todayTotal) * 100) : 0;
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
    const entertainmentFee = Math.round(entertainmentMinutes * (hourlyRate / 60) * 100) / 100;

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
    } else if (companion?.monthlyRevenue) {
      // TIERED: compute which tier the companion is in (delegated to revenue-calculator)
      const config = await this.prisma.systemConfig.findUnique({
        where: { key: 'revenue.share_tiers' },
      });
      const tiers: RevenueSplitTier[] = (config?.value as any) ?? [];
      const splitResult = computeRevenueSplit({
        splitMode,
        totalRevenue: companion.monthlyRevenue,
        revenueShare: companion?.revenueShare,
        tiers: tiers.length > 0 ? tiers : undefined,
        monthlyRevenue: companion.monthlyRevenue,
      });
      tierInfo = {
        mode: splitResult.mode,
        companionPct: splitResult.companionPct,
        monthlyRevenue: splitResult.monthlyRevenue,
      };
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
      todayRevenue: Math.round(todayRevenue * 100) / 100,
      orderStats: statsMap,
      todayStats,
      totalCount,
      unlockThreshold,
      isUnlocked: todayRevenue >= unlockThreshold,
      freeThreshold,
      entertainmentMinutes,
      entertainmentFee,
      hourlyRate,
      totalRevenue: Math.round(totalRev * 100) / 100,
      availableFunds: Math.round(availableFunds * 100) / 100,
      feeBalanceWarning,
      feeBalanceAlert,
      entertainmentThreshold,
      entertainmentDepositThreshold,
      isEntertainmentUnlocked: todayRevenue >= entertainmentThreshold,
      // New analytics metrics
      todayOrderCount: todayBreakdownOrders.length,
      monthlyOrderCount: monthlyAll,
      wechatAddRate,
      conversionRate,
      renewRate,
      repurchaseRate,
      todayBudanCount: todayBreakdownOrders.filter((o) =>
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

  // TASK-11: Request dual companion
  async requestDualCompanion(companionId: string, studioId: string, username: string) {
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { user: { select: { username: true, displayName: true } } },
    });
    const name = companion?.user?.displayName || companion?.user?.username || username;
    // Broadcast to studio via WS gateway will be handled by controller
    return { companionId, companionName: name, studioId };
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

  async addWorkWechat(studioId: string, wechatId: string) {
    return this.wechatService.addWorkWechat(studioId, wechatId);
  }

  async bindWechat(id: string, companionId: string) {
    return this.wechatService.bindWechat(id, companionId);
  }

  async unbindWechat(id: string) {
    return this.wechatService.unbindWechat(id);
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
