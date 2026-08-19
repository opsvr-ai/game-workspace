import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeSharePct } from '../common/revenue-calculator';
import { settlementMonthRange } from '../common/business-day';
import { yuanToCents, centsToYuan } from '../common/money';
import { companionOrderRevenue } from '../common/order-revenue';

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

@Injectable()
export class SettlementSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  /** 运行某个营业月的分成结算，生成不可变快照（幂等）。 */
  async runMonthlySettlement(studioId: string, month: string) {
    const existing = await this.prisma.settlementSnapshot.findFirst({ where: { studioId, month } });
    if (existing) return { skipped: true, message: `工作室 ${studioId} 的 ${month} 月结算已存在` };

    const { start, end } = settlementMonthRange(month);
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { splitMode: true } });
    const companions = await this.prisma.companion.findMany({
      where: { studioId },
      select: { id: true, createdAt: true, revenueShare: true, user: { select: { username: true, displayName: true } } },
    });

    const clubCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'revenue.club_companion_share' } });
    const defaultClubSharePct = (clubCfg?.value as number) ?? 80;

    const results: Array<Record<string, unknown>> = [];

    for (const c of companions) {
      const orders = await this.prisma.order.findMany({
        where: {
          status: 'DONE',
          createdAt: { gte: start, lt: end },
          OR: [{ companionId: c.id }, { coCompanionId: c.id }],
        },
        select: { amount: true, coAmount: true, companionId: true, coCompanionId: true, customFields: true },
      });

      // 现有 Order.amount/coAmount 仍为 Float 元，统一口径转分计算
      let monthlyRevenueCents = 0;
      for (const o of orders) {
        monthlyRevenueCents += yuanToCents(companionOrderRevenue(o, c.id));
      }

      if (monthlyRevenueCents <= 0) continue;

      const tenureMonths = monthsBetween(c.createdAt, end);
      const companionPct = computeSharePct({
        splitMode: studio?.splitMode ?? 'TIERED',
        monthlyRevenue: centsToYuan(monthlyRevenueCents),
        tenureMonths,
        revenueShare: c.revenueShare,
        defaultClubSharePct,
      });
      const companionShareCents = Math.round((monthlyRevenueCents * companionPct) / 100);
      const studioShareCents = monthlyRevenueCents - companionShareCents;

      const snapshot = await this.prisma.settlementSnapshot.create({
        data: {
          studioId,
          companionId: c.id,
          month,
          monthlyRevenue: monthlyRevenueCents,
          companionPct,
          companionShare: companionShareCents,
          studioShare: studioShareCents,
          tenureMonths,
          snapshot: {
            splitMode: studio?.splitMode ?? 'TIERED',
            orderCount: orders.length,
            defaultClubSharePct,
          },
        },
      });

      results.push({
        companionId: c.id,
        companionName: c.user?.displayName || c.user?.username || c.id,
        monthlyRevenueYuan: centsToYuan(monthlyRevenueCents),
        companionPct,
        companionShareYuan: centsToYuan(companionShareCents),
        studioShareYuan: centsToYuan(studioShareCents),
        tenureMonths,
        snapshotId: snapshot.id,
      });
    }

    return { created: results.length, results };
  }

  async listMonth(studioId: string, month: string) {
    const rows = await this.prisma.settlementSnapshot.findMany({
      where: { studioId, month },
      include: { companion: { include: { user: { select: { username: true, displayName: true } } } } },
      orderBy: { monthlyRevenue: 'desc' },
    });
    return rows.map((r) => ({
      companionId: r.companionId,
      companionName: r.companion?.user?.displayName || r.companion?.user?.username || r.companionId,
      monthlyRevenueYuan: centsToYuan(r.monthlyRevenue),
      companionPct: r.companionPct,
      companionShareYuan: centsToYuan(r.companionShare),
      studioShareYuan: centsToYuan(r.studioShare),
      tenureMonths: r.tenureMonths,
      createdAt: r.createdAt,
    }));
  }
}
