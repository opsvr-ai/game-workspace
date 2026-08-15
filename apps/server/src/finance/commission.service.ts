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
    const capCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'commission.cs_month_cap_cents' } });
    const monthCapCents = Number(capCfg?.value ?? 0);
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

        if (monthCapCents > 0 && rule.source !== 'BRIDGE') {
          amountCents = Math.min(amountCents, monthCapCents);
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

  /** 读取客服提成配置（系统设置） */
  private async csConfig() {
    const keys = [
      'commission.cs_offline_rate_percent',
      'commission.cs_offline_floor_cents',
      'commission.cs_bridge_fixed_cents',
      'commission.cs_month_cap_cents',
    ];
    const records = await this.prisma.systemConfig.findMany({ where: { key: { in: keys } } });
    const map: Record<string, number> = {};
    for (const r of records) map[r.key] = Number(r.value);
    return {
      ratePercent: map['commission.cs_offline_rate_percent'] ?? 0.5,
      floorCents: map['commission.cs_offline_floor_cents'] ?? 200,
      bridgeFixedCents: map['commission.cs_bridge_fixed_cents'] ?? 100,
      monthCapCents: map['commission.cs_month_cap_cents'] ?? 2000,
    };
  }

  /** 实时估算某营业月的客服提成（不落库）。 */
  async computeCsCommission(studioId: string, month: string, userId?: string) {
    const { start, end } = settlementMonthRange(month);
    const cfg = await this.csConfig();
    const users = await this.prisma.user.findMany({
      where: { studioId, role: 'CS', ...(userId ? { id: userId } : {}) },
      select: { id: true, username: true, displayName: true },
    });
    const rows: Array<Record<string, unknown>> = [];
    for (const u of users) {
      const orders = await this.prisma.order.findMany({
        where: {
          status: 'DONE',
          createdAt: { gte: start, lt: end },
          OR: [{ attributedCsUserId: u.id }, { claimedCsUserId: u.id }],
        },
        select: { amount: true, source: true },
      });
      let offlineCents = 0;
      let bridgeCents = 0;
      for (const o of orders) {
        if (o.source === 'BRIDGE') {
          bridgeCents += cfg.bridgeFixedCents;
        } else {
          const base = Math.round(o.amount * 100 * (cfg.ratePercent / 100));
          offlineCents += Math.max(cfg.floorCents, base);
        }
      }
      if (cfg.monthCapCents > 0) offlineCents = Math.min(offlineCents, cfg.monthCapCents);
      rows.push({
        userId: u.id,
        username: u.username,
        displayName: u.displayName,
        offlineYuan: centsToYuan(offlineCents),
        bridgeYuan: centsToYuan(bridgeCents),
        totalYuan: centsToYuan(offlineCents + bridgeCents),
      });
    }
    return { month, rows };
  }

  /** 确保工作室存在默认的客服提成规则（线下比例+保底、线上固定）。 */
  async ensureDefaultCsRules(studioId: string) {
    const cfg = await this.csConfig();

    const offline = await this.prisma.commissionRule.findFirst({
      where: { studioId, role: 'CS', OR: [{ source: 'OFFLINE' }, { source: null }] },
    });
    if (offline) {
      await this.prisma.commissionRule.update({
        where: { id: offline.id },
        data: { basis: 'CLAIMED_AMOUNT', type: 'RATE', rate: cfg.ratePercent / 100, floorAmount: cfg.floorCents, source: 'OFFLINE', isActive: true },
      });
    } else {
      await this.prisma.commissionRule.create({
        data: { studioId, role: 'CS', basis: 'CLAIMED_AMOUNT', type: 'RATE', rate: cfg.ratePercent / 100, floorAmount: cfg.floorCents, source: 'OFFLINE', isActive: true },
      });
    }

    const bridge = await this.prisma.commissionRule.findFirst({
      where: { studioId, role: 'CS', source: 'BRIDGE' },
    });
    if (bridge) {
      await this.prisma.commissionRule.update({
        where: { id: bridge.id },
        data: { basis: 'ORDER_COUNT', type: 'FIXED', fixedAmount: cfg.bridgeFixedCents, isActive: true },
      });
    } else {
      await this.prisma.commissionRule.create({
        data: { studioId, role: 'CS', basis: 'ORDER_COUNT', type: 'FIXED', fixedAmount: cfg.bridgeFixedCents, source: 'BRIDGE', isActive: true },
      });
    }
  }
}
