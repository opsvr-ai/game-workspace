/**
 * 回头客口径（**全站唯一一份实现** —— 老板 2026-10-04 定稿，2026-10-08 统一到每日数据）。
 *
 * 老板原话（2026-10-08）：「续单率现在有两套算法：每日数据那套是按单算，陪玩详情 / 优秀度那套是按客户算。
 * 后果是同一个人在同一个单里加打一段这种续单，进不了每日数据的续单率。→ 统一成一套」。
 * 所以判一个客户算不算续单 / 复购，**全站只有这里一套**：
 *   · 续单 = 该客户在你这有**第 2 段及以后打完的会话**（`isRenewalSegment`：同一个单里加打一段也算），
 *            或有一张 DONE 的 RENEW / REPURCHASE 单；
 *   · 复购 = 打完首单 / 续单后**隔了一个营业日**客户又来打（另有一张成交单）；
 *   · 分母统一 = **打了首单的客户数**（在他这有一张 DONE 的 NEW 单）；营业日以 12:00 为界；
 *   · 父单和段都必须 DONE —— 「点了续单还在打」不算（老板 2026-10-05：「不打完怎么算？」）。
 * 双陪（老板 2026-10-07）：「被邀请当搭档打的也算他服务过这个客户」——分母照加；
 *   纯搭档关系（没打过首单、也没主陪过这个客户）→ 分母分子都不进（否则会算出 133%）。
 *
 * 调用方只负责「把哪一批单 / 哪些段喂进来」（窗口、店铺、某一天），判定与计数都在这里 ——
 * 修口径只改这一处，优秀度 / 陪玩 KPI 和每日数据自然同步。
 */
import { businessDayKey } from './business-day';

export interface CustomerRateOrder {
  type: string;
  customerId: string | null;
  companionId: string | null;
  coCompanionId: string | null;
  createdAt: Date | string | null;
}

export interface CustomerRateSession {
  /** 这一段所属父单的客户 */
  customerId: string | null;
  companionId: string | null;
  coCompanionId: string | null;
  /** 段上没记人时，退回父单上的人 */
  parentCompanionId?: string | null;
  parentCoCompanionId?: string | null;
}

export interface CustomerRateRow {
  /** 他参与过的成交单数（主陪 + 搭档） */
  orderCount: number;
  /** 打了首单的客户数 = 续单率 / 复购率的分母 */
  firstCustomers: number;
  /** 有续单的客户数（分子） */
  renew: number;
  /** 有复购的客户数（分子） */
  repurchase: number;
}

export function emptyCustomerRateRow(): CustomerRateRow {
  return { orderCount: 0, firstCustomers: 0, renew: 0, repurchase: 0 };
}

/** 率（%）：分母为 0 就是 0，别除出 NaN */
export function ratePercent(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

/**
 * 一批成交单 + 一批打完的会话 → 每个陪玩的「按客户」回头客战绩。
 * `companionIds` 决定算谁：不在名单里的人（比如别的店的搭档）不计。
 */
export function computeCustomerRates(
  companionIds: string[],
  orders: CustomerRateOrder[],
  sessions: CustomerRateSession[],
): Map<string, CustomerRateRow> {
  const ids = new Set(companionIds);
  const out = new Map<string, CustomerRateRow>();
  for (const cid of companionIds) out.set(cid, emptyCustomerRateRow());

  // 段按「实际打这一段的人」归户（会话上的主陪 + 搭档，缺了退回父单上的），
  // 这样搭档也拿得到「他参与过的那次续单」。
  const doneSegments = new Map<string, Map<string, number>>(); // 人 -> 客户 -> 打完的段数
  for (const seg of sessions) {
    if (!seg.customerId) continue;
    const mainId = seg.companionId || seg.parentCompanionId || null;
    const coId = seg.coCompanionId || seg.parentCoCompanionId || null;
    const owners = new Set([mainId, coId].filter((v): v is string => !!v && ids.has(v)));
    for (const pid of owners) {
      let byCust = doneSegments.get(pid);
      if (!byCust) {
        byCust = new Map<string, number>();
        doneSegments.set(pid, byCust);
      }
      byCust.set(seg.customerId, (byCust.get(seg.customerId) || 0) + 1);
    }
  }

  type CustAgg = {
    firstDone: boolean;
    hasRenewType: boolean;
    days: Set<string>;
    /** 他自己主陪过这个客户（不管什么单型）——「算不算他自己的客户」用 */
    mainSeen: boolean;
    count: number;
  };
  const perCustomer = new Map<string, Map<string, CustAgg>>();
  for (const o of orders) {
    if (!o.customerId) continue;
    const day = o.createdAt ? businessDayKey(new Date(o.createdAt)) : null;
    const participants = new Set(
      [o.companionId, o.coCompanionId].filter((v): v is string => !!v && ids.has(v)),
    );
    for (const pid of participants) {
      let byCust = perCustomer.get(pid);
      if (!byCust) {
        byCust = new Map<string, CustAgg>();
        perCustomer.set(pid, byCust);
      }
      const agg =
        byCust.get(o.customerId) ||
        ({ firstDone: false, hasRenewType: false, days: new Set<string>(), mainSeen: false, count: 0 } as CustAgg);
      agg.count += 1;
      if (o.companionId === pid) agg.mainSeen = true; // 主陪过这个客户（哪怕首单在窗口外）
      if (o.type === 'RENEW' || o.type === 'REPURCHASE') agg.hasRenewType = true;
      if (o.type === 'NEW') agg.firstDone = true;
      if (day) agg.days.add(day);
      byCust.set(o.customerId, agg);
    }
  }

  for (const [cid, byCust] of perCustomer) {
    const row = out.get(cid)!;
    for (const [custId, agg] of byCust) {
      row.orderCount += agg.count;
      const doneSegs = doneSegments.get(cid)?.get(custId) || 0;
      if (agg.firstDone) row.firstCustomers += 1; // 打了首单的客户数 = 分母
      // 分子只在「算得上他自己的客户」里数（老板 2026-10-07 双陪改动后的收口）：
      //   · 在他这打过首单的客户 → 算；
      //   · 他自己主陪过的客户 → 也算（首单在 30 天窗口外、窗口内又回来续单的照样算）；
      //   · 纯搭档关系（从没当过主陪、也没打过首单）→ 分母分子都不进。
      if (!agg.firstDone && !agg.mainSeen) continue;
      if (doneSegs >= 2 || agg.hasRenewType) row.renew += 1;
      if (agg.days.size >= 2) row.repurchase += 1; // 隔了一个营业日又来打（另有成交单，且父单 DONE）
    }
  }
  return out;
}
