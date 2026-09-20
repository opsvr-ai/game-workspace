// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveConfigsRaw } from '../common/studio-config';

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

    // 上班时间：按「本店店长填的 → 老板全局默认」解析
    const studioId = await this.studioIdOf(companionId);
    const scoped = await resolveConfigsRaw(this.prisma, studioId, ['attendance.workStart']);
    const workStartStr = (scoped['attendance.workStart'] as string) ?? '09:00';
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

    // 下班时间：按「本店店长填的 → 老板全局默认」解析
    const studioId = await this.studioIdOf(companionId);
    const scoped = await resolveConfigsRaw(this.prisma, studioId, ['attendance.workEnd']);
    const workEndStr = (scoped['attendance.workEnd'] as string) ?? '18:00';
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

  /** 陪玩属于哪家店（考勤时间按店解析）。 */
  private async studioIdOf(companionId: string): Promise<string | null> {
    const row = await this.prisma.companion
      .findUnique({ where: { id: companionId }, select: { studioId: true } })
      .catch(() => null);
    return row?.studioId ?? null;
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
