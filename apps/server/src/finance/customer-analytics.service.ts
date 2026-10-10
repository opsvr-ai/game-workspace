import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isBelowPriceFloor, isRenewalSegment, partnerUnitPriceYuan, priceStatsFloor, resolvePriceMode } from '../common/price-rules';

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
  /** 单价低于底线（机密 < 35 / 绝密 < 45）的会话次数 —— 老板 2026-10-04 的口径。 */
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
/** 主陪 + 同一个搭档，低价次数到这个数就让老板重点关注这 2 个人。 */
export const LOW_PRICE_PAIR_WATCH_THRESHOLD = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class CustomerAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRiskQueue(studioId: string | null): Promise<CompanionRisk[]> {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    // 老板没有工作室：不筛工作室 = 看全站（以前传 null 会筛出 0 个人，老板那儿一直是空的）。
    const studioWhere = studioId ? { studioId } : {};

    const companions = await this.prisma.companion.findMany({
      where: { ...studioWhere },
      select: { id: true, user: { select: { username: true, displayName: true } } },
    });

    const orders = (await this.prisma.order.findMany({
      where: { ...studioWhere, status: 'DONE', createdAt: { gte: since }, companionId: { not: null } },
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

    // 单价低于底线（首单 机密 35 / 绝密 45，续单 / 复购 机密 40 / 绝密 60）：**只统计、不拦单**（老板 2026-10-04）。
    const belowFloorSessions = await this.prisma.orderSession
      .findMany({
        where: { startedAt: { gte: since }, ...(studioId ? { parentOrder: { studioId } } : {}) },
        select: {
          id: true,
          companionId: true,
          coCompanionId: true,
          claimedMode: true,
          claimedPrice: true,
          coAmount: true,
          duration: true,
          seq: true,
          parentOrder: { select: { customerId: true, type: true, customFields: true } },
        },
      })
      .catch(() => [] as any[]);

    const belowFloorByCompanion = new Map<string, number>();
    const belowFloorByCustomer = new Map<string, number>();
    for (const row of belowFloorSessions) {
      // 主陪价、副陪单价（副陪这段总价 / 时长）任意一边低于底线就算一次，填 0 也算。
      // 续单 / 复购（单子类型 RENEW / REPURCHASE，或这张单的第 2 段及以后）按 40 / 60 判；
      // 陪玩没填 claimedMode 时退回客服发单填的模式，否则整段漏判。
      const mode = resolvePriceMode(row.claimedMode, row.parentOrder?.customFields);
      const isRenewal = isRenewalSegment(row.parentOrder?.type, row.seq);
      const mainBelow = isBelowPriceFloor(mode, row.claimedPrice, isRenewal);
      const partnerBelow =
        !!row.coCompanionId && isBelowPriceFloor(mode, partnerUnitPriceYuan(row.coAmount, row.duration), isRenewal);
      if (!mainBelow && !partnerBelow) continue;
      for (const id of [row.companionId, row.coCompanionId]) {
        if (!id) continue;
        belowFloorByCompanion.set(id, (belowFloorByCompanion.get(id) || 0) + 1);
      }
      const cid = row.parentOrder?.customerId;
      if (cid) belowFloorByCustomer.set(cid, (belowFloorByCustomer.get(cid) || 0) + 1);
    }

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
      const customers = this.buildCustomerSignals(cOrders, belowFloorByCustomer);

      const flaggedCount = cOrders.filter((o) => this.isFlagged(o)).length;
      const lowPriceCount = belowFloorByCompanion.get(c.id) || 0;
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

  /**
   * 「低价搭档组合」（老板 2026-10-04）：
   *   主陪 + 同一个搭档，反复在客户的首单 / 续单 / 复购里填最低价 —— 老板要拿这个去**重点盯这 2 个人**。
   * 只看双陪（有搭档）的组合：主陪价 或 副陪单价（副陪总价 / 时长）低于底线算一次异常（lowPriceCount，
   * 低了 3 次标「重点关注」）；正好按底线打的另记 floorPriceCount，方便老板看「谁老是按最低价打」，但不标红。
   * 底线分两档（老板 2026-10-04）：「机密续单/复购 40-60 是正常的，绝密续单/复购 60-80 是正常的」——
   * **首单** 机密 35 / 绝密 45，**续单 / 复购** 机密 40 / 绝密 60（续单 / 复购按 35 / 45 判会漏报）。
   */
  async getLowPricePairs(studioId: string | null, days = 30) {
    const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
    const sessions = await this.prisma.orderSession
      .findMany({
        where: { startedAt: { gte: since }, ...(studioId ? { parentOrder: { studioId } } : {}) },
        select: {
          id: true,
          companionId: true,
          coCompanionId: true,
          claimedMode: true,
          claimedPrice: true,
          coAmount: true,
          duration: true,
          seq: true,
          startedAt: true,
          parentOrder: { select: { type: true, customerId: true, customFields: true } },
        },
        orderBy: { startedAt: 'desc' },
        take: 5000,
      })
      .catch(() => [] as any[]);

    type PairAgg = {
      mainId: string;
      partnerId: string;
      /** 低于底线的次数 —— 真异常（首单 机密 < 35 / 绝密 < 45，续单 / 复购 机密 < 40 / 绝密 < 60）。 */
      lowCount: number;
      /** 正好按底线打的次数 —— 老板 2026-10-04：「这个 35 跟 45 就是个统计」。 */
      floorCount: number;
      sessionCount: number;
      customers: Set<string>;
      types: Set<string>;
      modes: Set<string>;
      minPrice: number | null;
      minPartnerPrice: number | null;
      lastAt: Date | null;
    };
    const pairs = new Map<string, PairAgg>();

    for (const row of sessions) {
      if (!row.companionId || !row.coCompanionId) continue; // 只看双陪
      const key = [row.companionId, row.coCompanionId].sort().join('|');
      const item: PairAgg =
        pairs.get(key) || {
          mainId: row.companionId,
          partnerId: row.coCompanionId,
          lowCount: 0,
          floorCount: 0,
          sessionCount: 0,
          customers: new Set<string>(),
          types: new Set<string>(),
          modes: new Set<string>(),
          minPrice: null,
          minPartnerPrice: null,
          lastAt: null,
        };
      item.sessionCount += 1;
      if (row.parentOrder?.customerId) item.customers.add(row.parentOrder.customerId);
      if (row.parentOrder?.type) item.types.add(row.parentOrder.type);

      // 主陪价、副陪单价（副陪这段总价 / 时长）任意一边低于底线 = 一次异常；副陪填 0 也算异常。
      // 续单 / 复购（RENEW / REPURCHASE，或第 2 段及以后）底线是机密 40 / 绝密 60。
      const mode = resolvePriceMode(row.claimedMode, row.parentOrder?.customFields);
      const isRenewal = isRenewalSegment(row.parentOrder?.type, row.seq);
      const floor = priceStatsFloor(mode, isRenewal);
      const partnerUnit = partnerUnitPriceYuan(row.coAmount, row.duration);
      const isLow =
        isBelowPriceFloor(mode, row.claimedPrice, isRenewal) ||
        isBelowPriceFloor(mode, partnerUnit, isRenewal);
      const isAtFloor = !isLow && floor != null && (row.claimedPrice === floor || partnerUnit === floor);
      if (isLow) item.lowCount += 1;
      if (isAtFloor) item.floorCount += 1;
      if (isLow || isAtFloor) {
        if (mode) item.modes.add(mode);
        if (row.startedAt && (!item.lastAt || row.startedAt > item.lastAt)) item.lastAt = row.startedAt;
      }
      if (row.claimedPrice != null && (item.minPrice == null || row.claimedPrice < item.minPrice)) {
        item.minPrice = row.claimedPrice;
      }
      if (partnerUnit != null && (item.minPartnerPrice == null || partnerUnit < item.minPartnerPrice)) {
        item.minPartnerPrice = partnerUnit;
      }
      pairs.set(key, item);
    }

    const ids = new Set<string>();
    for (const p of pairs.values()) {
      ids.add(p.mainId);
      ids.add(p.partnerId);
    }
    const companions = ids.size
      ? await this.prisma.companion.findMany({
          where: { id: { in: [...ids] } },
          select: { id: true, user: { select: { username: true, displayName: true } } },
        })
      : [];
    const nameOf = (id: string) => {
      const c = companions.find((x) => x.id === id);
      return c?.user?.displayName || c?.user?.username || id;
    };

    return [...pairs.values()]
      .filter((p) => p.lowCount > 0 || p.floorCount > 0)
      .map((p) => ({
        mainCompanionId: p.mainId,
        mainCompanionName: nameOf(p.mainId),
        partnerCompanionId: p.partnerId,
        partnerCompanionName: nameOf(p.partnerId),
        lowPriceCount: p.lowCount,
        floorPriceCount: p.floorCount,
        sessionCount: p.sessionCount,
        customerCount: p.customers.size,
        minPriceYuan: p.minPrice,
        minPartnerPriceYuan: p.minPartnerPrice,
        modes: [...p.modes],
        orderTypes: [...p.types],
        lastAt: p.lastAt,
        watch: p.lowCount >= LOW_PRICE_PAIR_WATCH_THRESHOLD,
      }))
      .sort(
        (a, b) =>
          b.lowPriceCount - a.lowPriceCount ||
          b.floorPriceCount - a.floorPriceCount ||
          b.customerCount - a.customerCount,
      );
  }

  private isFlagged(o: OrderRow): boolean {
    if (o.auditStatus === 'FLAGGED') return true;
    if (o.auditAmountCents != null && o.transferTotalCents != null) {
      return o.transferTotalCents < o.auditAmountCents;
    }
    return false;
  }

  private buildCustomerSignals(
    orders: OrderRow[],
    belowFloorByCustomer: Map<string, number> = new Map(),
  ): CustomerSignal[] {
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

      // 低价口径：单价低于底线（机密 < 35 / 绝密 < 45）的次数（老板 2026-10-04）。
      // 原来按「比自己的历史均价低 25%」算，客户单价本来就低的时候会误报。
      const lowPriceCount = belowFloorByCustomer.get(customerId) || 0;

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
    parts.push(`${name} 近 90 天完成 ${s.orderCount} 单、业绩 ¥${Math.round(s.revenueYuan)}`);
    if (s.flaggedCount > 0) parts.push(`${s.flaggedCount} 单转账与上报金额不符`);
    if (s.lowPriceCount > 0) parts.push(`${s.lowPriceCount} 次单价低于底线（首单 机密 35 / 绝密 45，续单 / 复购 机密 40 / 绝密 60）`);
    if (s.consumptionDropCount > 0) parts.push(`${s.consumptionDropCount} 位客户周消费腰斩`);
    if (s.durationDropCount > 0) parts.push(`${s.durationDropCount} 位客户服务时长骤降`);
    if (s.churnRiskCount > 0) parts.push(`${s.churnRiskCount} 位客户疑似流失`);
    if (parts.length === 1) return `${parts[0]}，未见明显异常`;
    const level = s.riskLevel === 'HIGH' ? '高风险，建议重点复核' : s.riskLevel === 'MEDIUM' ? '中风险，建议抽查' : '低风险，常规关注';
    return `${parts.join('；')}，疑似存在私单或客户分流。${level}。`;
  }
}
