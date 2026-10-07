// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { currentBusinessDayRange, businessDayRange, businessDayKey } from '../common/business-day';

export interface DailyStatsItem {
  csUserId: string;
  csName: string;
  csDisplayName?: string | null;
  studioId: string;
  studioName: string;
  studioType: string;
  totalOrders: number;
  totalAmount: number;
  claimedCount: number;
  claimedAmount: number;
  directCount: number;
  directAmount: number;
  bridgeCount: number;
  bridgeAmount: number;
  clubCount: number;
  clubAmount: number;
  unassignedCount: number;
  unassignedAmount: number;
  feePaidCount: number;
  feeUnpaidCount: number;
  wechatCount: number;
  wechatAmount: number;
  alipayCount: number;
  alipayAmount: number;
  studioBreakdown: { studioName: string; studioType: string; isOwn: boolean; count: number; amount: number }[];
}

export interface DailyStatsResponse {
  dateFrom: string;
  dateTo: string;
  summary: {
    totalOrders: number;
    totalAmount: number;
    claimedCount: number;
    claimedAmount: number;
    directCount: number;
    directAmount: number;
    bridgeCount: number;
    bridgeAmount: number;
    clubCount: number;
    clubAmount: number;
    unassignedCount: number;
    unassignedAmount: number;
    feePaidCount: number;
    feeUnpaidCount: number;
    wechatCount: number;
    wechatAmount: number;
    alipayCount: number;
    alipayAmount: number;
  };
  csList: DailyStatsItem[];
  orders: any[];
}

// ── 每日数据（老板 2026-10-07）───────────────────────────────────────────────
// 老板原话：「陪玩端+管理端清清楚楚的知道每天打了多少单，多少续了，续单率多少，
// 多少复购了，复购率多少，以及客户的情况，一目了然的那种，而且能点开查看明细」。
//
// 口径（全部按**营业日 12:00 为界**，跟运营看板 / 实时看板 / 客户看板同一条时间线）：
//   · 单量 / 金额 / 客户数 / 单型：**订单** createdAt 落在该营业日、status = DONE；
//   · 时长：**会话** startedAt 落在该营业日、status = DONE 的 duration 之和（与客户看板同口径）；
//   · 续单 / 复购：直接数订单类型 RENEW / REPURCHASE 的**单**；
//   · 「搭档单」= 他作为搭档（coCompanionId）参与的单 —— **参与即算他的量**，
//     跟 2026-10-07「被邀请打的也算他服务过这个客户」同一条规矩；
//   · 陪玩端只能看自己；管理端看全店，也可以筛某一个陪玩。
//
// ⚠️ 这里给的是「**按单**」的续单率 / 复购率（续单 ÷ 成交单），跟 30 天 KPI 的
// 「**按客户**」口径（打了首单的客户里有多少续了）不是一回事 —— 页面上必须写清楚，
// 免得又被拿来互相对数字（2026-10-07「今日单量对么」就是这么来的）。

export interface DailyKpiRow {
  /** 营业日 YYYY-MM-DD（12:00 起算） */
  date: string;
  /** 成交单数（已打完） */
  orders: number;
  /** 其中他当搭档（被主陪邀请）参与的单 */
  partnerOrders: number;
  /** 首单 / 续单 / 复购 / 其它（按订单类型） */
  first: number;
  renew: number;
  repurchase: number;
  other: number;
  /** 续单率 / 复购率：**按单**算（续单数 ÷ 成交单数） */
  renewRate: number;
  repurchaseRate: number;
  /** 当天服务过的客户数（去重） */
  customers: number;
  /** 当天在他这打了首单的客户数（新客） */
  newCustomers: number;
  /** 当天流水（元） */
  amount: number;
  /** 当天时长（小时，按打完的会话算） */
  hours: number;
}

export interface DailyKpiResponse {
  scope: 'STORE' | 'COMPANION';
  dateFrom: string;
  dateTo: string;
  companionId: string | null;
  companionName: string | null;
  rows: DailyKpiRow[];
  total: DailyKpiRow;
  /** 管理端「筛陪玩」用的下拉（陪玩端为空） */
  companions: Array<{ id: string; name: string; resigned: boolean }>;
}

