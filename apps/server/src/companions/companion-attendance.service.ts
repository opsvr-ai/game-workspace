// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveConfigsRaw } from '../common/studio-config';

/**
 * 考勤适用职位：陪玩 / 客服 / 店长（老板不考勤）。
 * 老板 2026-10-04：「再加一个客服、店长考勤时间，而且给每个加上一个开关，我有的职位暂时不需要开考勤」。
 */
export type AttendanceRole = 'COMPANION' | 'CS' | 'ADMIN';

/**
 * 三种职位各自一套配置键：
 * - 陪玩沿用老键 `attendance.workStart` / `attendance.workEnd`（线上店长可能已经填过本店覆盖，不能改名，
 *   否则那些覆盖会失效），开关是新键 `attendance.companion.enabled`；
 * - 客服 `attendance.cs.*`、店长 `attendance.manager.*`。
 */
const ROLE_PREFIX: Record<AttendanceRole, string> = {
  COMPANION: 'attendance',
  CS: 'attendance.cs',
  ADMIN: 'attendance.manager',
};

/** 各职位的「考勤开关」键（陪玩的开关是新键，时间沿用老键，所以不能从 ROLE_PREFIX 拼）。 */
const ROLE_ENABLED_KEY: Record<AttendanceRole, string> = {
  COMPANION: 'attendance.companion.enabled',
  CS: 'attendance.cs.enabled',
  ADMIN: 'attendance.manager.enabled',
};

@Injectable()
export class CompanionAttendanceService {
  constructor(private prisma: PrismaService) {}

  /** 这个职位的考勤开没开（本店店长填的 → 老板全局默认；没配过 = 开）。 */
  async isEnabled(role: AttendanceRole, studioId: string | null): Promise<boolean> {
    const key = ROLE_ENABLED_KEY[role];
    const scoped = await resolveConfigsRaw(this.prisma, studioId, [key]);
    const v = scoped[key];
    return v === undefined || v === null ? true : Boolean(v);
  }

  /** 这个职位的上/下班时间（"HH:mm"）。 */
  async timesOf(role: AttendanceRole, studioId: string | null): Promise<{ workStart: string; workEnd: string }> {
    const prefix = ROLE_PREFIX[role];
    const scoped = await resolveConfigsRaw(this.prisma, studioId, [`${prefix}.workStart`, `${prefix}.workEnd`]);
    return {
      workStart: String(scoped[`${prefix}.workStart`] ?? '09:00'),
      workEnd: String(scoped[`${prefix}.workEnd`] ?? '18:00'),
    };
  }

