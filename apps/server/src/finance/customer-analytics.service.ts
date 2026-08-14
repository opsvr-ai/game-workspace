import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface OrderRow {
  id: string;
  companionId: string;
  customerId: string;
  amount: number;
  duration: number | null;
  createdAt: Date;
  auditStatus: string | null;
  auditAmountCents: number | null;
  transferTotalCents: number | null;
}

interface CustomerSignal {
  customerId: string;
  orderCount: number;
  avgAmount: number;
  lastOrderAt: Date | null;
  lowPriceCount: number;
  consumptionDrop: boolean;
  durationDrop: boolean;
  churnRisk: boolean;
}

export interface CompanionRisk {
  companionId: string;
  companionName: string;
  orderCount: number;
  revenueYuan: number;
  flaggedCount: number;
  lowPriceCount: number;
  consumptionDropCount: number;
  durationDropCount: number;
  churnRiskCount: number;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  aiCopy: string;
  customers: CustomerSignal[];
}

const LOOKBACK_DAYS = 90;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class CustomerAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRiskQueue(studioId: string): Promise<CompanionRisk[]> {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const companions = await this.prisma.companion.findMany({
      where: { studioId },
      select: { id: true, user: { select: { username: true, displayName: true } } },
    });

    const orders = (await this.prisma.order.findMany({
      where: { studioId, status: 'DONE', createdAt: { gte: since }, companionId: { not: null } },
      select: {
        id: true,
        companionId: true,
        customerId: true,
        amount: true,
        duration: true,
        createdAt: true,
        auditStatus: true,
        auditAmountCents: true,
        transferTotalCents: true,
      },
      orderBy: { createdAt: 'asc' },
    })) as OrderRow[];

    const byCompanion = new Map<string, OrderRow[]>();
    for (const o of orders) {
      if (!o.companionId) continue;
      const list = byCompanion.get(o.companionId) || [];
      list.push(o);
      byCompanion.set(o.companionId, list);
    }

    const results: CompanionRisk[] = [];
    for (const c of companions) {
      const cOrders = byCompanion.get(c.id) || [];
      const customers = this.buildCustomerSignals(cOrders);

      const flaggedCount = cOrders.filter((o) => this.isFlagged(o)).length;
      const lowPriceCount = customers.reduce((sum, cs) => sum + cs.lowPriceCount, 0);
      const consumptionDropCount = customers.filter((cs) => cs.consumptionDrop).length;
      const durationDropCount = customers.filter((cs) => cs.durationDrop).length;
      const churnRiskCount = customers.filter((cs) => cs.churnRisk).length;

      const revenueYuan = cOrders.reduce((sum, o) => sum + (o.amount || 0), 0);

      let riskScore = 0;
      riskScore += Math.min(flaggedCount * 15, 45);
      riskScore += Math.min(lowPriceCount * 10, 30);
      riskScore += Math.min(consumptionDropCount * 10, 20);
      riskScore += Math.min(durationDropCount * 5, 10);
      riskScore += Math.min(churnRiskCount * 5, 10);
      riskScore = Math.min(riskScore, 100);

      const riskLevel: CompanionRisk['riskLevel'] = riskScore >= 50 ? 'HIGH' : riskScore >= 20 ? 'MEDIUM' : 'LOW';

      results.push({
        companionId: c.id,
        companionName: c.user?.displayName || c.user?.username || c.id,
        orderCount: cOrders.length,
        revenueYuan: Math.round(revenueYuan * 100) / 100,
        flaggedCount,
        lowPriceCount,
        consumptionDropCount,
        durationDropCount,
        churnRiskCount,
        riskScore,
        riskLevel,
        aiCopy: this.buildAiCopy(c.user?.displayName || c.user?.username || c.id, {
          orderCount: cOrders.length,
          flaggedCount,
          lowPriceCount,
          consumptionDropCount,
          durationDropCount,
          churnRiskCount,
          revenueYuan,
          riskLevel,
        }),
        customers,
      });
    }

    return results.filter((r) => r.orderCount > 0 || r.flaggedCount > 0).sort((a, b) => b.riskScore - a.riskScore);
  }

  private isFlagged(o: OrderRow): boolean {
    if (o.auditStatus === 'FLAGGED') return true;
    if (o.auditAmountCents != null && o.transferTotalCents != null) {
      return o.transferTotalCents < o.auditAmountCents;
    }
    return false;
  }

  private buildCustomerSignals(orders: OrderRow[]): CustomerSignal[] {
    const byCustomer = new Map<string, OrderRow[]>();
    for (const o of orders) {
      const list = byCustomer.get(o.customerId) || [];
      list.push(o);
      byCustomer.set(o.customerId, list);
    }

    const result: CustomerSignal[] = [];
    for (const [customerId, cOrders] of byCustomer) {
      if (cOrders.length < 2) continue;
      const amounts = cOrders.map((o) => o.amount || 0);
      const avgAmount = amounts.reduce((s, v) => s + v, 0) / amounts.length;
      const lastOrderAt = cOrders[cOrders.length - 1].createdAt;

      let lowPriceCount = 0;
      for (let i = 1; i < cOrders.length; i++) {
        const prevAvg = cOrders.slice(0, i).reduce((s, o) => s + (o.amount || 0), 0) / i;
        if (prevAvg > 0 && (cOrders[i].amount || 0) < prevAvg * 0.75) {
          lowPriceCount += 1;
        }
      }

      const consumptionDrop = this.weeklyDrop(cOrders, (o) => o.amount || 0);
      const durationDrop = this.weeklyDrop(cOrders, (o) => o.duration || 0);

      const lastMs = lastOrderAt ? Date.now() - lastOrderAt.getTime() : 0;
      const churnRisk = lastOrderAt != null && lastMs > 14 * 24 * 60 * 60 * 1000 && cOrders.length >= 3;

      result.push({
        customerId,
        orderCount: cOrders.length,
        avgAmount: Math.round(avgAmount * 100) / 100,
        lastOrderAt,
        lowPriceCount,
        consumptionDrop,
        durationDrop,
        churnRisk,
      });
    }

    return result;
  }

  /** 比较最近一个完整周的指标与历史周均值，跌幅超过 50% 视为突降。 */
  private weeklyDrop(orders: OrderRow[], valueOf: (o: OrderRow) => number): boolean {
    const withVals = orders.filter((o) => valueOf(o) > 0);
    if (withVals.length < 4) return false;

    const now = Date.now();
    const buckets = new Map<number, number>();
    for (const o of withVals) {
      const weekStart = Math.floor((now - o.createdAt.getTime()) / WEEK_MS);
      buckets.set(weekStart, (buckets.get(weekStart) || 0) + valueOf(o));
    }

    const sortedWeeks = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
    if (sortedWeeks.length < 2) return false;

    const latestWeek = sortedWeeks[0];
    const history = sortedWeeks.slice(1);
    const historyAvg = history.reduce((s, [, v]) => s + v, 0) / history.length;
    if (historyAvg <= 0) return false;
    return latestWeek[1] < historyAvg * 0.5;
  }

  private buildAiCopy(
    name: string,
    s: {
      orderCount: number;
      flaggedCount: number;
      lowPriceCount: number;
      consumptionDropCount: number;
      durationDropCount: number;
      churnRiskCount: number;
      revenueYuan: number;
      riskLevel: CompanionRisk['riskLevel'];
    },
  ): string {
    const parts: string[] = [];
    if (s.orderCount === 0) return `${name} 近 90 天暂无完成订单，暂无异常基线`;
    parts.push(`${name} 近 90 天完成 ${s.orderCount} 单、流水 ¥${Math.round(s.revenueYuan)}`);
    if (s.flaggedCount > 0) parts.push(`${s.flaggedCount} 单转账与上报金额不符`);
    if (s.lowPriceCount > 0) parts.push(`${s.lowPriceCount} 次单价低于客户历史基线`);
    if (s.consumptionDropCount > 0) parts.push(`${s.consumptionDropCount} 位客户周消费腰斩`);
    if (s.durationDropCount > 0) parts.push(`${s.durationDropCount} 位客户服务时长骤降`);
    if (s.churnRiskCount > 0) parts.push(`${s.churnRiskCount} 位客户疑似流失`);
    if (parts.length === 1) return `${parts[0]}，未见明显异常`;
    const level = s.riskLevel === 'HIGH' ? '高风险，建议重点复核' : s.riskLevel === 'MEDIUM' ? '中风险，建议抽查' : '低风险，常规关注';
    return `${parts.join('；')}，疑似存在私单或客户分流。${level}。`;
  }
}
