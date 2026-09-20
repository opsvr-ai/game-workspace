import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveConfigsRaw } from '../common/studio-config';

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

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
    const date = new Date(dto.date);
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
    // 店长可自己填本店的桥接目标与未达标比例
    const scoped = await resolveConfigsRaw(this.prisma, studioId, [
      'commission.cs_daily_bridge_target',
      'commission.cs_bridge_miss_salary_rate',
    ]);
    const bridgeTarget = Number(scoped['commission.cs_daily_bridge_target'] ?? 10);
    const missSalaryRate = Number(scoped['commission.cs_bridge_miss_salary_rate'] ?? 80);
    const bridgeCounts = await this.bridgeOrderCounts(studioId, start, end);
    const records = [];
    for (const user of staff) {
      const config = await this.prisma.payrollConfig.findUnique({ where: { role: user.role } });
      if (!config) continue;
      const attendance = await this.prisma.staffAttendance.findMany({
        where: { userId: user.id, date: { gte: start, lt: end } },
      });
      const absent = attendance.filter((a) => a.status === 'ABSENT').length;
      const late = attendance.filter((a) => a.status === 'LATE').length;
      let base = config.baseSalary;
      // 月休天数（复用 fullAttendanceDays 存），满勤 = 当月天数 − 月休天数；月休内缺勤不扣款
      const monthDays = Math.round((end.getTime() - start.getTime()) / 86400000);
      const restDays = config.fullAttendanceDays ?? 4;
      const fullAttendance = Math.max(0, monthDays - restDays);
      // 客服桥接达标：整月桥接单数未达目标，底薪按比例下调。
      if (user.role === 'CS' && bridgeTarget > 0) {
        const threshold = bridgeTarget * monthDays;
        if ((bridgeCounts.get(user.id) || 0) < threshold) {
          base = Number((base * missSalaryRate) / 100);
        }
      }
      const attendanceDeduction = Math.max(0, absent - restDays) * config.absentDeduction + late * config.lateDeduction;
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
      where: { studioId, status: 'DONE', createdAt: { gte: start, lt: end }, companionId: { not: null } },
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