  private startOfDay(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private atTime(day: Date, hhmm: string): Date {
    const [h, m] = String(hhmm).split(':').map(Number);
    const d = new Date(day);
    d.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
    return d;
  }

  // ───────────────────────── 陪玩：客户端连接 = 上班，断开 = 下班 ─────────────────────────

  async ensureAttendance(companionId: string) {
    const studioId = await this.studioIdOf(companionId);
    // 本店把「陪玩考勤」关掉 → 不再自动记考勤（既不判迟到，也不写记录）
    if (!(await this.isEnabled('COMPANION', studioId))) return null;

    const today = this.startOfDay();
    const now = new Date();

    const existing = await this.prisma.companionAttendance.findUnique({
      where: { companionId_date: { companionId, date: today } },
    });
    if (existing) return existing;

    const { workStart } = await this.timesOf('COMPANION', studioId);
    const isLate = now > this.atTime(today, workStart);

    return this.prisma.companionAttendance.create({
      data: { companionId, date: today, loginAt: now, isLate },
    });
  }

  async finalizeAttendance(companionId: string) {
    const studioId = await this.studioIdOf(companionId);
    if (!(await this.isEnabled('COMPANION', studioId))) return null;

    const today = this.startOfDay();
    const now = new Date();

    const record = await this.prisma.companionAttendance.findUnique({
      where: { companionId_date: { companionId, date: today } },
    });
    if (!record) return null;

    const loginAt = new Date(record.loginAt);
    const workMinutes = Math.floor((now.getTime() - loginAt.getTime()) / 60000);
    const { workEnd } = await this.timesOf('COMPANION', studioId);
    const isEarlyLeave = now < this.atTime(today, workEnd);

    return this.prisma.companionAttendance.update({
      where: { id: record.id },
      data: { logoutAt: now, workMinutes, isEarlyLeave },
    });
  }

  // ─────────────────── 客服 / 店长：同一个客户端连接也自动打上班 / 下班卡 ───────────────────

  /** 客服 / 店长的上班卡：当天没登记过才自动写，管理端手动登记过的一律不动。 */
  async ensureStaffAttendance(userId: string, role: string) {
    if (role !== 'CS' && role !== 'ADMIN') return null;
    const studioId = await this.studioIdOfUser(userId);
    if (!(await this.isEnabled(role as AttendanceRole, studioId))) return null;

    const today = this.startOfDay();
    const now = new Date();

    const existing = await this.prisma.staffAttendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    // 手动登记的优先：管理端当天填过（哪怕填的是缺勤），自动打卡绝不复写。
    if (existing) return existing;

    const { workStart } = await this.timesOf(role as AttendanceRole, studioId);
    return this.prisma.staffAttendance.create({
      data: {
        userId,
        date: today,
        loginAt: now,
        status: now > this.atTime(today, workStart) ? 'LATE' : 'PRESENT',
      },
    });
  }

  /** 客服 / 店长的下班卡：早于下班时间走 → 记早退（已经登记过缺勤 / 早退的不覆盖）。 */
  async finalizeStaffAttendance(userId: string, role: string) {
    if (role !== 'CS' && role !== 'ADMIN') return null;
    const studioId = await this.studioIdOfUser(userId);
    if (!(await this.isEnabled(role as AttendanceRole, studioId))) return null;

    const today = this.startOfDay();
    const now = new Date();
    const record = await this.prisma.staffAttendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (!record) return null;

    const { workEnd } = await this.timesOf(role as AttendanceRole, studioId);
    const isEarlyLeave = now < this.atTime(today, workEnd);
    const status =
      record.status === 'PRESENT' || record.status === 'LATE'
        ? isEarlyLeave
          ? 'EARLY_LEAVE'
          : record.status
        : record.status;

    return this.prisma.staffAttendance.update({
      where: { id: record.id },
      data: { logoutAt: now, status },
    });
  }

  /** 客服 / 店长考勤明细（按店过滤；老板不传 studioId = 看全部）。 */
  async getStaffAttendance(filters: {
    studioId?: string | null;
    userId?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const where: any = {};
    if (filters.userId) where.userId = filters.userId;
    // StaffAttendance 上没有 User 关系字段（只有 userId），按店过滤就先查这家店的人。
    if (filters.studioId) {
      const usersInStudio = await this.prisma.user.findMany({
        where: { studioId: filters.studioId },
        select: { id: true },
      });
      where.userId = { in: usersInStudio.map((u) => u.id) };
    }
    if (filters.dateFrom || filters.dateTo) {
      where.date = {};
      if (filters.dateFrom) where.date.gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        const end = new Date(filters.dateTo);
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }
    const rows = await this.prisma.staffAttendance.findMany({
      where,
      orderBy: [{ date: 'desc' }, { loginAt: 'desc' }],
    });
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, username: true, displayName: true, role: true, studioId: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({ ...r, user: userById.get(r.userId) ?? null }));
  }

  /** 陪玩属于哪家店（考勤时间按店解析）。 */
  private async studioIdOf(companionId: string): Promise<string | null> {
    const row = await this.prisma.companion
      .findUnique({ where: { id: companionId }, select: { studioId: true } })
      .catch(() => null);
    return row?.studioId ?? null;
  }

  /** 客服 / 店长属于哪家店（考勤时间按店解析）。 */
  private async studioIdOfUser(userId: string): Promise<string | null> {
    const row = await this.prisma.user
      .findUnique({ where: { id: userId }, select: { studioId: true } })
      .catch(() => null);
    return row?.studioId ?? null;
  }

  async getAttendance(filters: { companionId?: string; dateFrom?: string; dateTo?: string }) {
    const where: any = {};
    if (filters.companionId) where.companionId = filters.companionId;
    if (filters.dateFrom || filters.dateTo) {
      where.date = {};
      if (filters.dateFrom) where.date.gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        const end = new Date(filters.dateTo);
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
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
