import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveConfigsRaw } from '../common/studio-config';
import { bridgeMetOrderWhere } from '../common/order-outcome';

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

  /** 这个职位的考勤开没开（本店店长填的 → 老板全局默认）。老板 2026-10-04。 */
  private async attendanceEnabled(role: string, studioId?: string | null): Promise<boolean> {
    if (role !== 'CS' && role !== 'ADMIN') return true;
    const key = role === 'CS' ? 'attendance.cs.enabled' : 'attendance.manager.enabled';
    const scoped = await resolveConfigsRaw(this.prisma, studioId ?? null, [key]);
    const v = scoped[key];
    return v === undefined || v === null ? true : Boolean(v);
  }

  async listConfigs() {
    return this.prisma.payrollConfig.findMany({ orderBy: { role: 'asc' } });
  }

  async upsertConfig(dto: any) {
    const data = {
      role: dto.role,
      baseSalary: Number(dto.baseSalary),
      performancePercent: Number(dto.performancePercent ?? 0),
      offlinePercent: Number(dto.offlinePercent ?? 0),
      bridgeFixed: Number(dto.bridgeFixed ?? 0),
      fullAttendanceDays: Number(dto.fullAttendanceDays ?? 4),
      lateDeduction: Number(dto.lateDeduction),
      absentDeduction: Number(dto.absentDeduction),
      isActive: dto.isActive ?? true,
    };
    return this.prisma.payrollConfig.upsert({ where: { role: dto.role }, create: data, update: data });
  }

  async markAttendance(dto: { userId: string; date: string; status: string }) {
    // 日期必须归一到「当天 0 点（服务器本地时区）」，跟客户端自动打卡写的日期是同一个 key。
    // 以前直接 new Date('2026-10-04') 是 UTC 0 点（北京时间早上 8 点），跟自动打卡的
    // 本地 0 点对不上 —— 同一天会存成两行，手动登记的考勤就白填了。
    const [y, m, d] = String(dto.date).slice(0, 10).split('-').map(Number);
    const date = new Date(y, (m || 1) - 1, d || 1);
    date.setHours(0, 0, 0, 0);

    const user = await this.prisma.user
      .findUnique({ where: { id: dto.userId }, select: { role: true, studioId: true } })
      .catch(() => null);
    if (user && !(await this.attendanceEnabled(user.role, user.studioId))) {
      throw new BadRequestException('这个职位的考勤已经关掉了，要登记请先到「设置 → 考勤设置」把它打开');
    }

    return this.prisma.staffAttendance.upsert({
      where: { userId_date: { userId: dto.userId, date } },
      create: { userId: dto.userId, date, status: dto.status },
      update: { status: dto.status },
    });
  }

  async listStaff(studioId: string) {
    return this.prisma.user.findMany({
      where: { studioId, role: { in: ['CS', 'ADMIN'] } },
      select: { id: true, username: true, role: true },
      orderBy: { username: 'asc' },
    });
  }

  async generate(studioId: string, month: string) {
    const [start, end] = this.monthRange(month);
    const staff = await this.listStaff(studioId);
    // 店长可自己填本店的桥接目标（只用于回显「本月桥接 N 单 / 目标 M」）
    const scoped = await resolveConfigsRaw(this.prisma, studioId, ['commission.cs_daily_bridge_target']);
    const bridgeTarget = Number(scoped['commission.cs_daily_bridge_target'] ?? 10);
    const bridgeCounts = await this.bridgeOrderCounts(studioId, start, end);
    // 客服档位（老板 2026-09-29）：按人填了底薪就用他的，没填就用「工资规则」里的
    const csProfiles = await this.prisma.csProfile.findMany({ where: { studioId } }).catch(() => []);
    const profileByUser = new Map(csProfiles.map((p) => [p.userId, p]));
    const records = [];
    for (const user of staff) {
      const config = await this.prisma.payrollConfig.findUnique({ where: { role: user.role } });
      if (!config) continue;
      const baseSalaryCfg = Number(profileByUser.get(user.id)?.baseSalaryYuan ?? config.baseSalary);
      const attendance = await this.prisma.staffAttendance.findMany({
        where: { userId: user.id, date: { gte: start, lt: end } },
      });
      const absent = attendance.filter((a) => a.status === 'ABSENT').length;
      const late = attendance.filter((a) => a.status === 'LATE').length;
      let base = baseSalaryCfg;
      // 月休天数（复用 fullAttendanceDays 存），满勤 = 当月天数 − 月休天数；月休内缺勤不扣款
      const monthDays = Math.round((end.getTime() - start.getTime()) / 86400000);
      const restDays = config.fullAttendanceDays ?? 4;
      const fullAttendance = Math.max(0, monthDays - restDays);
      // 底薪不打折（老板 2026-09-30：「别这样了，扣底薪客服会不愿意的」）——
      // 以前这里是「整月桥接单数没到「每日目标 × 月天数」就按比例下调底薪」，现在整条废掉：
      // 未达标只影响桥接单价阶梯（在 commission.service 里算），底薪永远全额。
      // bridgeCount / bridgeTarget 仍然回显给店长看「谁这个月跑了多少桥接单」。
      // 该职位考勤关掉 → 不统计考勤扣款（老板 2026-10-04：有的职位暂时不需要开考勤）
      const attendanceOn = await this.attendanceEnabled(user.role, studioId);
      const attendanceDeduction = attendanceOn
        ? Math.max(0, absent - restDays) * config.absentDeduction + late * config.lateDeduction
        : 0;
      // 派单提成：直接引用已确认（CONFIRMED）的提成明细，分 → 元，四舍五入到毛
      const ledgerAgg = await this.prisma.commissionLedger.aggregate({
        where: { userId: user.id, month, studioId, status: 'CONFIRMED' },
        _sum: { amount: true },
      });
      const commissionYuan = Number(((ledgerAgg._sum.amount ?? 0) / 100).toFixed(1));
      const total = base + commissionYuan - attendanceDeduction;
      const record = await this.prisma.payrollRecord.upsert({
        where: { userId_month: { userId: user.id, month } },
        create: {
          userId: user.id, month, baseSalary: base, performanceSalary: commissionYuan,
          attendanceDeduction, totalSalary: total,
        },
        update: {
          baseSalary: base, performanceSalary: commissionYuan, attendanceDeduction, totalSalary: total,
        },
      });
      records.push({
        ...record,
        username: user.username,
        role: user.role,
        attendanceDays: attendance.length,
        commissionYuan,
        monthDays,
        restDays,
        fullAttendance,
        attendanceEnabled: attendanceOn,
        bridgeCount: bridgeCounts.get(user.id) || 0,
        bridgeTarget,
      });
    }
    return records;
  }

  async listRecords(month: string) {
    return this.prisma.payrollRecord.findMany({
      where: { month },
      orderBy: { totalSalary: 'desc' },
    });
  }

  private monthRange(month: string): [Date, Date] {
    const [y, m] = month.split('-').map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    return [start, end];
  }

  private async bridgeOrderCounts(studioId: string, start: Date, end: Date): Promise<Map<string, number>> {
    const orders = await this.prisma.order.findMany({
      where: {
        studioId,
        createdAt: { gte: start, lt: end },
        // 桥接达标口径走 common/order-outcome.ts（和「今日看板」用的是同一个）：
        // 跑了多少桥接单，只排除明确不成功 / 退款 / 取消的；接单方还没反馈的照算 ——
        // 对方没回话，不该扣客服的底薪。两处必须同口径，否则「看板说达标、工资却扣了」。
        ...bridgeMetOrderWhere(),
      },
      select: {
        csUserId: true,
        attributedCsUserId: true,
        claimedCsUserId: true,
        companion: { select: { studio: { select: { id: true, type: true } } } },
      },
    });
    const map = new Map<string, number>();
    for (const o of orders) {
      const compStudio = o.companion?.studio;
      if (!compStudio || compStudio.type === 'RENTAL' || compStudio.id === studioId) continue;
      const csId = o.attributedCsUserId || o.claimedCsUserId || o.csUserId;
      if (!csId) continue;
      map.set(csId, (map.get(csId) || 0) + 1);
    }
    return map;
  }
}
