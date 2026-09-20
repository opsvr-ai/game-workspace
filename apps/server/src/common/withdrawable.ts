import type { PrismaService } from '../prisma/prisma.service';
import { currentSettlementMonthRange, settlementMonthRange } from './business-day';
import { computeRevenueShare, effectiveTenureMonths } from './revenue-calculator';
import type { RevenueSplitTier } from './revenue-calculator';
import { resolveConfigs } from './studio-config';

/**
 * 可支取余额（唯一口径，需求文档 §7.1）：
 *   (当月累计业绩 × 分润比例) − 当月已支取 − 当月待审支取 − 未打存单预留
 *
 * 老板 2026-09-20 拍板前，代码里三处算法各不相同（历史全量流水 / 忙碌人数快照 …），
 * 从今往后所有地方都调这里，别再各写一份。
 * 「未打存单预留」= 客户存单里还没打完的余额，**原样全额**押着（不乘分润比例）。
 * 老板 2026-09-21 拍板：存单多少就写多少；只有**已经打完**的部分才乘分润比例进可支取（即上面的「当月累计业绩 × 分润比例」）。
 * 例：客户存单余额 300 元没打完 → 预留就是 300（不打折）；这月打完 1000 元 → 1000 × 分润比例进可支取。
 */
export interface WithdrawableBreakdown {
  month: string;
  monthRevenue: number;
  totalRevenue: number;
  splitRatio: number;
  approvedWithdrawn: number;
  pendingWithdraw: number;
  depositReserve: number;
  /** 已扣掉「本笔待审支取」之后的可用额（审核时用） */
  withdrawable: number;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function computeWithdrawable(
  prisma: PrismaService,
  companionId: string,
  opts?: { month?: string; excludeTxId?: string },
): Promise<WithdrawableBreakdown> {
  const now = new Date();
  const { start, end } = opts?.month
    ? settlementMonthRange(opts.month)
    : currentSettlementMonthRange(now);
  const month = opts?.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const companion = await prisma.companion.findUnique({
    where: { id: companionId },
    select: {
      revenueShare: true,
      createdAt: true,
      isSeniorStaff: true,
      studio: { select: { id: true, splitMode: true } },
    },
  });
  if (!companion) {
    return {
      month,
      monthRevenue: 0,
      totalRevenue: 0,
      splitRatio: 0,
      approvedWithdrawn: 0,
      pendingWithdraw: 0,
      depositReserve: 0,
      withdrawable: 0,
    };
  }

  // 分店自己的配置优先（店长填的），没有才用老板的全局值 —— 见 common/studio-config.ts
  const studioId = (companion as any).studio?.id as string | undefined;

  const [monthAgg, totalAgg, withdrawnAgg, pendingAgg, depositRows, cfg] = await Promise.all([
    prisma.order.aggregate({
      where: { companionId, status: 'DONE', createdAt: { gte: start, lt: end } },
      _sum: { amount: true },
    }),
    prisma.order.aggregate({ where: { companionId, status: 'DONE' }, _sum: { amount: true } }),
    prisma.walletTransaction.aggregate({
      where: { companionId, type: 'WITHDRAW', status: 'APPROVED', createdAt: { gte: start, lt: end } },
      _sum: { amount: true },
    }),
    prisma.walletTransaction.findMany({
      where: {
        companionId,
        type: 'WITHDRAW',
        status: 'PENDING',
        createdAt: { gte: start, lt: end },
        ...(opts?.excludeTxId ? { id: { not: opts.excludeTxId } } : {}),
      },
      select: { amount: true },
    }),
    prisma.customer.findMany({ where: { companionId }, select: { depositBalance: true } }),
    resolveConfigs(prisma as any, studioId, ['revenue.club_companion_share', 'revenue.share_tiers']),
  ]);

  const monthRevenue = monthAgg._sum.amount || 0;
  const totalRevenue = totalAgg._sum.amount || 0;
  const approvedWithdrawn = withdrawnAgg._sum.amount || 0;
  const pendingWithdraw = pendingAgg.reduce((s, t) => s + (t.amount || 0), 0);

  const share = computeRevenueShare({
    splitMode: (companion as any).studio?.splitMode ?? 'TIERED',
    totalRevenue: monthRevenue,
    revenueShare: (companion as any).revenueShare,
    defaultClubSharePct: (cfg['revenue.club_companion_share'] as number) ?? 80,
    tiers: (cfg['revenue.share_tiers'] as unknown as RevenueSplitTier[]) ?? undefined,
    tenureMonths: effectiveTenureMonths((companion as any).createdAt, (companion as any).isSeniorStaff),
  });

  const depositUnused = depositRows.reduce((s, c) => s + (c.depositBalance || 0), 0);
  // 存单里还没打完的余额：原样全额押着，不乘分润比例。
  const depositReserve = round2(depositUnused);

  const withdrawable = Math.max(
    0,
    round2(round2(monthRevenue * share) - approvedWithdrawn - pendingWithdraw - depositReserve),
  );

  return {
    month,
    monthRevenue: round2(monthRevenue),
    totalRevenue: round2(totalRevenue),
    splitRatio: Math.round(share * 100),
    approvedWithdrawn: round2(approvedWithdrawn),
    pendingWithdraw: round2(pendingWithdraw),
    depositReserve,
    withdrawable,
  };
}
