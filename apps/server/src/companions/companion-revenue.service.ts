// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BridgeService } from '../studios/bridge.service';
import { computeRevenueShare } from '../common/revenue-calculator';
import type { RevenueSplitTier } from '../common/revenue-calculator';

@Injectable()
export class CompanionRevenueService {
  constructor(
    private prisma: PrismaService,
    private bridgeService: BridgeService,
  ) {}

  async getRanking(studioId: string, type: string) {
    const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
    const where: any = { studioId: { in: [studioId, ...bridgedIds] } };
    const companions = await this.prisma.companion.findMany({
      where,
      select: { id: true, user: { select: { username: true, displayName: true } } },
    });

    const companionIds = companions.map((c) => c.id);

    // Single groupBy query replaces N per-companion findMany calls
    const orderStats =
      companionIds.length > 0
        ? await this.prisma.order.groupBy({
            by: ['companionId', 'type'],
            where: { companionId: { in: companionIds }, status: 'DONE' },
            _sum: { amount: true },
            _count: { id: true },
          })
        : [];

    // Build per-companion aggregates from the flat groupBy rows
    const defaultStats = () => ({
      totalAmount: 0,
      totalCount: 0,
      typeCounts: { NEW: 0, RENEW: 0, REPURCHASE: 0, TIP: 0 } as Record<string, number>,
      typeAmounts: { NEW: 0, RENEW: 0, REPURCHASE: 0, TIP: 0 } as Record<string, number>,
    });

    const statsMap = new Map<string, ReturnType<typeof defaultStats>>();
    for (const row of orderStats) {
      const cid = row.companionId!;
      if (!statsMap.has(cid)) statsMap.set(cid, defaultStats());
      const s = statsMap.get(cid)!;
      s.totalAmount += row._sum.amount || 0;
      s.totalCount += row._count.id;
      s.typeCounts[row.type] = row._count.id;
      s.typeAmounts[row.type] = row._sum.amount || 0;
    }

    const results = companions.map((c) => {
      const s = statsMap.get(c.id) || defaultStats();
      const { totalAmount, totalCount, typeCounts, typeAmounts } = s;

      let score = 0;
      if (type === 'revenue') score = totalAmount;
      else if (type === 'new_rate') score = totalCount > 0 ? (typeCounts.NEW / totalCount) * 100 : 0;
      else if (type === 'renew_rate') score = totalCount > 0 ? (typeCounts.RENEW / totalCount) * 100 : 0;
      else if (type === 'repurchase_rate') score = totalCount > 0 ? (typeCounts.REPURCHASE / totalCount) * 100 : 0;
      else if (type === 'tip_ratio') score = totalAmount > 0 ? (typeAmounts.TIP / totalAmount) * 100 : 0;

      const newRate = totalCount > 0 ? Math.round((typeCounts.NEW / totalCount) * 100) : 0;
      const renewRate = totalCount > 0 ? Math.round((typeCounts.RENEW / totalCount) * 100) : 0;
      const repurchaseRate = totalCount > 0 ? Math.round((typeCounts.REPURCHASE / totalCount) * 100) : 0;
      const tipAmount = typeAmounts.TIP;
      const tipRatio = totalAmount > 0 ? Math.round((tipAmount / totalAmount) * 100) : 0;
      const rawScore = renewRate * 2 + repurchaseRate * 3 + tipRatio * 2 - newRate * 0.5;
      const qualityScore = Math.round(Math.max(0, Math.min(100, ((rawScore + 50) / 170) * 100)));
      return {
        companionId: c.id,
        name: c.user?.displayName || c.user?.username || c.id,
        totalAmount: Math.round(totalAmount * 100) / 100,
        totalCount,
        newRate,
        renewRate,
        repurchaseRate,
        tipRatio,
        tipAmount: Math.round(tipAmount * 100) / 100,
        qualityScore,
        score: Math.round(score * 100) / 100,
      };
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 10);
  }

  async getWallet(companionId: string) {
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: {
        deposit: true,
        balance: true,
        frozen: true,
        monthlyRevenue: true,
        revenueShare: true,
        studio: { select: { splitMode: true } },
      },
    });
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { companionId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Calculate withdrawable: totalDONE x splitRatio - alreadyWithdrawn
    const totalRevenue = await this.prisma.order.aggregate({
      where: { companionId, status: 'DONE' },
      _sum: { amount: true },
    });
    const totalRev = totalRevenue._sum.amount || 0;
    const withdrawn = transactions
      .filter((t) => t.type === 'WITHDRAW' && t.status === 'APPROVED')
      .reduce((s, t) => s + t.amount, 0);

    // Determine split ratio (delegated to revenue-calculator)
    const clubCfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'revenue.club_companion_share' },
    });
    const tiersCfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'revenue.share_tiers' },
    });
    const share = computeRevenueShare({
      splitMode: companion!.studio?.splitMode ?? 'TIERED',
      totalRevenue: totalRev,
      revenueShare: companion!.revenueShare,
      defaultClubSharePct: (clubCfg?.value as number) ?? 80,
      tiers: (tiersCfg?.value as unknown as RevenueSplitTier[]) ?? undefined,
    });

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

    // Split ratio (delegated to revenue-calculator)
    const clubCfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'revenue.club_companion_share' },
    });
    const tiersCfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'revenue.share_tiers' },
    });
    const share = computeRevenueShare({
      splitMode: companion.studio?.splitMode ?? 'TIERED',
      totalRevenue: totalRev,
      revenueShare: companion.revenueShare,
      defaultClubSharePct: (clubCfg?.value as number) ?? 80,
      tiers: (tiersCfg?.value as unknown as RevenueSplitTier[]) ?? undefined,
    });

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
}
