import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { businessDayRange } from '../common/business-day';
import { yuanToCents, centsToYuan } from '../common/money';
import { resolveCompanionPctTiered, effectiveTenureMonths } from '../common/revenue-calculator';
import { orderGrossYuan, orderUnits } from '../common/order-outcome';
import { resolveConfigsRaw, saveConfigsByRole } from '../common/studio-config';

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly DEFAULT_EXPENSE_ITEMS = [
    { id: 'rent', name: '房租', amount: 0 },
    { id: 'water', name: '水电', amount: 0 },
    { id: 'internet', name: '网络费', amount: 0 },
    { id: 'phone', name: '电话费', amount: 0 },
    { id: 'other', name: '其他', amount: 0 },
  ];

  /** 读取每月固定支出项（房租/水电/网络/电话/其他，可自行添加）。按店解析。 */
  async getExpenseItems(studioId?: string | null) {
    const scoped = await resolveConfigsRaw(this.prisma, studioId ?? null, [
      'expense.monthly_items',
    ]);
    const raw =
      (scoped['expense.monthly_items'] as Array<{ id?: string; name?: string; amount?: number }>) ||
      this.DEFAULT_EXPENSE_ITEMS;
    return raw.map((it, i) => ({
      id: it.id || `custom-${i}`,
      name: it.name || '其他',
      amount: Number(it.amount || 0),
    }));
  }

  /** 保存每月固定支出项（老板写全站默认，店长写本店）。 */
  async saveExpenseItems(
    items: Array<{ id?: string; name?: string; amount?: number }>,
    actor?: { role?: string | null; studioId?: string | null },
  ) {
    const normalized = (items || []).map((it, i) => ({
      id: it.id || `custom-${i}`,
      name: (it.name || '').trim() || '其他',
      amount: Number(it.amount || 0),
    }));
    await saveConfigsByRole(this.prisma, actor ?? {}, { 'expense.monthly_items': normalized });
    return normalized;
  }

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

  /** 按收款微信/账号汇总 DONE 订单，未标记已付的标红。 */
  async getAccountReconciliation(studioId: string, day: string) {
    const { start, end } = businessDayRange(day);
    const orders = await this.prisma.order.findMany({
      where: { studioId, status: 'DONE', createdAt: { gte: start, lt: end } },
      select: { amount: true, companionFeeAccount: true, companionFeeStatus: true },
    });
    const map = new Map<string, { account: string; count: number; amountCents: number; unpaid: number }>();
    for (const o of orders) {
      const account = o.companionFeeAccount || '未填写';
      const item = map.get(account) ?? { account, count: 0, amountCents: 0, unpaid: 0 };
      item.count += 1;
      item.amountCents += yuanToCents(o.amount);
      if (o.companionFeeStatus !== 'PAID') item.unpaid += 1;
      map.set(account, item);
    }
    const rows = Array.from(map.values()).map((r) => ({
      account: r.account,
      count: r.count,
      amountYuan: centsToYuan(r.amountCents),
      unpaid: r.unpaid,
      flagged: r.unpaid > 0,
    }));
    return { day, rows };
  }

  /** 线上+桥接按日历汇总：每天机密/绝密单数（含单双陪）、应返还、客户转入、利润。 */
  async getBridgeOnlineDaily(studioId: string, month: string) {
    studioId = await this.resolveStudioId(studioId);
    const [year, mon] = month.split('-').map((n) => Number(n));
    const start = new Date(Date.UTC(year, mon - 1, 1));
    const end = new Date(Date.UTC(year, mon, 1));

    const [orders, juejuCfg] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          studioId,
          status: { in: ['CONFIRMED', 'DONE'] },
          createdAt: { gte: start, lt: end },
        },
        include: {
          companion: { select: { id: true, createdAt: true, isSeniorStaff: true, studio: { select: { id: true, type: true } } } },
        },
      }),
      this.getBridgeReturnCents(studioId),
    ]);
    const juejuCents = juejuCfg;

    const dailyMap = new Map<string, any>();
    for (const o of orders) {
      const cf = (o.customFields as any) || {};
      const mission = cf.deltaMission;
      if (mission !== '机密' && mission !== '绝密') continue;

      const compStudio = o.companion?.studio;
      if (!compStudio) continue;
      const isBridgeOrOnline = compStudio.type === 'RENTAL' || compStudio.id !== studioId;
      if (!isBridgeOrOnline) continue;

      const day = (o.grabbedAt || o.createdAt).toISOString().slice(0, 10);
      const isDouble = o.coCompanionId || cf.deltaCount === '双';
      const companions = isDouble ? 2 : 1;
      const returnAmount =
        mission === '绝密' ? (juejuCents / 100) * (Number(o.duration) || 1) * companions : 0;
      const inAmount = Number(o.amount || 0) * (Number(o.duration) || 1);

      const d = dailyMap.get(day) || {
        secretCount: 0,
        secretSingle: 0,
        secretDouble: 0,
        juejuCount: 0,
        juejuSingle: 0,
        juejuDouble: 0,
        returnAmount: 0,
        inAmount: 0,
      };
      if (mission === '机密') {
        d.secretCount += 1;
        if (isDouble) d.secretDouble += 1;
        else d.secretSingle += 1;
      } else {
        d.juejuCount += 1;
        if (isDouble) d.juejuDouble += 1;
        else d.juejuSingle += 1;
      }
      d.returnAmount += returnAmount;
      d.inAmount += inAmount;
      dailyMap.set(day, d);
    }

    const daily = Array.from(dailyMap.entries())
      .map(([date, v]) => ({
        date,
        ...v,
        returnAmount: Number(v.returnAmount.toFixed(1)),
        inAmount: Number(v.inAmount.toFixed(1)),
        profit: Number((v.inAmount - v.returnAmount).toFixed(1)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totals = daily.reduce(
      (acc, d) => ({
        secretCount: acc.secretCount + d.secretCount,
        juejuCount: acc.juejuCount + d.juejuCount,
        returnAmount: Number((acc.returnAmount + d.returnAmount).toFixed(1)),
        inAmount: Number((acc.inAmount + d.inAmount).toFixed(1)),
        profit: Number((acc.profit + d.profit).toFixed(1)),
      }),
      { secretCount: 0, juejuCount: 0, returnAmount: 0, inAmount: 0, profit: 0 },
    );

    return { month, daily, totals };
  }

  /** 桥接返还台账：记录每次实际返还，统计某月已返还总额。 */
  async listBridgeReturns(studioId: string, month: string) {
    studioId = await this.resolveStudioId(studioId);
    const [year, mon] = month.split('-').map((n) => Number(n));
    const start = new Date(year, mon - 1, 1);
    const end = new Date(year, mon, 1);
    const records = await this.prisma.expense.findMany({
      where: { studioId, category: 'BRIDGE_RETURN', date: { gte: start, lt: end } },
      orderBy: { date: 'desc' },
    });
    const total = records.reduce((s, r) => s + Number(r.amount || 0), 0);
    return {
      month,
      records: records.map((r) => ({
        id: r.id,
        amount: Number(r.amount || 0),
        date: r.date,
        note: r.description || '',
      })),
      total: Number(total.toFixed(1)),
    };
  }

  /** 记录一笔桥接返还（实际打给桥接/线上工作室的钱）。 */
  async createBridgeReturn(studioId: string, dto: { amount: number; date?: string; note?: string }) {
    studioId = await this.resolveStudioId(studioId);
    if (!studioId) throw new ForbiddenException('无工作室权限，无法记录返还');
    const amount = Number(dto.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) throw new NotFoundException('返还金额必须大于 0');
    return this.prisma.expense.create({
      data: {
        studioId,
        category: 'BRIDGE_RETURN',
        amount,
        description: dto.note || null,
        date: dto.date ? new Date(dto.date) : new Date(),
      },
    });
  }

  /** 删除一笔桥接返还记录。 */
  async deleteBridgeReturn(id: string, studioId: string) {
    studioId = await this.resolveStudioId(studioId);
    const record = await this.prisma.expense.findFirst({
      where: { id, studioId, category: 'BRIDGE_RETURN' },
    });
    if (!record) throw new NotFoundException('返还记录不存在');
    return this.prisma.expense.delete({ where: { id } });
  }

  /**
   * 绝密单的线上返款（分/小时）：取「设置 → 派单与提成 → 绝密线上返款」，按店解析。
   * 兼容老的隐藏键 `pool.bridge_return_jueju_cents`（历史上只在库里手填过）。
   */
  private async getBridgeReturnCents(studioId?: string | null): Promise<number> {
    const scoped = await resolveConfigsRaw(this.prisma, studioId ?? null, [
      'dispatch.bridge_return_jueju_cents',
      'pool.bridge_return_jueju_cents',
    ]);
    const v =
      scoped['dispatch.bridge_return_jueju_cents'] ?? scoped['pool.bridge_return_jueju_cents'];
    const n = Number(v);
    return Number.isFinite(n) ? n : 1500;
  }

  /** 老板（OWNER）没有 studioId 时，默认落到第一个工作室。 */
  private async resolveStudioId(studioId: string): Promise<string> {
    if (studioId) return studioId;
    const first = await this.prisma.studio.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    return first?.id || '';
  }

  /** 利润日历：按天汇总线下工作室利润、桥接工作室利润、客服提成、线上俱乐部利润。 */
  async getProfitDaily(studioId: string, month: string) {
    studioId = await this.resolveStudioId(studioId);
    const [year, mon] = month.split('-').map((n) => Number(n));
    const start = new Date(Date.UTC(year, mon - 1, 1));
    const end = new Date(Date.UTC(year, mon, 1));

    const [orders, scopedCfg, expenseItems] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          studioId,
          status: { in: ['CONFIRMED', 'DONE'] },
          createdAt: { gte: start, lt: end },
        },
        include: {
          companion: { include: { studio: { select: { id: true, type: true } } } },
        },
      }),
      resolveConfigsRaw(this.prisma, studioId, [
        'revenue.share_tiers',
        'revenue.club_companion_share',
        'bridge.secret_price_yuan',
        'bridge.jueju_net_yuan',
        'commission.cs_bridge_per_order_yuan',
        'commission.cs_online_per_order_yuan',
        'commission.cs_online_rate_percent',
        'commission.cs_online_mode',
        'commission.cs_offline_rate_percent',
        'commission.cs_base_salary_yuan',
      ]),
      this.getExpenseItems(studioId),
    ]);

    const tiers: Array<{ min: number; max: number | null; studio: number; companion: number }> =
      (scopedCfg['revenue.share_tiers'] as any) ?? [
        { min: 0, max: 5999.9, studio: 50, companion: 50 },
        { min: 6000, max: 9999, studio: 40, companion: 60 },
        { min: 10000, max: null, studio: 30, companion: 70 },
      ];
    const clubSharePct = Number(scopedCfg['revenue.club_companion_share'] ?? 80);
    const secretPrice = Number(scopedCfg['bridge.secret_price_yuan'] ?? 35);
    const juejuNet = Number(scopedCfg['bridge.jueju_net_yuan'] ?? 30);
    const bridgePerOrder = Number(scopedCfg['commission.cs_bridge_per_order_yuan'] ?? 1);
    // 线上俱乐部客服提成：按流水比例计提（老板 2026-09-29），或按单数 × 每单单价
    // —— 用哪一种由「设置 → 客服设置」里的 `commission.cs_online_mode` 决定（老板 2026-09-30）。
    const onlineRatePct = Number(scopedCfg['commission.cs_online_rate_percent'] ?? 1);
    const onlinePerOrder = Number(scopedCfg['commission.cs_online_per_order_yuan'] ?? 1);
    const onlineMode = String(scopedCfg['commission.cs_online_mode'] ?? 'RATE').toUpperCase() === 'PER_ORDER' ? 'PER_ORDER' : 'RATE';
    const offlineRatePct = Number(scopedCfg['commission.cs_offline_rate_percent'] ?? 1);
    const csBaseSalary = Number(scopedCfg['commission.cs_base_salary_yuan'] ?? 0);
    const monthlyTotalExpense = expenseItems.reduce((s, it) => s + it.amount, 0);
    const daysInMonth = new Date(year, mon, 0).getDate();
    const dailyExpense = daysInMonth > 0 ? monthlyTotalExpense / daysInMonth : 0;

    // 线下阶梯分成：先算每个本工作室陪玩当月流水，再按对应档位取工作室分成比例。
    const ownRevenue = new Map<string, number>();
    const companionTenure = new Map<string, number>();
    for (const o of orders) {
      const compStudio = o.companion?.studio;
      if (o.companionId && compStudio && compStudio.type !== 'RENTAL' && compStudio.id === studioId) {
        const gross = Number(o.amount || 0) * (Number(o.duration) || 1);
        ownRevenue.set(o.companionId, (ownRevenue.get(o.companionId) || 0) + gross);
        if (o.companion?.createdAt) {
          companionTenure.set(o.companionId, effectiveTenureMonths(o.companion.createdAt, o.companion.isSeniorStaff));
        }
      }
    }
    const tierMap = new Map<string, number>();
    for (const [cid, rev] of ownRevenue) {
      const companionPct = resolveCompanionPctTiered(rev, companionTenure.get(cid) ?? 0, tiers);
      tierMap.set(cid, 100 - companionPct);
    }

    const dailyMap = new Map<string, any>();
    for (const o of orders) {
      const day = (o.grabbedAt || o.createdAt).toISOString().slice(0, 10);
      const gross = Number(o.amount || 0) * (Number(o.duration) || 1);
      const compStudio = o.companion?.studio;
      const cf = (o.customFields as any) || {};
      const isDouble = o.coCompanionId || cf.deltaCount === '双';
      const companions = isDouble ? 2 : 1;

      let offline = 0;
      let offlinePay = 0;
      let online = 0;
      let onlinePay = 0;
      let bridgeProfit = 0;
      if (compStudio) {
        if (compStudio.type === 'RENTAL') {
          online = gross * ((100 - clubSharePct) / 100);
          onlinePay = gross * (clubSharePct / 100);
        } else if (compStudio.id === studioId && o.companionId) {
          const studioSharePct = tierMap.get(o.companionId) ?? tiers[0]?.studio ?? 50;
          offline = gross * (studioSharePct / 100);
          offlinePay = gross * ((100 - studioSharePct) / 100);
        } else if (compStudio.id !== studioId) {
          // 桥接线下工作室：机密 35/人/时，绝密 30/人/时（45-15 返还）。
          const dur = Number(o.duration) || 1;
          bridgeProfit = (cf.deltaMission === '绝密' ? juejuNet : secretPrice) * dur * companions;
        }
      }

      // 客服提成：桥接按单量（每单单价 × 单量）+ 线上按流水比例（或按单数 × 每单单价）+ 线下按订单流水比例。
      let csCommission = 0;
      if (o.attributedCsUserId || o.claimedCsUserId || o.csUserId) {
        if (compStudio?.type === 'RENTAL') {
          csCommission +=
            onlineMode === 'PER_ORDER' ? onlinePerOrder * companions : (gross * onlineRatePct) / 100;
        } else if (compStudio && compStudio.id !== studioId) {
          csCommission += bridgePerOrder * companions;
        } else {
          csCommission += (gross * offlineRatePct) / 100;
        }
      }

      const d = dailyMap.get(day) || { offline: 0, offlinePay: 0, online: 0, onlinePay: 0, bridgeProfit: 0, csCommission: 0 };
      d.offline += offline;
      d.offlinePay += offlinePay;
      d.online += online;
      d.onlinePay += onlinePay;
      d.bridgeProfit += bridgeProfit;
      d.csCommission += csCommission;
      dailyMap.set(day, d);
    }

    const daily = Array.from(dailyMap.entries())
      .map(([date, v]) => ({
        date,
        offline: Number(v.offline.toFixed(1)),
        offlinePay: Number(v.offlinePay.toFixed(1)),
        online: Number(v.online.toFixed(1)),
        onlinePay: Number(v.onlinePay.toFixed(1)),
        bridgeProfit: Number(v.bridgeProfit.toFixed(1)),
        csCommission: Number(v.csCommission.toFixed(1)),
        expense: Number(dailyExpense.toFixed(1)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totals: any = daily.reduce(
      (acc, d) => ({
        offline: Number((acc.offline + d.offline).toFixed(1)),
        offlinePay: Number((acc.offlinePay + d.offlinePay).toFixed(1)),
        online: Number((acc.online + d.online).toFixed(1)),
        onlinePay: Number((acc.onlinePay + d.onlinePay).toFixed(1)),
        bridgeProfit: Number((acc.bridgeProfit + d.bridgeProfit).toFixed(1)),
        csCommission: Number((acc.csCommission + d.csCommission).toFixed(1)),
      }),
      { offline: 0, offlinePay: 0, online: 0, onlinePay: 0, bridgeProfit: 0, csCommission: 0 },
    );

    totals.csBaseSalary = Number(csBaseSalary.toFixed(1));
    totals.totalExpense = Number(monthlyTotalExpense.toFixed(1));

    return { month, daily, totals };
  }

  /**
   * 店长端「这个陪玩值不值」对比（老板 2026-10-04）：
   * 「这个陪玩干了这一个月，给他的订单我（本店）抽到的，跟把这些单派到桥接 / 线上俱乐部
   * 做首单不结能挣的，哪个多？」
   *
   * 口径（跟本页其他卡片对齐）：
   *  - 只算**本店线下陪玩**接的、本店发的、未取消（CONFIRMED/DONE）的单；
   *  - 流水 =（主陪单价 + 搭档单价）× 时长（双陪把搭档那份算上，跟「应收」口径一致）；
   *  - **本店实得** = 流水 ×（100 − 该陪玩当月档位）/ 100，档位同「线下利润」（阶梯 + 6 个月工龄门槛）；
   *  - **派桥接** = 机密 35 / 绝密净 30 元/人/时 × 时长 × 人时（首单不结，跟桥接利润同一口径）；
   *  - **派线上** = 流水 ×（100 − revenue.club_companion_share）/ 100。
   * 返回按「本店实得 − 对外更优的那个」升序，最不划算的排最上面。
   */
  async getCompanionValueCompare(studioId: string, month: string) {
    studioId = await this.resolveStudioId(studioId);
    const [year, mon] = month.split('-').map((n) => Number(n));
    const start = new Date(Date.UTC(year, mon - 1, 1));
    const end = new Date(Date.UTC(year, mon, 1));

    const [orders, scopedCfg] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          studioId,
          status: { in: ['CONFIRMED', 'DONE'] },
          createdAt: { gte: start, lt: end },
          companionId: { not: null },
        },
        include: {
          companion: {
            select: {
              id: true,
              createdAt: true,
              isSeniorStaff: true,
              studio: { select: { id: true, type: true } },
              user: { select: { username: true, displayName: true } },
            },
          },
        },
      }),
      resolveConfigsRaw(this.prisma, studioId, [
        'revenue.share_tiers',
        'revenue.club_companion_share',
        'bridge.secret_price_yuan',
        'bridge.jueju_net_yuan',
      ]),
    ]);

    const tiers: Array<{ min: number; max: number | null; studio: number; companion: number }> =
      (scopedCfg['revenue.share_tiers'] as any) ?? [
        { min: 0, max: 5999.9, studio: 50, companion: 50 },
        { min: 6000, max: 9999, studio: 40, companion: 60 },
        { min: 10000, max: null, studio: 30, companion: 70 },
      ];
    const clubSharePct = Number(scopedCfg['revenue.club_companion_share'] ?? 80);
    const secretPrice = Number(scopedCfg['bridge.secret_price_yuan'] ?? 35);
    const juejuNet = Number(scopedCfg['bridge.jueju_net_yuan'] ?? 30);

    const map = new Map<
      string,
      {
        companionId: string;
        name: string;
        username: string;
        gross: number;
        units: number;
        durationHours: number;
        orderCount: number;
        newCount: number;
        renewCount: number;
        bridgeNet: number;
        onlineNet: number;
      }
    >();
    const tenure = new Map<string, number>();

    for (const o of orders) {
      const comp = (o as any).companion as
        | {
            id: string;
            createdAt?: Date;
            isSeniorStaff?: boolean;
            studio?: { id: string; type: string } | null;
            user?: { username?: string; displayName?: string } | null;
          }
        | undefined;
      if (!comp?.studio || comp.studio.type === 'RENTAL' || comp.studio.id !== studioId) continue;
      const cid = o.companionId as string;
      const cf = (o.customFields as any) || {};
      const units = orderUnits(o as any);
      const dur = Number(o.duration) || 1;
      const gross = orderGrossYuan(o as any);
      const isJueju = cf.deltaMission === '绝密';
      const agg =
        map.get(cid) ||
        {
          companionId: cid,
          name: comp.user?.displayName || comp.user?.username || cid,
          username: comp.user?.username || '',
          gross: 0,
          units: 0,
          durationHours: 0,
          orderCount: 0,
          newCount: 0,
          renewCount: 0,
          bridgeNet: 0,
          onlineNet: 0,
        };
      agg.gross += gross;
      agg.units += units;
      agg.durationHours += dur;
      agg.orderCount += 1;
      if (o.type === 'NEW') agg.newCount += 1;
      else if (o.type === 'RENEW' || o.type === 'REPURCHASE') agg.renewCount += 1;
      agg.bridgeNet += (isJueju ? juejuNet : secretPrice) * dur * units;
      agg.onlineNet += gross * ((100 - clubSharePct) / 100);
      map.set(cid, agg);
      if (comp.createdAt) {
        tenure.set(cid, effectiveTenureMonths(comp.createdAt, comp.isSeniorStaff));
      }
    }

    const rows = Array.from(map.values()).map((a) => {
      const companionPct = resolveCompanionPctTiered(a.gross, tenure.get(a.companionId) ?? 0, tiers);
      const studioPct = 100 - companionPct;
      const ownNet = a.gross * (studioPct / 100);
      const bestOut = Math.max(a.bridgeNet, a.onlineNet);
      const diff = ownNet - bestOut;
      return {
        companionId: a.companionId,
        name: a.name,
        username: a.username,
        orderCount: a.orderCount,
        newCount: a.newCount,
        renewCount: a.renewCount,
        units: a.units,
        durationHours: Number(a.durationHours.toFixed(1)),
        gross: Number(a.gross.toFixed(2)),
        companionPct,
        studioPct,
        ownNet: Number(ownNet.toFixed(2)),
        bridgeNet: Number(a.bridgeNet.toFixed(2)),
        onlineNet: Number(a.onlineNet.toFixed(2)),
        bestOut: Number(bestOut.toFixed(2)),
        diff: Number(diff.toFixed(2)),
        better: bestOut > ownNet ? (a.bridgeNet >= a.onlineNet ? 'BRIDGE' : 'ONLINE') : 'OWN',
      };
    });
    rows.sort((x, y) => x.diff - y.diff);

    const add = (k: 'gross' | 'ownNet' | 'bridgeNet' | 'onlineNet' | 'bestOut' | 'diff') =>
      Number(rows.reduce((s, r) => s + Number(r[k] || 0), 0).toFixed(2));
    const totals = {
      companionCount: rows.length,
      orderCount: rows.reduce((s, r) => s + r.orderCount, 0),
      units: rows.reduce((s, r) => s + r.units, 0),
      hours: Number(rows.reduce((s, r) => s + r.durationHours, 0).toFixed(1)),
      gross: add('gross'),
      ownNet: add('ownNet'),
      bridgeNet: add('bridgeNet'),
      onlineNet: add('onlineNet'),
      bestOut: add('bestOut'),
      diff: add('diff'),
    };
    return { month, rows, totals };
  }
}
