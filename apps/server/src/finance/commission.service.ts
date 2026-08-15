import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { settlementMonthRange } from '../common/business-day';
import { yuanToCents, centsToYuan } from '../common/money';

@Injectable()
export class CommissionService {
  constructor(private readonly prisma: PrismaService) {}

  async listRules(studioId: string) {
    return this.prisma.commissionRule.findMany({ where: { studioId }, orderBy: { role: 'asc' } });
  }

  async upsertRule(
    studioId: string,
    dto: {
      id?: string;
      role?: string;
      basis?: string;
      type?: string;
      rate?: number | null;
      fixedAmountYuan?: number | null;
      source?: string | null;
      floorAmountYuan?: number | null;
      isActive?: boolean;
    },
  ) {
    const data = {
      studioId,
      role: dto.role ?? 'CS',
      basis: dto.basis ?? 'CLAIMED_AMOUNT',
      type: dto.type ?? 'RATE',
      rate: dto.rate ?? null,
      fixedAmount: dto.fixedAmountYuan != null ? yuanToCents(dto.fixedAmountYuan) : null,
      source: dto.source ?? null,
      floorAmount: dto.floorAmountYuan != null ? yuanToCents(dto.floorAmountYuan) : null,
      isActive: dto.isActive ?? true,
    };
    if (dto.id) {
      return this.prisma.commissionRule.update({ where: { id: dto.id }, data });
    }
    return this.prisma.commissionRule.create({ data });
  }

  /** 计算某营业月的客服/店长提成，写入 CommissionLedger（幂等）。 */
  async calculateMonth(studioId: string, month: string) {
    const { start, end } = settlementMonthRange(month);
    const rules = await this.prisma.commissionRule.findMany({ where: { studioId, isActive: true } });
    const created: Array<Record<string, unknown>> = [];

    for (const rule of rules) {
      const users = await this.prisma.user.findMany({ where: { studioId, role: rule.role } });
      for (const u of users) {
        const baseWhere: any = {
          status: 'DONE',
          createdAt: { gte: start, lt: end },
          OR: [{ attributedCsUserId: u.id }, { claimedCsUserId: u.id }],
        };
        if (rule.source) baseWhere.source = rule.source;

        let basisValue = 0;
        let amountCents = 0;

        if (rule.type === 'FIXED' && rule.basis === 'ORDER_COUNT') {
          const count = await this.prisma.order.count({
            where: baseWhere,
          });
          basisValue = count;
          amountCents = (rule.fixedAmount ?? 0) * count;
        } else if (rule.type === 'RATE') {
          const orders = await this.prisma.order.findMany({ where: baseWhere, select: { amount: true } });
          const totalYuan = orders.reduce((s, o) => s + (o.amount || 0), 0);
          basisValue = totalYuan;
          if (rule.floorAmount != null && rule.floorAmount > 0) {
            amountCents = orders.reduce((s, o) => {
              const base = Math.round((o.amount || 0) * 100 * (rule.rate ?? 0));
              return s + Math.max(rule.floorAmount!, base);
            }, 0);
          } else {
            amountCents = Math.round(yuanToCents(totalYuan) * (rule.rate ?? 0));
          }
        } else {
          const agg = await this.prisma.order.aggregate({ where: baseWhere, _sum: { amount: true } });
          basisValue = agg._sum.amount ?? 0;
          amountCents = rule.fixedAmount ?? 0;
        }

        if (amountCents <= 0) continue;

        const ruleSnapshot = {
          role: rule.role,
          basis: rule.basis,
          type: rule.type,
          rate: rule.rate,
          fixedAmount: rule.fixedAmount,
        };
        const ledger = await this.prisma.commissionLedger.upsert({
          where: { studioId_ruleId_userId_month: { studioId, ruleId: rule.id, userId: u.id, month } },
          create: {
            studioId,
            ruleId: rule.id,
            userId: u.id,
            month,
            basisValue,
            amount: amountCents,
            ruleSnapshot,
            status: 'DRAFT',
          },
          update: { basisValue, amount: amountCents, ruleSnapshot },
        });

        created.push({
          userId: u.id,
          username: u.username,
          role: rule.role,
          basis: rule.basis,
          basisValue,
          amountYuan: centsToYuan(amountCents),
          ledgerId: ledger.id,
        });
      }
    }

    return { created: created.length, items: created };
  }

  /** 确认/撤销客服、店长提成结算记录。 */
  async setLedgerStatus(id: string, studioId: string, status: 'DRAFT' | 'CONFIRMED') {
    const ledger = await this.prisma.commissionLedger.findFirst({ where: { id, studioId } });
    if (!ledger) throw new NotFoundException('提成记录不存在');
    return this.prisma.commissionLedger.update({ where: { id }, data: { status } });
  }

  async listLedgers(studioId: string, month: string) {
    const rows = await this.prisma.commissionLedger.findMany({
      where: { studioId, month },
      include: { user: { select: { username: true, displayName: true, role: true } } },
      orderBy: { amount: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.user?.username,
      displayName: r.user?.displayName,
      role: r.user?.role,
      basisValue: r.basisValue,
      amountYuan: centsToYuan(r.amount),
      status: r.status,
      month: r.month,
    }));
  }
}
