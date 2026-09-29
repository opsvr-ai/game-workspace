import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { settlementMonthRange, currentBusinessDayRange, businessDayOf } from '../common/business-day';
import { yuanToCents, centsToYuan } from '../common/money';
import { resolveConfigsRaw, saveConfigsByRole } from '../common/studio-config';
import { successOrderWhere, outcomeOf, orderUnits, orderGrossYuan } from '../common/order-outcome';

@Injectable()
export class CommissionService {
  constructor(private readonly prisma: PrismaService) {}

  async listRules(studioId: string) {
    studioId = await this.resolveStudioId(studioId);
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
    studioId = await this.resolveStudioId(studioId);
    const { start, end } = settlementMonthRange(month);
    const anchorRule = await this.ensureCsAnchorRule(studioId);
    const built = await this.buildCsSalaryRows(studioId, start, end);
    const created: Array<Record<string, unknown>> = [];

    for (const row of built.rows) {
      const totalCents = yuanToCents(row.commissionYuan);
      if (totalCents <= 0) continue;
      const ruleSnapshot = {
        role: 'CS',
        basis: 'CLAIMED_AMOUNT',
        offlineCents: yuanToCents(row.offlineCommissionYuan),
        bridgeCents: yuanToCents(row.bridgeCommissionYuan),
        onlineCents: yuanToCents(row.onlineCommissionYuan),
        bridgeUnits: row.bridgeUnits,
        bridgePerUnitYuan: row.bridgePerUnitYuan,
        bridgeMet: row.bridgeMet,
      };
      const ledger = await this.prisma.commissionLedger.upsert({
        where: { studioId_ruleId_userId_month: { studioId, ruleId: anchorRule.id, userId: row.userId, month } },
        create: {
          studioId,
          ruleId: anchorRule.id,
          userId: row.userId,
          month,
          basisValue: row.offlineCommissionYuan,
          amount: totalCents,
          ruleSnapshot,
          status: 'DRAFT',
        },
        update: { basisValue: row.offlineCommissionYuan, amount: totalCents, ruleSnapshot },
      });

      created.push({
        userId: row.userId,
        username: row.username,
        role: 'CS',
        basis: 'CLAIMED_AMOUNT',
        basisValue: row.offlineCommissionYuan,
        amountYuan: centsToYuan(totalCents),
        ledgerId: ledger.id,
        bridgeUnits: row.bridgeUnits,
        bridgePerUnitYuan: row.bridgePerUnitYuan,
        bridgeMet: row.bridgeMet,
      });
    }

    // 店长分成（老板 2026-09-21：一单流水由 工作室 / 店长 / 客服 / 陪玩 四个人分）。
    // 比例默认 0，没填就一条记录都不产生 —— 老口径完全不变。
    const adminBuilt = await this.buildAdminRows(studioId, start, end);
    if (adminBuilt.rows.length) {
      const adminRule = await this.ensureAdminAnchorRule(studioId);
      for (const row of adminBuilt.rows) {
        const totalCents = yuanToCents(row.commissionYuan);
        if (totalCents <= 0) continue;
        const ruleSnapshot = {
          role: 'ADMIN',
          basis: 'REVENUE',
          offlineRatePercent: adminBuilt.rates.offline,
          onlineRatePercent: adminBuilt.rates.online,
          offlineRevenueYuan: row.offlineYuan,
          onlineRevenueYuan: row.onlineYuan,
          offlineCents: yuanToCents(row.offlineCommissionYuan),
          onlineCents: yuanToCents(row.onlineCommissionYuan),
          adminHeadcount: adminBuilt.rows.length,
        };
        const basisYuan = row.offlineYuan + row.onlineYuan;
        const ledger = await this.prisma.commissionLedger.upsert({
          where: { studioId_ruleId_userId_month: { studioId, ruleId: adminRule.id, userId: row.userId, month } },
          create: {
            studioId,
            ruleId: adminRule.id,
            userId: row.userId,
            month,
            basisValue: basisYuan,
            amount: totalCents,
            ruleSnapshot,
            status: 'DRAFT',
          },
          update: { basisValue: basisYuan, amount: totalCents, ruleSnapshot },
        });
        created.push({
          userId: row.userId,
          username: row.username,
          role: 'ADMIN',
          basis: 'REVENUE',
          basisValue: basisYuan,
          amountYuan: centsToYuan(totalCents),
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
    studioId = await this.resolveStudioId(studioId);
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

  /** 读取客服桥接达标规则（每日桥接目标 + 未达标惩罚比例）。 */
  private async resolveStudioId(studioId: string): Promise<string> {
    if (studioId) return studioId;
    const first = await this.prisma.studio.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    return first?.id || '';
  }

  /** 读取客服提成配置（本店店长填的优先，没填才用老板全局默认） */
  private async csConfig(studioId?: string) {
    const keys = [
      'commission.cs_offline_rate_percent',
      'commission.cs_offline_floor_cents',
      'commission.cs_bridge_per_order_yuan',
      'commission.cs_online_per_order_yuan',
      'commission.cs_online_rate_percent',
      'commission.cs_offline_per_order_cap_cents',
    ];
    const resolved = await resolveConfigsRaw(this.prisma, studioId, keys);
    const map: Record<string, number> = {};
    for (const k of keys) if (resolved[k] !== undefined) map[k] = Number(resolved[k]);
    return {
      ratePercent: map['commission.cs_offline_rate_percent'] ?? 1,
      floorCents: map['commission.cs_offline_floor_cents'] ?? 200,
      bridgePerOrderCents: Math.round((map['commission.cs_bridge_per_order_yuan'] ?? 1) * 100),
      onlinePerOrderCents: Math.round((map['commission.cs_online_per_order_yuan'] ?? 1) * 100),
      // 线上俱乐部订单：客服**按流水比例**计提（老板 2026-09-29）。桥接仍是按单量。
      onlineRatePercent: Number.isFinite(map['commission.cs_online_rate_percent'])
        ? map['commission.cs_online_rate_percent']
        : 1,
      perOrderCapCents: map['commission.cs_offline_per_order_cap_cents'] ?? 0,
    };
  }

  /**
   * 读取客服工资 + 桥接阶梯提成配置。
   * 底薪、月休、迟到/缺勤扣款从 PayrollConfig(role=CS) 取；
   * 桥接阶梯、全勤奖、早退扣款等新规则存 SystemConfig，默认值按老板口径。
   */
  private async csSalaryConfig(studioId?: string) {
    const cfg = await this.csConfig(studioId);
    const payroll = await this.prisma.payrollConfig.findUnique({ where: { role: 'CS' } });
    const keys = [
      'commission.cs_bridge_min_threshold',
      'commission.cs_bridge_tier3_threshold',
      'commission.cs_bridge_tier5_threshold',
      'commission.cs_bridge_tier3_yuan',
      'commission.cs_bridge_tier5_yuan',
      'commission.cs_full_attendance_bonus_yuan',
      'commission.cs_early_leave_deduction_yuan',
      'commission.cs_base_salary_yuan',
    ];
    const resolved = await resolveConfigsRaw(this.prisma, studioId, keys);
    const map: Record<string, number> = {};
    for (const k of keys) if (resolved[k] !== undefined) map[k] = Number(resolved[k]);
    return {
      ...cfg,
      baseSalary: Number(payroll?.baseSalary ?? map['commission.cs_base_salary_yuan'] ?? 2100),
      restDays: Number(payroll?.fullAttendanceDays ?? 4),
      lateDeduction: Number(payroll?.lateDeduction ?? 0),
      absentDeduction: Number(payroll?.absentDeduction ?? 0),
      fullAttendanceBonus: map['commission.cs_full_attendance_bonus_yuan'] ?? 0,
      earlyLeaveDeduction: map['commission.cs_early_leave_deduction_yuan'] ?? 0,
      bridgeMin: map['commission.cs_bridge_min_threshold'] ?? 130,
      bridgeTier3: map['commission.cs_bridge_tier3_threshold'] ?? 182,
      bridgeTier5: map['commission.cs_bridge_tier5_threshold'] ?? 260,
      bridgeTier3Yuan: map['commission.cs_bridge_tier3_yuan'] ?? 3,
      bridgeTier5Yuan: map['commission.cs_bridge_tier5_yuan'] ?? 5,
    };
  }

  /** 店长分成比例（% 流水）：线下 / 线上分开配，默认 0 = 暂不参与分成。 */
  private async adminRateConfig(studioId?: string) {
    const keys = ['commission.admin_offline_rate_percent', 'commission.admin_online_rate_percent'];
    const resolved = await resolveConfigsRaw(this.prisma, studioId, keys);
    const map: Record<string, number> = {};
    for (const k of keys) if (resolved[k] !== undefined) map[k] = Number(resolved[k]);
    const pick = (k: string) => (Number.isFinite(map[k]) ? map[k] : 0);
    return { offline: pick('commission.admin_offline_rate_percent'), online: pick('commission.admin_online_rate_percent') };
  }

  /**
   * 店长分成明细：店里当月成功单流水 × 店长比例。
   * 一店多位店长时**按人数均分**，所以「店长比例」= 店里店长这一项的总支出，
   * 不会因为多挂了几个店长账号就重复发钱。
   */
  private async buildAdminRows(studioId: string, start: Date, end: Date) {
    const rates = await this.adminRateConfig(studioId);
    if (rates.offline <= 0 && rates.online <= 0) return { rows: [], rates };

    const admins = await this.prisma.user.findMany({
      where: { studioId, role: { in: ['ADMIN', 'STORE_MANAGER'] } },
      select: { id: true, username: true, displayName: true },
      orderBy: { username: 'asc' },
    });
    if (!admins.length) return { rows: [], rates };

    const orders = await this.prisma.order.findMany({
      where: {
        studioId,
        status: 'DONE',
        type: 'NEW',
        companionId: { not: null },
        createdAt: { gte: start, lt: end },
      },
      select: { amount: true, companion: { select: { studio: { select: { id: true, type: true } } } } },
    });

    // 口径和「客服提成 / 到账对账」保持一致：只算**本店自己的单**（线下）和线上俱乐部的单，
    // 桥接出去的别人的单不算本店店长的分成。
    let offlineYuan = 0;
    let onlineYuan = 0;
    for (const o of orders) {
      const amount = Number(o.amount || 0);
      const compStudio = o.companion?.studio;
      if (compStudio?.type === 'RENTAL') onlineYuan += amount;
      else if (compStudio?.id === studioId) offlineYuan += amount;
    }

    const headcount = admins.length;
    const offlineCommissionYuan = (offlineYuan * (rates.offline / 100)) / headcount;
    const onlineCommissionYuan = (onlineYuan * (rates.online / 100)) / headcount;
    const rows = admins.map((u) => ({
      userId: u.id,
      username: u.username,
      displayName: u.displayName,
      offlineYuan,
      onlineYuan,
      offlineCommissionYuan,
      onlineCommissionYuan,
      commissionYuan: offlineCommissionYuan + onlineCommissionYuan,
    }));
    return { rows, rates };
  }

  /** 桥接阶梯：返回每单单价和底薪是否全额。 */
  private bridgeTier(units: number, cfg: any): { perUnitYuan: number; baseFull: boolean } {
    if (units < cfg.bridgeMin) return { perUnitYuan: cfg.bridgePerOrderCents / 100, baseFull: false };
    if (units >= cfg.bridgeTier5) return { perUnitYuan: cfg.bridgeTier5Yuan, baseFull: true };
    if (units >= cfg.bridgeTier3) return { perUnitYuan: cfg.bridgeTier3Yuan, baseFull: true };
    return { perUnitYuan: cfg.bridgePerOrderCents / 100, baseFull: true };
  }

  /**
   * 统计成功单：必须是被陪玩抢走、且已经打了首单（type=NEW、status=DONE）。
   * 单陪算 1 单，双陪算 2 单。
   */
  private async querySuccessfulCsOrders(studioId: string, start: Date, end: Date, userId?: string) {
    return this.prisma.order.findMany({
      where: {
        studioId,
        type: 'NEW',
        createdAt: { gte: start, lt: end },
        ...(userId
          ? { OR: [{ attributedCsUserId: userId }, { claimedCsUserId: userId }, { csUserId: userId }] }
          : {}),
        // 成功口径统一走 common/order-outcome.ts（老板 2026-09-29）：
        // 线下 = 点了「开始首单」（历史 DONE 单也算）；桥接 / 线上 = 接单方反馈「成功」。
        AND: [successOrderWhere(studioId)],
      },
      select: {
        id: true,
        orderCode: true,
        type: true,
        amount: true,
        duration: true,
        customFields: true,
        coCompanionId: true,
        csUserId: true,
        attributedCsUserId: true,
        claimedCsUserId: true,
        createdAt: true,
        poolScope: true,
        companion: { select: { studio: { select: { id: true, type: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 查询某客服在某营业月内所有相关订单（用于明细查看，不参与有效单过滤）。 */
  private async queryAllCsOrders(studioId: string, start: Date, end: Date, userId: string) {
    return this.prisma.order.findMany({
      where: {
        studioId,
        createdAt: { gte: start, lt: end },
        OR: [{ attributedCsUserId: userId }, { claimedCsUserId: userId }, { csUserId: userId }],
        companionId: { not: null },
      },
      select: {
        id: true,
        orderCode: true,
        type: true,
        status: true,
        contactStatus: true,
        outcome: true,
        outcomeReason: true,
        refundedAt: true,
        amount: true,
        duration: true,
        customFields: true,
        coCompanionId: true,
        csUserId: true,
        attributedCsUserId: true,
        claimedCsUserId: true,
        createdAt: true,
        companion: { select: { studio: { select: { id: true, type: true } } } },
        sessions: { select: { startedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 计算每个客服的工资+提成明细（不落库），userId 可选用于只看某一人。 */
  private async buildCsSalaryRows(studioId: string, start: Date, end: Date, userId?: string) {
    const cfg = await this.csSalaryConfig(studioId);
    const users = await this.prisma.user.findMany({
      where: { studioId, role: 'CS', ...(userId ? { id: userId } : {}) },
      select: { id: true, username: true, displayName: true },
      orderBy: { username: 'asc' },
    });
    const ids = users.map((u) => u.id);
    const attendanceRows = ids.length
      ? await this.prisma.staffAttendance.findMany({
          where: { userId: { in: ids }, date: { gte: start, lt: end } },
        })
      : [];
    const orders = await this.querySuccessfulCsOrders(studioId, start, end, userId);
    // 客服档位（老板 2026-09-29）：按人填了底薪就用他的，没填就用「工资规则」里客服那一个数
    const profiles = await this.prisma.csProfile
      .findMany({ where: { studioId } })
      .catch(() => [] as Array<{ userId: string; baseSalaryYuan: number | null }>);
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

    const monthDays = new Date(new Date(start).getFullYear(), new Date(start).getMonth() + 1, 0).getDate();
    const fullAttendance = Math.max(0, monthDays - cfg.restDays);

    const orderByUser = new Map<string, any[]>();
    for (const o of orders) {
      const csId = o.attributedCsUserId || o.claimedCsUserId || o.csUserId;
      if (!csId) continue;
      if (!orderByUser.has(csId)) orderByUser.set(csId, []);
      orderByUser.get(csId)!.push(o);
    }

    const rows = [];
    for (const u of users) {
      const userOrders = orderByUser.get(u.id) || [];
      const att = attendanceRows.filter((a) => a.userId === u.id);
      const present = att.filter((a) => a.status === 'PRESENT').length;
      const late = att.filter((a) => a.status === 'LATE').length;
      const earlyLeave = att.filter((a) => a.status === 'EARLY_LEAVE').length;
      const absent = att.filter((a) => a.status === 'ABSENT').length;
      const userBaseSalary = Number(profileByUser.get(u.id)?.baseSalaryYuan ?? cfg.baseSalary);
      const dailyBase = userBaseSalary / Math.max(1, fullAttendance);

      let offlineCents = 0;
      let bridgeUnits = 0;
      let onlineUnits = 0;
      let onlineRevenueYuan = 0;
      const trace = [];

      for (const o of userOrders) {
        const compStudio = o.companion?.studio;
        const units = orderUnits(o as any);
        const amount = Number(o.amount || 0);
        const gross = orderGrossYuan(o as any);
        let kind: 'offline' | 'bridge' | 'online' = 'offline';
        if (compStudio) {
          if (compStudio.type === 'RENTAL') kind = 'online';
          else if (compStudio.id !== studioId) kind = 'bridge';
        }

        let commissionYuan = 0;
        if (kind === 'offline') {
          const base = Math.round(amount * 100 * (cfg.ratePercent / 100));
          let c = Math.max(cfg.floorCents, base);
          if (cfg.perOrderCapCents > 0) c = Math.min(c, cfg.perOrderCapCents);
          commissionYuan = centsToYuan(c);
          offlineCents += c;
        } else if (kind === 'online') {
          // 线上俱乐部：客服**按流水比例**计提（老板 2026-09-29）；单量只用于看板统计
          onlineUnits += units;
          onlineRevenueYuan += gross;
          commissionYuan = (gross * cfg.onlineRatePercent) / 100;
        } else {
          bridgeUnits += units;
          commissionYuan = 0; // 桥接单价在月末按阶梯统一算
        }

        trace.push({
          orderId: o.id,
          orderCode: o.orderCode,
          type: o.type,
          amount,
          gross,
          units,
          kind,
          companionStudioType: compStudio?.type || 'OFFLINE',
          commissionYuan: Number(commissionYuan.toFixed(2)),
          createdAt: o.createdAt,
        });
      }

      const tier = this.bridgeTier(bridgeUnits, cfg);
      const bridgeCommissionYuan = bridgeUnits * tier.perUnitYuan;
      const onlineCommissionYuan = Number(((onlineRevenueYuan * cfg.onlineRatePercent) / 100).toFixed(2));
      const offlineCommissionYuan = centsToYuan(offlineCents);
      const commissionYuan = Number((offlineCommissionYuan + bridgeCommissionYuan + onlineCommissionYuan).toFixed(2));

      const baseEffective = tier.baseFull ? userBaseSalary : userBaseSalary / 2;
      const attendanceDeduction = Number(
        (
          Math.max(0, absent) * dailyBase +
          late * cfg.lateDeduction +
          earlyLeave * cfg.earlyLeaveDeduction
        ).toFixed(2),
      );
      const isFullAttendance = att.filter((a) => a.status === 'PRESENT').length >= fullAttendance;
      const attendanceBonus = isFullAttendance ? cfg.fullAttendanceBonus : 0;
      const totalYuan = Number((baseEffective + commissionYuan + attendanceBonus - attendanceDeduction).toFixed(2));

      rows.push({
        userId: u.id,
        username: u.username,
        displayName: u.displayName,
        baseSalary: userBaseSalary,
        baseEffective,
        restDays: cfg.restDays,
        fullAttendance,
        monthDays,
        attendance: { present, late, earlyLeave, absent, isFullAttendance },
        attendanceBonus,
        attendanceDeduction,
        bridgeUnits,
        bridgePerUnitYuan: tier.perUnitYuan,
        bridgeCommissionYuan: Number(bridgeCommissionYuan.toFixed(2)),
        offlineCommissionYuan: Number(offlineCommissionYuan.toFixed(2)),
        onlineUnits,
        onlineRevenueYuan: Number(onlineRevenueYuan.toFixed(2)),
        onlineCommissionYuan: Number(onlineCommissionYuan.toFixed(2)),
        commissionYuan,
        totalYuan,
        bridgeMet: tier.baseFull,
        trace,
      });
    }

    return { config: cfg, rows, fullAttendance, monthDays };
  }

  /** 客服端右上角「底薪+提奖」：只看当前登录客服本人。 */
  async getCsMySalary(studioId: string, userId: string, month?: string) {
    studioId = await this.resolveStudioId(studioId);
    const d = new Date();
    const m = month || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const { start, end } = settlementMonthRange(m);
    const built = await this.buildCsSalaryRows(studioId, start, end, userId);
    const row = built.rows[0] || null;
    const allOrders = row ? await this.queryAllCsOrders(studioId, start, end, userId) : [];
    const orders = allOrders.map((o) => {
      const compStudio = o.companion?.studio;
      const units = orderUnits(o as any);
      const gross = orderGrossYuan(o as any);
      let kind: 'offline' | 'bridge' | 'online' = 'offline';
      if (compStudio) {
        if (compStudio.type === 'RENTAL') kind = 'online';
        else if (compStudio.id !== studioId) kind = 'bridge';
      }
      // 成功口径：线下 = 点了「开始首单」；桥接 / 线上 = 接单方反馈成功
      const decision = outcomeOf(o as any, studioId);
      const counted = o.type === 'NEW' && decision.counted;
      let commissionYuan: number | null = null;
      if (counted) {
        if (kind === 'offline') {
          const base = Math.round(Number(o.amount || 0) * 100 * (built.config.ratePercent / 100));
          let c = Math.max(built.config.floorCents, base);
          if (built.config.perOrderCapCents > 0) c = Math.min(c, built.config.perOrderCapCents);
          commissionYuan = centsToYuan(c);
        } else if (kind === 'online') {
          // 线上俱乐部：按流水比例计提
          commissionYuan = Number(((gross * built.config.onlineRatePercent) / 100).toFixed(2));
        } else {
          commissionYuan = Number((row!.bridgePerUnitYuan * units).toFixed(2));
        }
      }
      return {
        orderId: o.id,
        orderCode: o.orderCode,
        type: o.type,
        status: o.status,
        contactStatus: o.contactStatus,
        amount: Number(o.amount || 0),
        gross,
        units,
        kind,
        companionStudioType: compStudio?.type || 'OFFLINE',
        counted,
        state: decision.state,
        stateReason: decision.reason,
        commissionYuan,
        createdAt: o.createdAt,
      };
    });
    return {
      month: m,
      fullAttendance: built.fullAttendance,
      monthDays: built.monthDays,
      config: {
        baseSalary: built.config.baseSalary,
        restDays: built.config.restDays,
        lateDeduction: built.config.lateDeduction,
        earlyLeaveDeduction: built.config.earlyLeaveDeduction,
        absentDeductionPerDay: built.config.baseSalary / Math.max(1, built.fullAttendance),
        fullAttendanceBonus: built.config.fullAttendanceBonus,
        offlineRatePercent: built.config.ratePercent,
        offlineFloorYuan: centsToYuan(built.config.floorCents),
        offlineCapYuan: centsToYuan(built.config.perOrderCapCents),
        bridgeMin: built.config.bridgeMin,
        bridgeTier3: built.config.bridgeTier3,
        bridgeTier5: built.config.bridgeTier5,
        bridgeBaseYuan: centsToYuan(built.config.bridgePerOrderCents),
        bridgeTier3Yuan: built.config.bridgeTier3Yuan,
        bridgeTier5Yuan: built.config.bridgeTier5Yuan,
        onlinePerOrderYuan: centsToYuan(built.config.onlinePerOrderCents),
        onlineRatePercent: built.config.onlineRatePercent,
      },
      row,
      orders,
    };
  }

  /** 实时估算某营业月的客服提成（不落库）。 */
  async computeCsCommission(studioId: string, month: string, userId?: string) {
    studioId = await this.resolveStudioId(studioId);
    const { start, end } = settlementMonthRange(month);
    const cfg = await this.csConfig(studioId);
    const users = await this.prisma.user.findMany({
      where: { studioId, role: 'CS', ...(userId ? { id: userId } : {}) },
      select: { id: true, username: true, displayName: true },
    });
    const rows: Array<Record<string, unknown>> = [];
    for (const u of users) {
      const orders = await this.prisma.order.findMany({
        where: {
          type: 'NEW',
          createdAt: { gte: start, lt: end },
          OR: [{ attributedCsUserId: u.id }, { claimedCsUserId: u.id }],
          // 成功口径统一走 common/order-outcome.ts（老板 2026-09-29）
          AND: [successOrderWhere(studioId)],
        },
        select: {
          amount: true,
          duration: true,
          customFields: true,
          coCompanionId: true,
          companion: { select: { studio: { select: { id: true, type: true } } } },
        },
      });
      let offlineCents = 0;
      let bridgeCents = 0;
      let onlineCents = 0;
      let onlineRevenueYuan = 0;
      for (const o of orders) {
        const compStudio = o.companion?.studio;
        const companions = orderUnits(o as any);
        if (compStudio?.type === 'RENTAL') {
          // 线上俱乐部：按流水比例计提（老板 2026-09-29）
          onlineRevenueYuan += orderGrossYuan(o as any);
        } else if (compStudio && compStudio.id !== studioId) {
          bridgeCents += cfg.bridgePerOrderCents * companions;
        } else {
          const base = Math.round(o.amount * 100 * (cfg.ratePercent / 100));
          let c = Math.max(cfg.floorCents, base);
          if (cfg.perOrderCapCents > 0) c = Math.min(c, cfg.perOrderCapCents);
          offlineCents += c;
        }
      }
      onlineCents += Math.round(onlineRevenueYuan * (cfg.onlineRatePercent / 100) * 100);
      rows.push({
        userId: u.id,
        username: u.username,
        displayName: u.displayName,
        offlineYuan: centsToYuan(offlineCents),
        bridgeYuan: centsToYuan(bridgeCents),
        onlineYuan: centsToYuan(onlineCents),
        totalYuan: centsToYuan(offlineCents + bridgeCents + onlineCents),
      });
    }
    return { month, rows };
  }

  /**
   * 客服提成 · 今日看板（实时估算，不落库）。
   *
   * 老板 2026-09-29 定的一屏：「今天派出多少 / 成功多少 / 不成功多少 / 待反馈多少 / 成功率 /
   * 今天应发（底薪按天折算 + 提成）、当月累计」，店长、客服都能看到自己那一行。
   * 口径全部走 `common/order-outcome.ts`（和真的算钱的地方共用同一套）：
   *  - **线下单**：陪玩点了「开始首单」才算成功（退款 / 取消不算）；
   *  - **桥接 / 线上单**：接单方反馈「成功」才算，没反馈 = 待反馈；
   *  - **提成只按成功单算**；不成功的单不计提成、也不扣钱，但会留记录（原因排行看得到）；
   *  - **桥接达标**（底薪是否打折）按「跑了多少桥接单」算，只排除明确不成功的单 ——
   *    免得客服替接单方背锅（对方没回话，底薪先被扣了）。
   */
  async getCsCommissionToday(studioId: string) {
    if (!studioId) {
      const first = await this.prisma.studio.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
      studioId = first?.id || '';
    }
    const bd = businessDayOf(new Date());
    const dateLabel = `${bd.getFullYear()}-${String(bd.getMonth() + 1).padStart(2, '0')}-${String(bd.getDate()).padStart(2, '0')}`;
    const { start, end } = currentBusinessDayRange();
    const salaryCfg = await this.csSalaryConfig(studioId);
    const dayCfg = await resolveConfigsRaw(this.prisma, studioId, [
      'commission.cs_daily_bridge_target',
      'commission.cs_bridge_miss_commission_rate',
      'commission.cs_bridge_miss_salary_rate',
    ]);
    const bridgeTarget = Number((dayCfg as Record<string, unknown>)['commission.cs_daily_bridge_target'] ?? 10);
    const missCommissionRate = Number(
      (dayCfg as Record<string, unknown>)['commission.cs_bridge_miss_commission_rate'] ?? 50,
    );
    const missSalaryRate = Number(
      (dayCfg as Record<string, unknown>)['commission.cs_bridge_miss_salary_rate'] ?? 80,
    );

    const [orders, csUsers, profiles, monthBuilt] = await Promise.all([
      this.prisma.order.findMany({
        where: { studioId, createdAt: { gte: start, lt: end } },
        include: {
          companion: {
            include: {
              studio: { select: { id: true, type: true } },
              user: { select: { username: true, displayName: true } },
            },
          },
          sessions: { select: { startedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.findMany({
        where: { studioId, role: 'CS' },
        select: { id: true, username: true, displayName: true },
      }),
      this.prisma.csProfile.findMany({ where: { studioId } }).catch(() => []),
      this.buildCsSalaryRows(studioId, settlementMonthRange(dateLabel.slice(0, 7)).start, settlementMonthRange(dateLabel.slice(0, 7)).end).catch(
        () => ({ rows: [] as any[] }),
      ),
    ]);

    const round2 = (n: number) => Number(n.toFixed(2));
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
    const baseSalaryOf = (userId: string) =>
      Number(profileByUser.get(userId)?.baseSalaryYuan ?? salaryCfg.baseSalary ?? 0);
    const monthByUser = new Map((monthBuilt.rows as any[]).map((r) => [r.userId, r]));
    const monthDays = new Date(end.getFullYear(), end.getMonth(), 0).getDate();
    const fullAttendance = Math.max(1, monthDays - salaryCfg.restDays);

    const blank = (u: { id: string; username: string; displayName?: string | null }) => ({
      userId: u.id,
      username: u.username,
      displayName: u.displayName,
      poolScope: profileByUser.get(u.id)?.poolScope ?? 'OFFLINE_FIRST',
      baseSalaryYuan: baseSalaryOf(u.id),
      published: 0,
      dispatched: 0,
      totalOrders: 0,
      offlineOrders: 0,
      bridgeOrders: 0,
      onlineOrders: 0,
      success: 0,
      failed: 0,
      pending: 0,
      unstarted: 0,
      offlineSuccess: 0,
      bridgeSuccess: 0,
      onlineSuccess: 0,
      failReasons: {} as Record<string, number>,
      offlineFlow: 0,
      onlineFlow: 0,
      offlineCommission: 0,
      bridgeCommission: 0,
      onlineCommission: 0,
    });
    const csMap = new Map<string, any>(csUsers.map((u) => [u.id, blank(u)]));
    const others = blank({ id: '', username: '（未认领）' }); // 发单客服已离职 / 归属人查不到时兜底，只进总计
    const s = blank({ id: '', username: '合计' });

    for (const o of orders) {
      const csId = o.attributedCsUserId || o.claimedCsUserId || o.csUserId || '';
      const cs = csMap.get(csId) || others;
      const decision = outcomeOf(o, studioId);
      const units = orderUnits(o as any);
      const amount = Number(o.amount || 0);
      const gross = orderGrossYuan(o as any);
      const dispatched = !!o.companionId;
      const bridgeCountsForTarget =
        decision.channel !== 'offline' && dispatched && !o.refundedAt && o.status !== 'CANCELLED' && decision.state !== 'FAILED';

      for (const target of [s, cs]) {
        target.published += 1;
        if (!dispatched) continue;
        target.dispatched += 1;
        target.totalOrders += 1;
        if (decision.channel === 'offline') target.offlineOrders += 1;
        else if (decision.channel === 'online') target.onlineOrders += bridgeCountsForTarget ? units : 0;
        else target.bridgeOrders += bridgeCountsForTarget ? units : 0;
        if (decision.state === 'SUCCESS') {
          target.success += 1;
          if (decision.channel === 'offline') target.offlineSuccess += 1;
          else if (decision.channel === 'online') target.onlineSuccess += units;
          else target.bridgeSuccess += units;
        } else if (decision.state === 'FAILED') {
          target.failed += 1;
          const reason = (o.outcomeReason || '未填原因').trim() || '未填原因';
          target.failReasons[reason] = (target.failReasons[reason] || 0) + 1;
        } else if (decision.state === 'PENDING') {
          target.pending += 1;
        } else {
          target.unstarted += 1;
        }
        if (!decision.counted) continue;
        // 算钱（只算成功单）
        if (decision.channel === 'offline') {
          target.offlineFlow += amount;
          let c = amount * (salaryCfg.ratePercent / 100);
          c = Math.max(c, salaryCfg.floorCents / 100);
          if (salaryCfg.perOrderCapCents > 0) c = Math.min(c, salaryCfg.perOrderCapCents / 100);
          target.offlineCommission += c;
        } else if (decision.channel === 'online') {
          // 线上俱乐部：按流水比例计提（老板 2026-09-29）
          target.onlineFlow += gross;
          target.onlineCommission += (gross * salaryCfg.onlineRatePercent) / 100;
        } else {
          target.bridgeCommission += (salaryCfg.bridgePerOrderCents / 100) * units;
        }
      }
    }

    let bridgeMetCount = 0;
    const csList = Array.from(csMap.values())
      .map((c) => {
        const totalCommissionYuan = round2(c.offlineCommission + c.bridgeCommission + c.onlineCommission);
        const bridgeMet = c.bridgeOrders >= bridgeTarget;
        if (bridgeMet) bridgeMetCount += 1;
        const commissionAfter = bridgeMet ? totalCommissionYuan : round2(totalCommissionYuan * (missCommissionRate / 100));
        const salaryAfter = bridgeMet ? c.baseSalaryYuan : round2(c.baseSalaryYuan * (missSalaryRate / 100));
        const salaryDaily = round2(salaryAfter / fullAttendance);
        const month = monthByUser.get(c.userId);
        const concluded = c.success + c.failed;
        return {
          ...c,
          offlineFlow: round2(c.offlineFlow),
          onlineFlow: round2(c.onlineFlow),
          offlineCommission: round2(c.offlineCommission),
          bridgeCommission: round2(c.bridgeCommission),
          onlineCommission: round2(c.onlineCommission),
          totalCommission: totalCommissionYuan,
          bridgeTarget,
          bridgeMet,
          commissionAfter,
          salaryAfter,
          salaryDaily,
          todayPay: round2(salaryDaily + commissionAfter),
          successRate: concluded > 0 ? round2((c.success / concluded) * 100) : null,
          monthCommissionYuan: month ? round2(Number(month.commissionYuan || 0)) : 0,
          monthTotalYuan: month ? round2(Number(month.totalYuan || 0)) : 0,
        };
      })
      .sort((a, b) => b.todayPay - a.todayPay || b.totalOrders - a.totalOrders);

    const totalCommission = s.offlineCommission + s.bridgeCommission + s.onlineCommission;
    const concluded = s.success + s.failed;

    return {
      date: dateLabel,
      config: {
        bridgePerOrderYuan: salaryCfg.bridgePerOrderCents / 100,
        onlinePerOrderYuan: salaryCfg.onlinePerOrderCents / 100,
        onlineRatePercent: salaryCfg.onlineRatePercent,
        offlineRatePercent: salaryCfg.ratePercent,
        baseSalaryYuan: salaryCfg.baseSalary,
        bridgeTarget,
        missCommissionRate,
        missSalaryRate,
        fullAttendance,
      },
      summary: {
        published: s.published,
        dispatched: s.dispatched,
        success: s.success,
        failed: s.failed,
        pending: s.pending,
        successRate: concluded > 0 ? round2((s.success / concluded) * 100) : null,
        totalOrders: s.totalOrders,
        offlineOrders: s.offlineOrders,
        bridgeOrders: s.bridgeOrders,
        onlineOrders: s.onlineOrders,
        totalFlow: round2(s.offlineFlow),
        offlineFlow: round2(s.offlineFlow),
        onlineFlow: round2(s.onlineFlow),
        offlineCommission: round2(s.offlineCommission),
        bridgeCommission: round2(s.bridgeCommission),
        onlineCommission: round2(s.onlineCommission),
        totalCommission: round2(totalCommission),
        baseSalaryYuan: salaryCfg.baseSalary,
        bridgeTarget,
        bridgeMetCount,
        csCount: csList.length,
        failReasons: s.failReasons,
      },
      csList,
    };
  }

  /**
   * 今日看板点开某一行时的明细：这个客服今天发出去的单 + 每张单现在的结果。
   * 界面据此出「原因排行」和逐单的「反馈」按钮。
   */
  async csTodayOrders(studioId: string, userId: string) {
    if (!studioId) {
      const first = await this.prisma.studio.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
      studioId = first?.id || '';
    }
    const { start, end } = currentBusinessDayRange();
    const orders = await this.prisma.order.findMany({
      where: {
        studioId,
        createdAt: { gte: start, lt: end },
        OR: [{ attributedCsUserId: userId }, { claimedCsUserId: userId }, { csUserId: userId }],
      },
      include: {
        companion: { include: { studio: { select: { id: true, name: true, type: true } }, user: { select: { username: true, displayName: true } } } },
        customer: { select: { customerCode: true, wechatId: true } },
        sessions: { select: { startedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((o) => {
      const decision = outcomeOf(o, studioId);
      return {
        orderId: o.id,
        orderCode: o.orderCode,
        type: o.type,
        status: o.status,
        amount: Number(o.amount || 0),
        units: o.coCompanionId ? 2 : 1,
        customerCode: o.customer?.customerCode || null,
        customerWechat: o.customer?.wechatId || null,
        companionName:
          o.companion?.user?.displayName || o.companion?.user?.username || null,
        companionStudio: o.companion?.studio?.name || null,
        channel: decision.channel,
        state: decision.state,
        counted: decision.counted,
        stateReason: decision.reason,
        outcome: o.outcome,
        outcomeReason: o.outcomeReason,
        outcomeNote: o.outcomeNote,
        outcomeAt: o.outcomeAt,
        refundedAt: o.refundedAt,
        createdAt: o.createdAt,
      };
    });
  }

  /** 客服档位：按人存的默认派单范围 + 底薪（老板 2026-09-29）。 */
  async listCsProfiles(studioId: string) {
    const resolved = await this.resolveStudioId(studioId);
    const [users, profiles] = await Promise.all([
      this.prisma.user.findMany({
        where: { studioId: resolved, role: 'CS' },
        select: { id: true, username: true, displayName: true },
        orderBy: { username: 'asc' },
      }),
      this.prisma.csProfile.findMany({ where: { studioId: resolved } }).catch(() => []),
    ]);
    const payroll = await this.prisma.payrollConfig.findUnique({ where: { role: 'CS' } });
    const byUser = new Map(profiles.map((p) => [p.userId, p]));
    return {
      defaultBaseSalaryYuan: Number(payroll?.baseSalary ?? 0),
      items: users.map((u) => ({
        userId: u.id,
        username: u.username,
        displayName: u.displayName,
        poolScope: byUser.get(u.id)?.poolScope ?? 'OFFLINE_FIRST',
        baseSalaryYuan: byUser.get(u.id)?.baseSalaryYuan ?? null,
      })),
    };
  }

  /** 存某个客服的档位（默认派单范围 + 底薪；填空 = 用统一默认）。 */
  async saveCsProfile(
    studioId: string,
    dto: { userId: string; poolScope?: string; baseSalaryYuan?: number | null },
  ) {
    const resolved = await this.resolveStudioId(studioId);
    if (!dto.userId) throw new NotFoundException('缺少客服');
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, studioId: resolved, role: 'CS' },
      select: { id: true, username: true, displayName: true },
    });
    if (!user) throw new NotFoundException('这家店里没有这个客服');
    const poolScope = dto.poolScope === 'ONLINE_FIRST' ? 'ONLINE_FIRST' : 'OFFLINE_FIRST';
    const baseSalaryYuan =
      dto.baseSalaryYuan === null || dto.baseSalaryYuan === undefined || Number.isNaN(Number(dto.baseSalaryYuan))
        ? null
        : Number(dto.baseSalaryYuan);
    if (baseSalaryYuan !== null && baseSalaryYuan < 0) throw new NotFoundException('底薪不能是负数');
    await this.prisma.csProfile.upsert({
      where: { userId: dto.userId },
      create: { userId: dto.userId, studioId: resolved, poolScope, baseSalaryYuan },
      update: { poolScope, baseSalaryYuan, studioId: resolved },
    });
    return this.listCsProfiles(resolved);
  }
  /** 保存客服桥接达标规则（每日桥接单数目标 + 未达标惩罚）。按身份写：老板全局 / 店长本店。 */
  async saveBridgeRule(
    dto: { bridgeTarget: number; missCommissionRate: number; missSalaryRate: number },
    actor?: { role?: string | null; studioId?: string | null },
  ) {
    const bridgeTarget = Number(dto.bridgeTarget);
    const missCommissionRate = Number(dto.missCommissionRate);
    const missSalaryRate = Number(dto.missSalaryRate);
    for (const [name, v] of [
      ['桥接目标', bridgeTarget],
      ['未达标提成比例', missCommissionRate],
      ['未达标底薪比例', missSalaryRate],
    ] as Array<[string, number]>) {
      if (!Number.isFinite(v) || v < 0) throw new NotFoundException(`${name} 必须是大于等于 0 的数字`);
    }
    await saveConfigsByRole(this.prisma, actor ?? {}, {
      'commission.cs_daily_bridge_target': bridgeTarget,
      'commission.cs_bridge_miss_commission_rate': missCommissionRate,
      'commission.cs_bridge_miss_salary_rate': missSalaryRate,
    });
    return { bridgeTarget, missCommissionRate, missSalaryRate };
  }

  /** 确保存在一个 CS 提成锚点规则（用于挂载月度提成明细）。 */
  async ensureDefaultCsRules(studioId: string) {
    return this.ensureCsAnchorRule(studioId);
  }

  /** 找到或创建一个店长（ADMIN）提成锚点规则。 */
  private async ensureAdminAnchorRule(studioId: string) {
    const existing = await this.prisma.commissionRule.findFirst({
      where: { studioId, role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;
    return this.prisma.commissionRule.create({
      data: { studioId, role: 'ADMIN', basis: 'REVENUE', type: 'RATE', rate: 0, source: null, isActive: true },
    });
  }

  /** 找到或创建一个 CS 提成锚点规则。 */
  private async ensureCsAnchorRule(studioId: string) {
    const existing = await this.prisma.commissionRule.findFirst({
      where: { studioId, role: 'CS' },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;
    return this.prisma.commissionRule.create({
      data: { studioId, role: 'CS', basis: 'CLAIMED_AMOUNT', type: 'RATE', rate: 0, source: null, isActive: true },
    });
  }
}