export interface DailyKpiDetailOrder {
  id: string;
  orderCode: string | null;
  type: string;
  gameName: string;
  amount: number;
  hours: number;
  customerId: string;
  customerCode: string;
  customerWechat: string;
  companionName: string | null;
  coCompanionName: string | null;
  csName: string | null;
  iAmPartner: boolean;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface DailyKpiDetailCustomer {
  customerId: string;
  customerCode: string;
  customerWechat: string;
  orders: number;
  hours: number;
  amount: number;
  totalOrders: number;
  totalHours: number;
  totalAmount: number;
  firstAt: string | null;
  lastAt: string | null;
  /** 当天在这个客户身上出现的单型（首单 / 续单 / 复购） */
  kinds: string[];
}

export interface DailyKpiDetailResponse {
  date: string;
  scope: 'STORE' | 'COMPANION';
  orders: DailyKpiDetailOrder[];
  customers: DailyKpiDetailCustomer[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 每日数据默认看最近 14 个营业日 */
const DAILY_KPI_DEFAULT_DAYS = 14;
/** 一次最多查 62 个营业日（约两个月），防止手输区间把库拖死 */
const DAILY_KPI_MAX_DAYS = 62;

function normDay(v?: string): string | null {
  const s = String(v || '').trim();
  return DAY_RE.test(s) ? s : null;
}

/** 营业日键 +N 天 */
function shiftDayKey(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  dt.setDate(dt.getDate() + delta);
  return businessDayKey(dt);
}

/** 两个营业日键之间差几天（b - a） */
function dayKeyDiff(a: string, b: string): number {
  const toNum = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toNum(b) - toNum(a)) / 86400000);
}

function emptyDailyKpiRow(date: string): DailyKpiRow {
  return {
    date,
    orders: 0,
    partnerOrders: 0,
    first: 0,
    renew: 0,
    repurchase: 0,
    other: 0,
    renewRate: 0,
    repurchaseRate: 0,
    customers: 0,
    newCustomers: 0,
    amount: 0,
    hours: 0,
  };
}

function round1(n: unknown): number {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function companionLabel(c: any): string {
  return c?.user?.displayName || c?.user?.username || '陪玩';
}

function emptyDailyStatsItem(
  csUserId: string,
  csName: string,
  csDisplayName: string | null | undefined,
  studioId: string,
  studioName: string,
  studioType: string,
): DailyStatsItem {
  return {
    csUserId,
    csName,
    csDisplayName: csDisplayName || null,
    studioId,
    studioName,
    studioType,
    totalOrders: 0,
    totalAmount: 0,
    claimedCount: 0,
    claimedAmount: 0,
    directCount: 0,
    directAmount: 0,
    bridgeCount: 0,
    bridgeAmount: 0,
    clubCount: 0,
    clubAmount: 0,
    unassignedCount: 0,
    unassignedAmount: 0,
    feePaidCount: 0,
    feeUnpaidCount: 0,
    wechatCount: 0,
    wechatAmount: 0,
    alipayCount: 0,
    alipayAmount: 0,
    studioBreakdown: [],
  };
}

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getDailyStats(
    filters: {
      date?: string;
      dateFrom?: string;
      dateTo?: string;
      csUserId?: string;
      studioId?: string;
      status?: string;
      gameName?: string;
      feeStatus?: string;
    },
    user?: any,
  ): Promise<DailyStatsResponse> {
    // Date range
    let startOfDay: Date;
    let endOfDay: Date;

    if (filters.dateFrom && filters.dateTo) {
      startOfDay = businessDayRange(filters.dateFrom).start;
      endOfDay = businessDayRange(filters.dateTo).end;
    } else if (filters.date) {
      const range = businessDayRange(filters.date);
      startOfDay = range.start;
      endOfDay = range.end;
    } else {
      const range = currentBusinessDayRange();
      startOfDay = range.start;
      endOfDay = range.end;
    }

    // Build where clause
    const where: any = {
      createdAt: { gte: startOfDay, lt: endOfDay },
    };

    if (user) {
      if (user.role === 'CS') {
        where.csUserId = user.id;
      } else if (user.role === 'COMPANION') {
        where.companionId = user.companionId;
      } else if (user.role === 'ADMIN') {
        where.studioId = user.studioId;
      }
    }

    // Apply filters (override role-based if owner/admin explicitly filters)
    if (filters.csUserId && user?.role !== 'CS') where.csUserId = filters.csUserId;
    if (filters.studioId && (user?.role === 'OWNER')) where.studioId = filters.studioId;
    if (filters.status) where.status = filters.status;
    if (filters.gameName) where.gameName = { contains: filters.gameName };
    if (filters.feeStatus) where.companionFeeStatus = filters.feeStatus;

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        csUser: { select: { id: true, username: true, displayName: true } },
        claimedCsUser: { select: { id: true, username: true, displayName: true } },
        companion: {
          include: {
            studio: { select: { id: true, name: true, type: true } },
            user: { select: { username: true, displayName: true } },
          },
        },
        studio: { select: { id: true, name: true, type: true } },
        paymentAccount: { select: { id: true, accountName: true, accountNumber: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by CS user
    const csMap = new Map<string, DailyStatsItem>();

    for (const order of orders) {
      const csId = order.csUserId;
      if (!csMap.has(csId)) {
        csMap.set(
          csId,
          emptyDailyStatsItem(
            csId,
            order.csUser?.username || '未知',
            order.csUser?.displayName,
            order.studioId,
            (order.studio as any)?.name || '',
            (order.studio as any)?.type || '',
          ),
        );
      }

      const item = csMap.get(csId)!;
      item.totalOrders++;
      item.totalAmount += order.amount;

      if (!order.companionId) {
        item.unassignedCount++;
        item.unassignedAmount += order.amount;
      } else {
        const compStudio = (order.companion as any)?.studio;
        const compStudioName = compStudio?.name || '未知';
        const compStudioType = compStudio?.type || '';
        const compStudioId = compStudio?.id || '';

        // Legacy counts
        if (compStudioId === order.studioId) {
          item.directCount++;
          item.directAmount += order.amount;
        } else if (compStudioType === 'RENTAL') {
          item.clubCount++;
          item.clubAmount += order.amount;
        } else {
          item.bridgeCount++;
          item.bridgeAmount += order.amount;
        }

        // Per-studio breakdown
        const key = compStudioName;
        const existing = item.studioBreakdown.find(b => b.studioName === key);
        if (existing) {
          existing.count++;
          existing.amount += order.amount;
        } else {
          item.studioBreakdown.push({
            studioName: compStudioName,
            studioType: compStudioType,
            isOwn: compStudioId === order.studioId,
            count: 1,
            amount: order.amount,
          });
        }
      }

      if (order.companionFeeStatus === 'PAID') {
        item.feePaidCount++;
      } else {
        item.feeUnpaidCount++;
      }
      if (order.companionFeeMethod === 'WECHAT') {
        item.wechatCount++;
        item.wechatAmount += Math.round((order.companionFeeAmount || 0) * 100) / 100;
      } else if (order.companionFeeMethod === 'ALIPAY') {
        item.alipayCount++;
        item.alipayAmount += Math.round((order.companionFeeAmount || 0) * 100) / 100;
      }
    }

    // CS self-claim attribution for the same date/scope
    const claimedWhere: any = { claimedAt: { gte: startOfDay, lt: endOfDay } };
    if (user) {
      if (user.role === 'CS') {
        claimedWhere.claimedCsUserId = user.id;
      } else if (user.role === 'ADMIN') {
        claimedWhere.studioId = user.studioId;
      }
    }
    if (filters.csUserId && user?.role !== 'CS') claimedWhere.claimedCsUserId = filters.csUserId;
    if (filters.studioId && user?.role === 'OWNER') claimedWhere.studioId = filters.studioId;
    if (filters.status) claimedWhere.status = filters.status;
    const claimedOrders = await this.prisma.order.findMany({
      where: claimedWhere,
      select: {
        claimedCsUserId: true,
        amount: true,
        csWorkWechatName: true,
        studio: { select: { id: true, name: true, type: true } },
        claimedCsUser: { select: { id: true, username: true, displayName: true } },
      },
    });
    const claimedMap = new Map<string, { count: number; amount: number }>();
    for (const co of claimedOrders) {
      if (!co.claimedCsUserId) continue;
      const entry = claimedMap.get(co.claimedCsUserId) || { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += co.amount;
      claimedMap.set(co.claimedCsUserId, entry);
    }

    for (const co of claimedOrders) {
      if (!co.claimedCsUserId || csMap.has(co.claimedCsUserId)) continue;
      csMap.set(
        co.claimedCsUserId,
        emptyDailyStatsItem(
          co.claimedCsUserId,
          co.claimedCsUser?.username || '未知',
          co.claimedCsUser?.displayName,
          co.studio?.id || '',
          co.studio?.name || '',
          co.studio?.type || '',
        ),
      );
    }

    for (const item of csMap.values()) {
      const claimed = claimedMap.get(item.csUserId);
      item.claimedCount = claimed?.count || 0;
      item.claimedAmount = claimed?.amount || 0;
    }

    const csList = Array.from(csMap.values());

    const summary = {
      totalOrders: 0,
      totalAmount: 0,
      claimedCount: 0,
      claimedAmount: 0,
      directCount: 0, directAmount: 0,
      bridgeCount: 0, bridgeAmount: 0,
      clubCount: 0, clubAmount: 0,
      unassignedCount: 0, unassignedAmount: 0,
      feePaidCount: 0, feeUnpaidCount: 0,
      wechatCount: 0, wechatAmount: 0,
      alipayCount: 0, alipayAmount: 0,
    };

    for (const item of csList) {
      summary.totalOrders += item.totalOrders;
      summary.totalAmount += item.totalAmount;
      summary.claimedCount += item.claimedCount;
      summary.claimedAmount += item.claimedAmount;
      summary.directCount += item.directCount;
      summary.directAmount += item.directAmount;
      summary.bridgeCount += item.bridgeCount;
      summary.bridgeAmount += item.bridgeAmount;
      summary.clubCount += item.clubCount;
      summary.clubAmount += item.clubAmount;
      summary.unassignedCount += item.unassignedCount;
      summary.unassignedAmount += item.unassignedAmount;
      summary.feePaidCount += item.feePaidCount;
      summary.feeUnpaidCount += item.feeUnpaidCount;
      summary.wechatCount += item.wechatCount;
      summary.wechatAmount += item.wechatAmount;
      summary.alipayCount += item.alipayCount;
      summary.alipayAmount += item.alipayAmount;
    }

    return {
      dateFrom: startOfDay.toISOString().slice(0, 10),
      dateTo: new Date(endOfDay.getTime() - 1).toISOString().slice(0, 10),
      summary,
      csList,
      orders: orders.map((o) => ({
        id: o.id,
        orderCode: o.orderCode,
        type: o.type,
        gameName: o.gameName,
        amount: o.amount,
        status: o.status,
        dispatchType: o.dispatchType,
        createdAt: o.createdAt,
        csUserId: o.csUserId,
        csName: o.csUser?.username,
        claimedCsUserId: o.claimedCsUserId,
        claimedCsName: o.claimedCsUser?.username || null,
        csWorkWechatName: o.csWorkWechatName,
        customerPaidTo: o.customerPaidTo,
        customerPaymentAccountName: o.customerPaymentAccountName,
        companionId: o.companionId,
        companionName: (o.companion as any)?.user?.username || null,
        companionStudio: (o.companion as any)?.studio?.name || null,
        companionStudioType: (o.companion as any)?.studio?.type || null,
        paymentAccount: o.paymentAccount
          ? `${o.paymentAccount.accountName}(${o.paymentAccount.type === 'WECHAT' ? '微信' : '支付宝'})`
          : null,
        companionFeeStatus: o.companionFeeStatus,
        companionFeeMethod: o.companionFeeMethod,
        companionFeeAccount: o.companionFeeAccount,
        companionFeeAmount: o.companionFeeAmount,
      })),
    };
  }

  // ── 每日数据（老板 2026-10-07）─────────────────────────────────────────────

  /**
   * 角色 → 取数范围。
   *   陪玩：只可能看自己（传别人的 id 也强制回自己）；
   *   店长 / 客服：本店；传了 companionId 就只看那一个人；
   *   老板：全部工作室（没传 studioId 时不加店铺过滤）。
   */
  private dailyScope(
    user: any,
    companionId?: string,
  ): { scope: 'STORE' | 'COMPANION'; companionId: string | null; studioId: string | null } {
    const role = user?.role;
    if (role === 'COMPANION') {
      return { scope: 'COMPANION', companionId: user?.companionId || null, studioId: user?.studioId || null };
    }
    const studioId = role === 'OWNER' ? null : user?.studioId || null;
    if (companionId) return { scope: 'COMPANION', companionId, studioId };
    return { scope: 'STORE', companionId: null, studioId };
  }

  /** 营业日区间（含两端）→ 归一化后的 [dateFrom, dateTo] 与起止时间 */
  private dailyRange(dateFrom?: string, dateTo?: string) {
    const today = businessDayKey(new Date());
    const to = normDay(dateTo) || today;
    let from = normDay(dateFrom) || shiftDayKey(to, -(DAILY_KPI_DEFAULT_DAYS - 1));
    if (from > to) from = to;
    if (dayKeyDiff(from, to) > DAILY_KPI_MAX_DAYS - 1) from = shiftDayKey(to, -(DAILY_KPI_MAX_DAYS - 1));
    return { dateFrom: from, dateTo: to, start: businessDayRange(from).start, end: businessDayRange(to).end };
  }

  /** 每天打了多少单 / 多少续了 / 多少复购 / 什么客户 —— 陪玩端看自己，管理端看全店或某个人。 */
  async getDailyKpi(
    filters: { dateFrom?: string; dateTo?: string; companionId?: string },
    user?: any,
  ): Promise<DailyKpiResponse> {
    const { dateFrom, dateTo, start, end } = this.dailyRange(filters.dateFrom, filters.dateTo);
    const { scope, companionId, studioId } = this.dailyScope(user, filters.companionId);

    const orderWhere: any = { status: 'DONE', createdAt: { gte: start, lt: end } };
    if (studioId) orderWhere.studioId = studioId;
    if (companionId) orderWhere.OR = [{ companionId }, { coCompanionId: companionId }];

    const orders = (await this.prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        type: true,
        amount: true,
        customerId: true,
        companionId: true,
        coCompanionId: true,
        createdAt: true,
      },
    })) as any[];

    // 时长跟客户看板同一个源（会话），按会话自己的 startedAt 归到那一天。
    const sessionWhere: any = { status: 'DONE', startedAt: { gte: start, lt: end } };
    const parentScope: any = {};
    if (studioId) parentScope.studioId = studioId;
    if (companionId) parentScope.OR = [{ companionId }, { coCompanionId: companionId }];
    if (Object.keys(parentScope).length) sessionWhere.parentOrder = parentScope;
    const sessions = (await this.prisma.orderSession.findMany({
      where: sessionWhere,
      select: { startedAt: true, duration: true },
    })) as any[];

    const byDay = new Map<string, DailyKpiRow>();
    const custByDay = new Map<string, Set<string>>();
    const newCustByDay = new Map<string, Set<string>>();
    const ensure = (date: string): DailyKpiRow => {
      let row = byDay.get(date);
      if (!row) {
        row = emptyDailyKpiRow(date);
        byDay.set(date, row);
      }
      return row;
    };

    for (const o of orders) {
      if (!o.createdAt) continue;
      const day = businessDayKey(o.createdAt);
      const row = ensure(day);
      row.orders += 1;
      if (o.type === 'NEW') row.first += 1;
      else if (o.type === 'RENEW') row.renew += 1;
      else if (o.type === 'REPURCHASE') row.repurchase += 1;
      else row.other += 1;
      row.amount += Number(o.amount) || 0;
      // 他当搭档（被邀请）参与的单：单独列出来，一眼看得出「这里面有几张不是我主陪的」
      if (companionId && o.coCompanionId === companionId) row.partnerOrders += 1;

      if (o.customerId) {
        let set = custByDay.get(day);
        if (!set) {
          set = new Set();
          custByDay.set(day, set);
        }
        set.add(o.customerId);
        if (o.type === 'NEW') {
          let ns = newCustByDay.get(day);
          if (!ns) {
            ns = new Set();
            newCustByDay.set(day, ns);
          }
          ns.add(o.customerId);
        }
      }
    }

    for (const s of sessions) {
      if (!s.startedAt) continue;
      const row = byDay.get(businessDayKey(s.startedAt));
      if (row) row.hours += Number(s.duration) || 0;
    }

    // 合计按原始值算（先加再四舍五入），免得逐行取整后加出来对不上。
    let tOrders = 0;
    let tPartner = 0;
    let tFirst = 0;
    let tRenew = 0;
    let tRepurchase = 0;
    let tOther = 0;
    let tAmount = 0;
    let tHours = 0;
    const allCust = new Set<string>();
    const allNewCust = new Set<string>();
    for (const row of byDay.values()) {
      tOrders += row.orders;
      tPartner += row.partnerOrders;
      tFirst += row.first;
      tRenew += row.renew;
      tRepurchase += row.repurchase;
      tOther += row.other;
      tAmount += row.amount;
      tHours += row.hours;
      for (const c of custByDay.get(row.date) || []) allCust.add(c);
      for (const c of newCustByDay.get(row.date) || []) allNewCust.add(c);
    }

    const rows: DailyKpiRow[] = [...byDay.values()]
      .map((row) => ({
        ...row,
        amount: round1(row.amount),
        hours: round1(row.hours),
        customers: custByDay.get(row.date)?.size || 0,
        newCustomers: newCustByDay.get(row.date)?.size || 0,
        renewRate: row.orders ? Math.round((row.renew / row.orders) * 100) : 0,
        repurchaseRate: row.orders ? Math.round((row.repurchase / row.orders) * 100) : 0,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    const total: DailyKpiRow = {
      ...emptyDailyKpiRow(dateFrom === dateTo ? dateFrom : dateFrom + ' ~ ' + dateTo),
      orders: tOrders,
      partnerOrders: tPartner,
      first: tFirst,
      renew: tRenew,
      repurchase: tRepurchase,
      other: tOther,
      amount: round1(tAmount),
      hours: round1(tHours),
      customers: allCust.size,
      newCustomers: allNewCust.size,
      renewRate: tOrders ? Math.round((tRenew / tOrders) * 100) : 0,
      repurchaseRate: tOrders ? Math.round((tRepurchase / tOrders) * 100) : 0,
    };

    let companions: Array<{ id: string; name: string; resigned: boolean }> = [];
    if (scope === 'STORE') {
      const list = (await this.prisma.companion.findMany({
        where: studioId ? { studioId } : {},
        select: { id: true, isResigned: true, user: { select: { username: true, displayName: true } } },
      })) as any[];
      companions = list
        .map((c) => ({ id: c.id, name: companionLabel(c), resigned: !!c.isResigned }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    }

    let companionName: string | null = null;
    if (companionId) {
      const one = (await this.prisma.companion.findUnique({
        where: { id: companionId },
        select: { user: { select: { username: true, displayName: true } } },
      })) as any;
      companionName = one ? companionLabel(one) : null;
    }

    return { scope, dateFrom, dateTo, companionId: companionId || null, companionName, rows, total, companions };
  }

  /** 点开某一天的明细：这一天的每张单 + 这一天每个客户的「当天 / 累计」情况。 */
  async getDailyKpiDetail(
    filters: { date?: string; companionId?: string; kind?: string },
    user?: any,
  ): Promise<DailyKpiDetailResponse> {
    const date = normDay(filters.date) || businessDayKey(new Date());
    const { scope, companionId, studioId } = this.dailyScope(user, filters.companionId);
    const { start, end } = businessDayRange(date);

    const orderWhere: any = { status: 'DONE', createdAt: { gte: start, lt: end } };
    if (studioId) orderWhere.studioId = studioId;
    if (companionId) orderWhere.OR = [{ companionId }, { coCompanionId: companionId }];
    const kind = String(filters.kind || '').toUpperCase();
    if (kind === 'NEW' || kind === 'RENEW' || kind === 'REPURCHASE') orderWhere.type = kind;

    const orders = (await this.prisma.order.findMany({
      where: orderWhere,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        orderCode: true,
        type: true,
        amount: true,
        gameName: true,
        createdAt: true,
        customerId: true,
        companionId: true,
        coCompanionId: true,
        customer: { select: { customerCode: true, wechatId: true } },
        companion: { select: { user: { select: { username: true, displayName: true } } } },
        coCompanion: { select: { user: { select: { username: true, displayName: true } } } },
        csUser: { select: { username: true, displayName: true } },
        sessions: { where: { status: 'DONE' }, select: { duration: true, startedAt: true, endedAt: true } },
      },
    })) as any[];

    const orderRows: DailyKpiDetailOrder[] = orders.map((o) => {
      const sess = (o.sessions || []) as any[];
      const hours = sess.reduce((s: number, x: any) => s + (Number(x.duration) || 0), 0);
      const starts = sess
        .map((x: any) => x.startedAt)
        .filter(Boolean)
        .sort((a: Date, b: Date) => a.getTime() - b.getTime());
      const ends = sess
        .map((x: any) => x.endedAt)
        .filter(Boolean)
        .sort((a: Date, b: Date) => a.getTime() - b.getTime());
      return {
        id: o.id,
        orderCode: o.orderCode || null,
        type: o.type,
        gameName: o.gameName,
        amount: round1(o.amount),
        hours: round1(hours),
        customerId: o.customerId,
        customerCode: (o.customer && o.customer.customerCode) || '',
        customerWechat: (o.customer && o.customer.wechatId) || '',
        companionName: o.companion ? companionLabel(o.companion) : null,
        coCompanionName: o.coCompanion ? companionLabel(o.coCompanion) : null,
        csName: o.csUser ? o.csUser.displayName || o.csUser.username || null : null,
        iAmPartner: !!companionId && o.coCompanionId === companionId && o.companionId !== companionId,
        createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : '',
        startedAt: starts.length ? new Date(starts[0]).toISOString() : null,
        endedAt: ends.length ? new Date(ends[ends.length - 1]).toISOString() : null,
      };
    });

    const custIds = [...new Set(orderRows.map((r) => r.customerId).filter(Boolean))] as string[];
    const customers: DailyKpiDetailCustomer[] = [];
    if (custIds.length) {
      const histWhere: any = { status: 'DONE', customerId: { in: custIds } };
      if (studioId) histWhere.studioId = studioId;
      if (companionId) histWhere.OR = [{ companionId }, { coCompanionId: companionId }];

      const hist = (await this.prisma.order.groupBy({
        by: ['customerId'],
        where: histWhere,
        _count: { id: true },
        _sum: { amount: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      } as any)) as any[];
      const histById = new Map(hist.map((h) => [h.customerId, h]));

      // 累计时长：会话只挂在父单上，先取父单 → 客户，再按客户汇总。
      const histOrders = (await this.prisma.order.findMany({
        where: histWhere,
        select: { id: true, customerId: true },
      })) as any[];
      const custOfOrder = new Map(histOrders.map((o) => [o.id, o.customerId]));
      const sessSums = histOrders.length
        ? ((await this.prisma.orderSession.groupBy({
            by: ['parentOrderId'],
            where: { status: 'DONE', parentOrderId: { in: histOrders.map((o) => o.id) } },
            _sum: { duration: true },
          } as any)) as any[])
        : [];
      const hoursByCust = new Map<string, number>();
      for (const s of sessSums) {
        const cid = custOfOrder.get(s.parentOrderId);
        if (!cid) continue;
        hoursByCust.set(cid, (hoursByCust.get(cid) || 0) + (Number(s._sum?.duration) || 0));
      }

      const dayByCust = new Map<
        string,
        { orders: number; hours: number; amount: number; kinds: Set<string>; code: string; wechat: string }
      >();
      for (const r of orderRows) {
        let e = dayByCust.get(r.customerId);
        if (!e) {
          e = { orders: 0, hours: 0, amount: 0, kinds: new Set<string>(), code: r.customerCode, wechat: r.customerWechat };
          dayByCust.set(r.customerId, e);
        }
        e.orders += 1;
        e.hours += r.hours;
        e.amount += r.amount;
        e.kinds.add(r.type);
      }

      for (const cid of custIds) {
        const day = dayByCust.get(cid)!;
        const h: any = histById.get(cid);
        customers.push({
          customerId: cid,
          customerCode: day.code,
          customerWechat: day.wechat,
          orders: day.orders,
          hours: round1(day.hours),
          amount: round1(day.amount),
          totalOrders: (h && h._count && h._count.id) || 0,
          totalHours: round1(hoursByCust.get(cid) || 0),
          totalAmount: round1(h && h._sum ? h._sum.amount : 0),
          firstAt: h && h._min && h._min.createdAt ? new Date(h._min.createdAt).toISOString() : null,
          lastAt: h && h._max && h._max.createdAt ? new Date(h._max.createdAt).toISOString() : null,
          kinds: [...day.kinds],
        });
      }
      customers.sort((a, b) => b.amount - a.amount);
    }

    return { date, scope, orders: orderRows, customers };
  }
}