import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CompanionsService {
  constructor(private prisma: PrismaService) {}

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
    const ids = companions.map(c => c.id);
    if (ids.length === 0) return [];

    const recentKills = await this.prisma.processKillLog.groupBy({
      by: ['companionId'],
      where: { companionId: { in: ids }, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
      _count: { id: true },
    });
    const killMap = new Map(recentKills.map(k => [k.companionId, k._count.id]));

    const blockedKills = await this.prisma.processKillLog.findMany({
      where: { companionId: { in: ids }, resultText: { contains: 'REPEAT_KILL_ALERT' }, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
      select: { companionId: true },
      distinct: ['companionId'],
    });
    const blockedSet = new Set(blockedKills.map(k => k.companionId));

    return companions.map(c => ({
      ...c,
      processStatus: blockedSet.has(c.id) ? 'BLOCKED' : ((killMap.get(c.id) || 0) >= 1 ? 'WARNING' : 'NORMAL'),
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

  async getRanking(user: any) {
    const where: any = { monthlyRevenue: { gt: 0 } };
    if (user.role !== 'OWNER') where.studioId = user.studioId;
    return this.prisma.companion.findMany({
      where,
      orderBy: { monthlyRevenue: 'desc' },
      take: 20,
      select: {
        id: true,
        monthlyRevenue: true,
        user: { select: { username: true, avatar: true, displayName: true } },
      },
    });
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

    // Config thresholds
    const [unlockCfg, freeCfg] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'revenue.unlock_threshold' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'revenue.free_threshold' } }),
    ]);
    const unlockThreshold = (unlockCfg?.value as number) ?? 200;
    const freeThreshold = (freeCfg?.value as number) ?? 300;

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
      where: { studioId: companion?.studioId, status: { in: ['AVAILABLE', 'WAITING', 'BUSY', 'ENTERTAINMENT'] } },
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
      // TIERED: compute which tier the companion is in
      const config = await this.prisma.systemConfig.findUnique({
        where: { key: 'revenue.share_tiers' },
      });
      const tiers: Array<{ min: number; max: number | null; companion: number }> =
        (config?.value as any) ?? [
          { min: 0, max: 5999.99, companion: 50 },
          { min: 6000, max: 9999, companion: 60 },
          { min: 10000, max: null, companion: 70 },
        ];
      const tier =
        tiers.find(
          (t) =>
            companion.monthlyRevenue >= t.min &&
            (t.max === null || companion.monthlyRevenue <= t.max),
        ) || tiers[tiers.length - 1];
      tierInfo = {
        mode: 'TIERED',
        companionPct: tier.companion,
        monthlyRevenue: Math.round(companion.monthlyRevenue * 100) / 100,
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
    const buffer30min = Math.round(hourlyRate / 2 * 100) / 100; // half-hour cost
    const feeBalanceWarning = entertainmentFee >= availableFunds - buffer30min;
    const feeBalanceAlert = entertainmentFee >= availableFunds;

    return {
      todayRevenue: Math.round(todayRevenue * 100) / 100,
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
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { deposit: true, balance: true, frozen: true, monthlyRevenue: true, revenueShare: true, studio: { select: { splitMode: true } } },
    });
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { companionId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Calculate withdrawable: totalDONE × splitRatio - alreadyWithdrawn
    const totalRevenue = await this.prisma.order.aggregate({
      where: { companionId, status: 'DONE' },
      _sum: { amount: true },
    });
    const totalRev = totalRevenue._sum.amount || 0;
    const withdrawn = transactions
      .filter(t => t.type === 'WITHDRAW' && t.status === 'APPROVED')
      .reduce((s, t) => s + t.amount, 0);

    // Determine split ratio
    const isFixed = companion!.studio?.splitMode === 'FIXED';
    let share: number;
    if (isFixed) {
      share = companion!.revenueShare || 0.8;
    } else {
      const tiersCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'revenue.share_tiers' } });
      const tiers: Array<{ min: number; max: number | null; companion: number }> =
        (tiersCfg?.value as any) ?? [
          { min: 0, max: 5999.99, companion: 50 },
          { min: 6000, max: 9999, companion: 60 },
          { min: 10000, max: null, companion: 70 },
        ];
      const tier = tiers.find(t => totalRev >= t.min && (t.max === null || totalRev <= t.max)) || tiers[0];
      share = tier.companion / 100;
    }

    const maxWithdrawable = Math.round(totalRev * share * 100) / 100;
    const withdrawable = Math.max(0, maxWithdrawable - withdrawn);

    return {
      deposit: companion!.deposit,
      balance: companion!.balance,
      frozen: companion!.frozen,
      monthlyRevenue: companion!.monthlyRevenue,
      totalRevenue: Math.round(totalRev * 100) / 100,
      maxWithdrawable,
      totalWithdrawn: withdrawn,
      withdrawable,
      transactions,
    };
  }

  // Check if companion can enter entertainment mode: needs undrawn balance > 0
  async checkEntertainmentBlocked(companionId: string) {
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { balance: true, deposit: true, revenueShare: true, studio: { select: { splitMode: true } } },
    });
    if (!companion) return { reason: '陪玩不存在' };

    const totalBalance = (companion.balance || 0) + (companion.deposit || 0);

    // Total revenue from all DONE orders
    const totalRevenue = await this.prisma.order.aggregate({
      where: { companionId, status: 'DONE' },
      _sum: { amount: true },
    });
    const totalRev = totalRevenue._sum.amount || 0;

    // Split ratio: FIXED uses companion.revenueShare, TIERED reads from config
    const isFixed = companion.studio?.splitMode === 'FIXED';
    let share: number;
    if (isFixed) {
      share = companion.revenueShare || 0.8;
    } else {
      // TIERED: read the lowest tier's companion share from config
      const tiersCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'revenue.share_tiers' } });
      const tiers: Array<{ min: number; max: number | null; companion: number }> =
        (tiersCfg?.value as any) ?? [
          { min: 0, max: 5999.99, companion: 50 },
          { min: 6000, max: 9999, companion: 60 },
          { min: 10000, max: null, companion: 70 },
        ];
      // Find applicable tier for total revenue
      const tier = tiers.find(t => totalRev >= t.min && (t.max === null || totalRev <= t.max)) || tiers[0];
      share = tier.companion / 100;
    }

    // Already withdrawn
    const withdrawn = await this.prisma.walletTransaction.aggregate({
      where: { companionId, type: 'WITHDRAW', status: 'APPROVED' },
      _sum: { amount: true },
    });
    const totalWithdrawn = withdrawn._sum.amount || 0;

    const withdrawable = Math.round(totalRev * share * 100) / 100;
    const remaining = withdrawable - totalWithdrawn;

    if (remaining <= 0) {
      return {
        totalRevenue: totalRev,
        withdrawable,
        totalWithdrawn,
        remaining: Math.round(remaining * 100) / 100,
        totalBalance: Math.round(totalBalance * 100) / 100,
      };
    }
    return null; // not blocked — has undrawn balance
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
      where: { id: companionId }, select: { studioId: true },
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
    return this.prisma.workWechat.findMany({
      where: { studioId },
      include: { companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } } },
    });
  }

  async addWorkWechat(studioId: string, wechatId: string) {
    return this.prisma.workWechat.create({ data: { studioId, wechatId } });
  }

  async bindWechat(id: string, companionId: string) {
    return this.prisma.workWechat.update({ where: { id }, data: { companionId, status: 'BOUND' } });
  }

  async unbindWechat(id: string) {
    return this.prisma.workWechat.update({ where: { id }, data: { companionId: null, status: 'AVAILABLE' } });
  }

  // ── Attendance ──

  async ensureAttendance(companionId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();

    const existing = await this.prisma.companionAttendance.findUnique({
      where: { companionId_date: { companionId, date: today } },
    });

    if (existing) return existing;

    // Read work start time from SystemConfig
    const workStartCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'attendance.workStart' } });
    const workStartStr = (workStartCfg?.value as string) ?? '09:00';
    const [sh, sm] = workStartStr.split(':').map(Number);
    const workStart = new Date(today);
    workStart.setHours(sh, sm, 0, 0);

    const isLate = now > workStart;

    return this.prisma.companionAttendance.create({
      data: {
        companionId,
        date: today,
        loginAt: now,
        isLate,
      },
    });
  }

  async finalizeAttendance(companionId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();

    const record = await this.prisma.companionAttendance.findUnique({
      where: { companionId_date: { companionId, date: today } },
    });
    if (!record) return null;

    const loginAt = new Date(record.loginAt);
    const workMinutes = Math.floor((now.getTime() - loginAt.getTime()) / 60000);

    // Read work end time from SystemConfig
    const workEndCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'attendance.workEnd' } });
    const workEndStr = (workEndCfg?.value as string) ?? '18:00';
    const [eh, em] = workEndStr.split(':').map(Number);
    const workEnd = new Date(today);
    workEnd.setHours(eh, em, 0, 0);

    const isEarlyLeave = now < workEnd;

    return this.prisma.companionAttendance.update({
      where: { id: record.id },
      data: {
        logoutAt: now,
        workMinutes,
        isEarlyLeave,
      },
    });
  }

  async getAttendance(filters: { companionId?: string; dateFrom?: string; dateTo?: string }) {
    const where: any = {};
    if (filters.companionId) where.companionId = filters.companionId;
    if (filters.dateFrom || filters.dateTo) {
      where.date = {};
      if (filters.dateFrom) where.date.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.date.lte = new Date(filters.dateTo);
    }

    return this.prisma.companionAttendance.findMany({
      where,
      include: {
        companion: {
          select: {
            id: true,
            user: { select: { username: true, displayName: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
    });
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
}
