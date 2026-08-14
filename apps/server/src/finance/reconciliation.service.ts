import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { businessDayRange } from '../common/business-day';
import { yuanToCents, centsToYuan } from '../common/money';

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  /** 按「陪玩 × 营业日」核对应收合计与员工码到账合计，差额标红。 */
  async getDailyReconciliation(studioId: string, day: string) {
    const { start, end } = businessDayRange(day);
    const companions = await this.prisma.companion.findMany({
      where: { studioId },
      select: { id: true, user: { select: { username: true, displayName: true } } },
    });

    const rows: Array<Record<string, unknown>> = [];
    for (const c of companions) {
      const orderAgg = await this.prisma.order.aggregate({
        where: { companionId: c.id, status: 'DONE', createdAt: { gte: start, lt: end } },
        _sum: { amount: true },
      });
      const expectedCents = yuanToCents(orderAgg._sum.amount ?? 0);

      const payAgg = await this.prisma.merchantPaymentRecord.aggregate({
        where: { companionId: c.id, paidAt: { gte: start, lt: end } },
        _sum: { amount: true },
      });
      const actualCents = payAgg._sum.amount ?? 0;
      const diffCents = actualCents - expectedCents;

      if (expectedCents === 0 && actualCents === 0) continue;

      rows.push({
        companionId: c.id,
        companionName: c.user?.displayName || c.user?.username || c.id,
        expectedYuan: centsToYuan(expectedCents),
        actualYuan: centsToYuan(actualCents),
        diffYuan: centsToYuan(diffCents),
        flagged: diffCents < 0,
      });
    }

    return { day, rows };
  }
}
