// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeWithdrawable } from '../common/withdrawable';
import { BridgeService } from '../studios/bridge.service';
import { computeRevenueShare, effectiveTenureMonths } from '../common/revenue-calculator';
import type { RevenueSplitTier } from '../common/revenue-calculator';
import { resolveConfigsRaw } from '../common/studio-config';
import { companionOrderRevenue } from '../common/order-revenue';

@Injectable()
export class CompanionRevenueService {
  constructor(
    private prisma: PrismaService,
    private bridgeService: BridgeService,
  ) {}

  /**
   * 陪玩端「排行榜」（每个指标取前 10）。
   *
   * 老板 2026-10-04 报：**全站老板**（OWNER 没挂工作室，`studioId` 是 null）点这个接口直接 500。
   * 根因是老代码无条件拼 `studioId: { in: [studioId, ...bridged] }`，studioId 为 null 时就成了
   * `in: [null]`，Prisma 认为参数非法直接抛错（陪玩自己都有工作室，所以一直没暴露出来）。
   *
   * 现在：全站老板（`allStudios`）看全站；**非 OWNER 又没挂店的账号一律给空** ——
   * 绝不能因为 studioId 为空就把全站漏给一个没店的人（跟 liveBoard 一个规矩）；
   * 挂了店的照旧只看「本店 + 桥接店」，口径一点没动。
   */
  async getRanking(studioId: string | null, type: string, allStudios = false) {
    let scopeIds: string[] | null = null;
    if (!allStudios) {
      if (!studioId) return [];
      scopeIds = [studioId, ...(await this.bridgeService.getBridgedStudioIds(studioId))];
    }
    const companions = await this.prisma.companion.findMany({
      where: scopeIds ? { studioId: { in: scopeIds } } : {},
      select: { id: true, user: { select: { username: true, displayName: true } } },
    });

    const companionIds = companions.map((c) => c.id);

    // 业绩口径（老板 2026-10-07「口径 A：谁的钱算谁的」）：
    //   主陪伴 = 他当主陪的「主陪金额」；搭档份 = 他当搭档的「搭档金额」都要算进他自己头上。
    // 两个 groupBy 合并（主陪 by companionId/amount + 搭档 by coCompanionId/coAmount），
    // 比逐人 findMany 省；人数里没有的（含跨店陪玩）不进榜。
    const orderStats =
      companionIds.length > 0
        ? await this.prisma.order.groupBy({
            by: ['companionId', 'type'],
            where: { companionId: { in: companionIds }, status: 'DONE' },
            _sum: { amount: true },
            _count: { id: true },
          })
        : [];
    const coOrderStats =
      companionIds.length > 0
        ? await this.prisma.order.groupBy({
            by: ['coCompanionId', 'type'],
            where: { coCompanionId: { in: companionIds }, status: 'DONE' },
            _sum: { coAmount: true },
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
    for (const row of coOrderStats) {
      const cid = row.coCompanionId!;
      if (!statsMap.has(cid)) statsMap.set(cid, defaultStats());
      const s = statsMap.get(cid)!;
      s.totalAmount += row._sum.coAmount || 0;
      s.totalCount += row._count.id;
      s.typeCounts[row.type] = (s.typeCounts[row.type] || 0) + row._count.id;
      s.typeAmounts[row.type] = (s.typeAmounts[row.type] || 0) + (row._sum.coAmount || 0);
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
        createdAt: true,
        isSeniorStaff: true,
        studioId: true,
        studio: { select: { splitMode: true } },
      },
    });
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { companionId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const [scopedLimit, monthlyWithdrawUsed] = await Promise.all([
      resolveConfigsRaw(this.prisma, companion?.studioId ?? null, ['withdraw.monthly_limit']),
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
    const monthlyWithdrawLimit = Number(scopedLimit['withdraw.monthly_limit'] ?? 2);

    // 可支取口径（需求文档 §7.1）统一在 common/withdrawable.ts 里实现，别处不要再抄一份
    const breakdown = await computeWithdrawable(this.prisma, companionId);
    const totalRev = breakdown.totalRevenue;
    const monthRev = breakdown.monthRevenue;
    const share = breakdown.splitRatio / 100;
    const withdrawn = breakdown.approvedWithdrawn;
    const pendingWithdrawn = breakdown.pendingWithdraw;
    const maxWithdrawable = Math.round(monthRev * share * 100) / 100;
    const depositReserve = breakdown.depositReserve;
    const withdrawable = breakdown.withdrawable;

    return {
      deposit: companion!.deposit,
      balance: companion!.balance,
      frozen: companion!.frozen,
      monthlyRevenue: companion!.monthlyRevenue,
      totalRevenue: Math.round(totalRev * 100) / 100,
      monthRevenue: Math.round(monthRev * 100) / 100,
      depositReserve,
      maxWithdrawable,
      totalWithdrawn: withdrawn,
      pendingWithdraw: pendingWithdrawn,
      withdrawable,
      monthlyWithdrawLimit,
      monthlyWithdrawUsed,
      monthlyWithdrawRemaining: monthlyWithdrawLimit > 0 ? Math.max(0, monthlyWithdrawLimit - monthlyWithdrawUsed) : null,
      transactions,
    };
  }

  // Check if companion can enter entertainment mode: needs undrawn balance > 0
  async checkEntertainmentBlocked(companionId: string) {
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { balance: true, deposit: true, revenueShare: true, createdAt: true, isSeniorStaff: true, studio: { select: { id: true, splitMode: true } } },
    });
    if (!companion) return { reason: '陪玩不存在' };

    const totalBalance = (companion.balance || 0) + (companion.deposit || 0);

    // 历史总业绩（口径 A：主陪算「主陪金额」、搭档算「搭档金额」）——分成档位按它走，必须跟可支取一致。
    const totalOrders = await this.prisma.order.findMany({
      where: { status: 'DONE', OR: [{ companionId }, { coCompanionId: companionId }] },
      select: { companionId: true, coCompanionId: true, amount: true, coAmount: true, customFields: true },
    });
    const totalRev = totalOrders.reduce((acc, o) => acc + companionOrderRevenue(o, companionId), 0);

    // 分成比例（委托给 revenue-calculator）：按「本店店长填的 → 老板全局默认」解析
    const cfg = await resolveConfigsRaw(this.prisma, companion.studio?.id, [
      'revenue.club_companion_share',
      'revenue.share_tiers',
    ]);
    const share = computeRevenueShare({
      splitMode: companion.studio?.splitMode ?? 'TIERED',
      totalRevenue: totalRev,
      revenueShare: companion.revenueShare,
      defaultClubSharePct: (cfg['revenue.club_companion_share'] as number) ?? 80,
      tiers: (cfg['revenue.share_tiers'] as unknown as RevenueSplitTier[]) ?? undefined,
      tenureMonths: effectiveTenureMonths(companion.createdAt, companion.isSeniorStaff),
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
