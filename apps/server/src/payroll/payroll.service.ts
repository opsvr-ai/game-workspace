import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
      performancePercent: Number(dto.performancePercent),
      offlinePercent: Number(dto.offlinePercent ?? 0),
      bridgeFixed: Number(dto.bridgeFixed ?? 0),
      fullAttendanceDays: Number(dto.fullAttendanceDays),
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
    const records = [];
    for (const user of staff) {
      const config = await this.prisma.payrollConfig.findUnique({ where: { role: user.role } });
      if (!config) continue;
      const attendance = await this.prisma.staffAttendance.findMany({
        where: { userId: user.id, date: { gte: start, lt: end } },
      });
      const absent = attendance.filter((a) => a.status === 'ABSENT').length;
      const late = attendance.filter((a) => a.status === 'LATE').length;
      const base = config.baseSalary;
      const attendanceDeduction = absent * config.absentDeduction + late * config.lateDeduction;
      const completedOrders = await this.prisma.order.findMany({
        where: { csUserId: user.id, status: 'DONE', createdAt: { gte: start, lt: end } },
        select: { amount: true, source: true },
      });
      const performance = completedOrders.reduce((sum, o) => {
        if (o.source === 'BRIDGE') return sum + config.bridgeFixed;
        return sum + o.amount * (config.offlinePercent / 100);
      }, 0);
      const total = base + performance - attendanceDeduction;
      const record = await this.prisma.payrollRecord.upsert({
        where: { userId_month: { userId: user.id, month } },
        create: {
          userId: user.id, month, baseSalary: base, performanceSalary: performance,
          attendanceDeduction, totalSalary: total,
        },
        update: {
          baseSalary: base, performanceSalary: performance, attendanceDeduction, totalSalary: total,
        },
      });
      records.push({ ...record, username: user.username, role: user.role, attendanceDays: attendance.length });
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
}
