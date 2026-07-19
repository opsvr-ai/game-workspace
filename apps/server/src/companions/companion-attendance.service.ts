// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CompanionAttendanceService {
  constructor(private prisma: PrismaService) {}

  async ensureAttendance(companionId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();

    const existing = await this.prisma.companionAttendance.findUnique({
      where: { companionId_date: { companionId, date: today } },
    });

    if (existing) return existing;

    // Read work start time from SystemConfig
    const workStartCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'attendance.workStart' } });
    const workStartStr = (workStartCfg?.value as string) ?? '09:00';
    const [sh, sm] = workStartStr.split(':').map(Number);
    const workStart = new Date(today);
    workStart.setHours(sh, sm, 0, 0);

    const isLate = now > workStart;

    return this.prisma.companionAttendance.create({
      data: {
        companionId,
        date: today,
        loginAt: now,
        isLate,
      },
    });
  }

  async finalizeAttendance(companionId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();

    const record = await this.prisma.companionAttendance.findUnique({
      where: { companionId_date: { companionId, date: today } },
    });
    if (!record) return null;

    const loginAt = new Date(record.loginAt);
    const workMinutes = Math.floor((now.getTime() - loginAt.getTime()) / 60000);

    // Read work end time from SystemConfig
    const workEndCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'attendance.workEnd' } });
    const workEndStr = (workEndCfg?.value as string) ?? '18:00';
    const [eh, em] = workEndStr.split(':').map(Number);
    const workEnd = new Date(today);
    workEnd.setHours(eh, em, 0, 0);

    const isEarlyLeave = now < workEnd;

    return this.prisma.companionAttendance.update({
      where: { id: record.id },
      data: {
        logoutAt: now,
        workMinutes,
        isEarlyLeave,
      },
    });
  }

  async getAttendance(filters: { companionId?: string; dateFrom?: string; dateTo?: string }) {
    const where: any = {};
    if (filters.companionId) where.companionId = filters.companionId;
    if (filters.dateFrom || filters.dateTo) {
      where.date = {};
      if (filters.dateFrom) where.date.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.date.lte = new Date(filters.dateTo);
    }

    return this.prisma.companionAttendance.findMany({
      where,
      include: {
        companion: {
          select: {
            id: true,
            user: { select: { username: true, displayName: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
    });
  }
}
