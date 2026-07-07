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
    const entertainmentFee = entertainmentMinutes; // ¥1/min

    // Online companions (same studio)
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { studioId: true, status: true },
    });
    const onlineCompanions = await this.prisma.companion.findMany({
      where: { studioId: companion?.studioId, status: { in: ['AVAILABLE', 'BUSY', 'ENTERTAINMENT'] } },
      select: {
        id: true,
        status: true,
        user: { select: { username: true, avatar: true, displayName: true } },
      },
    });

    return {
      todayRevenue: Math.round(todayRevenue * 100) / 100,
      unlockThreshold,
      isUnlocked: todayRevenue >= unlockThreshold,
      freeThreshold,
      entertainmentMinutes,
      entertainmentFee,
      currentStatus: companion?.status ?? 'OFFLINE',
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
      select: { deposit: true, balance: true, frozen: true, monthlyRevenue: true },
    });
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { companionId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Calculate withdrawable: (monthlyRevenue * advanceRatio%) - alreadyWithdrawn
    const config = await this.prisma.systemConfig.findUnique({ where: { key: 'withdraw.advance_ratio' } });
    const ratio = (config?.value as number) ?? 50;
    const withdrawn = transactions
      .filter(t => t.type === 'WITHDRAW' && t.status === 'APPROVED')
      .reduce((s, t) => s + t.amount, 0);
    const withdrawable = Math.max(0, (companion!.monthlyRevenue * ratio / 100) - withdrawn);

    return {
      deposit: companion!.deposit,
      balance: companion!.balance,
      frozen: companion!.frozen,
      monthlyRevenue: companion!.monthlyRevenue,
      withdrawable,
      transactions,
    };
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
