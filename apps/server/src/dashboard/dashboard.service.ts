import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  currentBusinessDayRange,
  businessDayRange,
  businessDayOf,
  currentSettlementMonthRange,
} from '../common/business-day';
import { roundToJiao } from '../common/money';
import { computeEntertainmentFee, entertainmentBasisRevenue, loadEntertainmentRule, sumDepositPlayedToday } from '../common/entertainment-fee';
import { resolveConfigsRaw } from '../common/studio-config';
import { companionOrderRevenue } from '../common/order-revenue';

/** 计「在线时长」时认可的模式，与 onlineCount 保持一致 */
const ONLINE_MODES = new Set(['AVAILABLE', 'BUSY', 'ENTERTAINMENT']);

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(studioId: string | null) {
    const studioWhere: any = studioId ? { studioId } : {};

    const { start: today, end: tomorrow } = currentBusinessDayRange();

    // 今日订单（营业日 12:00 界）。老板 2026-10-07：「今日单量」要的是**发单量**
    // —— 跟客服看板「全店发单」同一个口径（今天建了多少单，不限状态）。
    // 以前这里只数 DONE 的单，于是同一页上「今日单量 7 单」和下面「今日客服发单 48 单」
    // 自相矛盾（7 是打完的、48 是发出去的）。两个数都留着：主值发单、副值已完成。
    const todayOrders = await this.prisma.order.findMany({
      where: {
        ...studioWhere,
        createdAt: { gte: today, lt: tomorrow },
      },
      select: { status: true, amount: true, companionId: true, coCompanionId: true, coAmount: true, customFields: true },
    });
    const doneOrders = todayOrders.filter((o) => o.status === 'DONE');

    const totalRevenue = doneOrders.reduce((s, o) => s + o.amount, 0);
    /** 今日已完成（DONE）单量 —— 跟「今日业绩」配对的还是这个数 */
    const orderCount = doneOrders.length;
    /** 今日发单量 —— 今天新开的单，含还没派出去 / 正在打 / 已取消的 */
    const publishedCount = todayOrders.length;

    // Online/Total companions
    const allCompanions = await this.prisma.companion.findMany({
      where: studioWhere,
      select: { id: true, status: true },
    });
    const onlineCompanions = allCompanions.filter(
      c => ['AVAILABLE', 'BUSY', 'ENTERTAINMENT'].includes(c.status),
    ).length;

    // 接单率 = 接单时长 ÷ 在线时长（老板 2026-09-20 定口径）。
    // 以前算的是「忙绿人数 ÷ 在线人数」的瞬时快照，那个数不能代表接单率。
    const now = new Date();
    const timeLogs = await this.prisma.companionTimeLog.findMany({
      where: {
        companion: studioWhere,
        startedAt: { lt: tomorrow },
        OR: [{ endedAt: null }, { endedAt: { gte: today } }],
      },
      select: {
        companionId: true,
        mode: true,
        startedAt: true,
        endedAt: true,
        durationSeconds: true,
      },
    });
    let workSeconds = 0;
    let onlineSeconds = 0;
    const entertainmentSecondsByCompanion = new Map<string, number>();
    for (const log of timeLogs) {
      // 跨营业日的日志只算落在今天这段，没结束的按「到现在」算
      const from = Math.max(log.startedAt.getTime(), today.getTime());
      const to = Math.min((log.endedAt || now).getTime(), tomorrow.getTime());
      const seconds = Math.round((to - from) / 1000);
      if (seconds <= 0) continue;
      // 「在线」跟上面 onlineCount 同一口径：空闲 / 接单中 / 娱乐中算在线，
      // 休息、离线不算，否则同一份数据里两个「在线」还不是一回事。
      if (ONLINE_MODES.has(log.mode)) onlineSeconds += seconds;
      if (log.mode === 'BUSY') workSeconds += seconds;
      if (log.mode === 'ENTERTAINMENT') {
        entertainmentSecondsByCompanion.set(
          log.companionId,
          (entertainmentSecondsByCompanion.get(log.companionId) || 0) + seconds,
        );
      }
    }
    const acceptRate = onlineSeconds > 0 ? Math.round((workSeconds / onlineSeconds) * 100) : 0;

    // Ranking (monthly revenue)
    const ranking = await this.prisma.companion.findMany({
      where: { ...studioWhere, monthlyRevenue: { gt: 0 } },
      orderBy: { monthlyRevenue: 'desc' },
      take: 10,
      select: {
        id: true,
        monthlyRevenue: true,
        user: { select: { username: true } },
      },
    });

    // Alerts: companions with low revenue
    // 低业绩预警线：本店店长填的优先
    const scopedCfg = await resolveConfigsRaw(this.prisma, studioId, ['revenue.low_warning']);
    const lowThreshold = (scopedCfg['revenue.low_warning'] as number) ?? 300;

    // H3 fix: use Order table for alerts (same source as KPI)
    // 直接用上面那份「今日已完成单」，不再重复查一遍。
    // 口径（老板 2026-10-07「口径 A：谁的钱算谁的」）：主陪算 amount、搭档算 coAmount，
    // 谁打的那份算谁头上。娱乐费门槛用的就是这份「今日业绩」，两边必须是一回事。
    const revMap = new Map<string, number>();
    for (const o of doneOrders) {
      for (const cid of new Set([o.companionId, o.coCompanionId].filter(Boolean) as string[])) {
        revMap.set(cid, (revMap.get(cid) || 0) + companionOrderRevenue(o as any, cid));
      }
    }
    // 娱乐费：走全系统唯一口径（门槛 = 订单业绩 + 今天打掉的存单，达标免单，否则按配置时薪折算）
    // 老板 2026-10-04：「打存单也算在娱乐那个门槛里」——存单常加在老的续单上打，
    // 订单 createdAt 不是今天，按订单取数的当日业绩会漏，按会话补回来。
    const { hourlyRate, freeThreshold } = await loadEntertainmentRule(this.prisma, studioId);
    const depositPlayedMap = await sumDepositPlayedToday(
      this.prisma,
      Array.from(entertainmentSecondsByCompanion.keys()),
      { start: today, end: tomorrow },
    );
    let entertainmentFee = 0;
    for (const [companionId, seconds] of entertainmentSecondsByCompanion) {
      entertainmentFee += computeEntertainmentFee({
        minutes: seconds / 60,
        todayRevenue: entertainmentBasisRevenue(
          revMap.get(companionId) || 0,
          depositPlayedMap.get(companionId) || 0,
        ),
        hourlyRate,
        freeThreshold,
      });
    }
    entertainmentFee = roundToJiao(entertainmentFee);

    const alerts = allCompanions
      .filter(c => (revMap.get(c.id) || 0) < lowThreshold)
      .map(c => ({
        companionId: c.id,
        companionName: '',
        message: `今日业绩低于${lowThreshold}预警线`,
      }));

    // 今日段位变动（老板 2026-10-04）：每天 12:05 由 ExcellenceService 复核后留档，
    // 这里只把「本营业日内」的变动捞出来给首页看板显示（店长只看本店）。
    let tierChanges: Array<Record<string, unknown>> = [];
    try {
      const changesCfg = await this.prisma.systemConfig.findUnique({
        where: { key: 'excellence.tier_changes' },
      });
      const all = Array.isArray(changesCfg?.value) ? (changesCfg!.value as any[]) : [];
      tierChanges = all
        .filter((c) => {
          if (!c?.at) return false;
          if (new Date(c.at).getTime() < today.getTime()) return false;
          if (studioId && c.studioId && c.studioId !== studioId) return false;
          return true;
        })
        .slice(0, 30);
    } catch {
      // 读不到就当没有，不影响首页其它数据
    }

    return {
      today: {
        totalRevenue,
        orderCount,
        publishedCount,
        onlineCount: onlineCompanions,
        totalCount: allCompanions.length,
        acceptRate,
        entertainmentFee,
      },
      tierChanges,
      ranking: ranking.map((r, i) => ({
        rank: i + 1,
        companionId: r.id,
        companionName: r.user?.username ?? '',
        monthlyRevenue: r.monthlyRevenue,
      })),
      alerts,
    };
  }

  async getTrend(studioId: string | null, days: number = 7) {
    const studioWhere: any = studioId ? { studioId } : {};
    const result: { date: string; revenue: number; orderCount: number }[] = [];
    const todayBiz = businessDayOf(new Date());
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(todayBiz);
      d.setDate(d.getDate() - i);
      const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const { start, end } = businessDayRange(dayKey);

      const orders = await this.prisma.order.findMany({
        where: {
          ...studioWhere,
          status: 'DONE',
          createdAt: { gte: start, lt: end },
        },
      });
      result.push({
        date: dayKey,
        revenue: orders.reduce((s, o) => s + o.amount, 0),
        orderCount: orders.length,
      });
    }
    return result;
  }

  async getCompanionStatus(studioId: string | null) {
    const studioWhere: any = studioId ? { studioId } : {};
    return this.prisma.companion.findMany({
      where: studioWhere,
      select: {
        id: true,
        status: true,
        monthlyRevenue: true,
        user: { select: { username: true } },
        pc: { select: { currentMode: true, lastHeartbeat: true } },
      },
    });
  }

  async getRevenueOverview(studioId: string | null) {
    const studioWhere: any = studioId ? { studioId } : {};
    const yesterdayBiz = businessDayOf(new Date());
    yesterdayBiz.setDate(yesterdayBiz.getDate() - 1);
    const yesterdayKey = `${yesterdayBiz.getFullYear()}-${String(yesterdayBiz.getMonth() + 1).padStart(2, '0')}-${String(yesterdayBiz.getDate()).padStart(2, '0')}`;
    const { start: yesterday, end: yesterdayEnd } = businessDayRange(yesterdayKey);
    const yesterdayOrders = await this.prisma.order.findMany({
      where: { ...studioWhere, status: 'DONE', createdAt: { gte: yesterday, lt: yesterdayEnd } },
    });
    const yesterdayRevenue = yesterdayOrders.reduce((s, o) => s + o.amount, 0);

    const { start: monthStart } = currentSettlementMonthRange();
    const monthOrders = await this.prisma.order.findMany({
      where: { ...studioWhere, status: 'DONE', createdAt: { gte: monthStart } },
    });
    const monthlyRevenue = monthOrders.reduce((s, o) => s + o.amount, 0);

    const typeBreakdown: Record<string, number> = { NEW: 0, RENEW: 0, REPURCHASE: 0, TIP: 0 };
    for (const o of monthOrders) typeBreakdown[o.type] = (typeBreakdown[o.type] || 0) + o.amount;

    const companions = await this.prisma.companion.findMany({
      where: studioWhere, include: { user: { select: { username: true } } },
    });
    const companionRevenue: any[] = [];
    for (const c of companions) {
      // 本月业绩（老板 2026-10-07「口径 A：谁的钱算谁的」）：主陪 amount + 他当搭档的 coAmount。
      const rev = monthOrders
        .filter((o) => o.companionId === c.id || o.coCompanionId === c.id)
        .reduce((s, o) => s + companionOrderRevenue(o as any, c.id), 0);
      if (rev > 0) companionRevenue.push({ companionId: c.id, name: c.user?.username || '?', revenue: roundToJiao(rev) });
    }
    companionRevenue.sort((a, b) => b.revenue - a.revenue);
    return { yesterdayRevenue, monthlyRevenue, typeBreakdown, companionRevenue };
  }

  async getCompanionRevenueDetail(companionId: string) {
    const { start: monthStart } = currentSettlementMonthRange();
    // 口径（老板 2026-10-07「口径 A：谁的钱算谁的」）：主陪算 amount、搭档算 coAmount。
    const orders = await this.prisma.order.findMany({
      where: {
        status: 'DONE',
        createdAt: { gte: monthStart },
        OR: [{ companionId }, { coCompanionId: companionId }],
      },
    });
    const breakdown: Record<string, number> = { NEW: 0, RENEW: 0, REPURCHASE: 0, TIP: 0 };
    for (const o of orders) breakdown[o.type] = (breakdown[o.type] || 0) + companionOrderRevenue(o as any, companionId);
    return { companionId, totalRevenue: orders.reduce((s, o) => s + companionOrderRevenue(o as any, companionId), 0), orderCount: orders.length, breakdown };
  }
}
