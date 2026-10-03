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

/**
 * 各职位「没配过」时的默认值。
 *
 * 陪玩默认**关**（老板 2026-10-04：「陪玩是提成制、本来也不扣钱……陪玩没必要考勤，
 * 你要考勤这不是得给人家发底薪了么」）——不记考勤、不判迟到早退、陪玩端也不显示这张卡；
 * 哪个店想给陪玩开考勤，店长在「本店设置 → 考勤」里打开即可（存到本店配置，只影响自己这家店）。
 * 客服 / 店长默认**开**：这两个职位走工资考勤（迟到 / 早退 / 缺勤要扣款）。
 */
const ROLE_ENABLED_DEFAULT: Record<AttendanceRole, boolean> = {
  COMPANION: false,
  CS: true,
  ADMIN: true,
};

@Injectable()
export class CompanionAttendanceService {
  constructor(private prisma: PrismaService) {}

  /** 这个职位的考勤开没开（本店店长填的 → 老板全局默认；没配过看各职位默认值）。 */
  async isEnabled(role: AttendanceRole, studioId: string | null): Promise<boolean> {
    const key = ROLE_ENABLED_KEY[role];
    const scoped = await resolveConfigsRaw(this.prisma, studioId, [key]);
    const v = scoped[key];
    return v === undefined || v === null ? ROLE_ENABLED_DEFAULT[role] : Boolean(v);
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

    const { workStart, workEnd } = await this.timesOf(role as AttendanceRole, studioId);
    // 只在「本次班内」判早退：还没到上班时间（比如半夜客户端断一下）或已经过了下班时间，
    // 都不算早退，避免夜班 / 半夜断开被记成早退。
    const inShift = now >= this.atTime(today, workStart) && now < this.atTime(today, workEnd);
    const isEarlyLeave = inShift;
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

  // ───────────── 今日考勤汇总（老板 2026-10-04：运营看板要「谁迟到了、谁早退了」） ─────────────

  /** 本地日期键（YYYY-MM-DD），只用来给前端显示，不参与判断。 */
  private dayKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * 全店今日考勤：陪玩 / 客服 / 店长各一块。
   * - 只汇总「考勤开着」的职位（关掉的职位不出现，免得页面上多出一堆没意义的红字）；
   * - 没打卡的人：还没到上班时间显示「未到点」，过了上班时间才算「未打卡」；
   * - 有问题的（迟到 / 早退 / 未打卡）排前面，一眼看完。
   */
  async summarizeToday(studioId: string | null) {
    const today = this.startOfDay();
    const now = new Date();
    const roles: Record<string, any> = {};
    for (const role of ['COMPANION', 'CS', 'ADMIN'] as AttendanceRole[]) {
      if (await this.isEnabled(role, studioId)) {
        roles[role] = await this.summarizeRole(role, studioId, today, now);
      }
    }
    return { date: this.dayKey(today), now: now.toISOString(), roles };
  }

  /** 我（陪玩）今天的考勤 —— 陪玩端首页用，只返回自己这一条。 */
  async myToday(companionId: string) {
    const studioId = await this.studioIdOf(companionId);
    if (!(await this.isEnabled('COMPANION', studioId))) return null;
    const today = this.startOfDay();
    const now = new Date();
    const { workStart, workEnd } = await this.timesOf('COMPANION', studioId);
    const row = await this.prisma.companionAttendance.findUnique({
      where: { companionId_date: { companionId, date: today } },
    });
    return {
      date: this.dayKey(today),
      workStart,
      workEnd,
      onDuty: !!row && !row.logoutAt,
      loginAt: (row?.loginAt as Date | undefined) ?? null,
      logoutAt: (row?.logoutAt as Date | null | undefined) ?? null,
      workMinutes: (row?.workMinutes as number | undefined) ?? 0,
      isLate: !!row?.isLate,
      isEarlyLeave: !!row?.isEarlyLeave,
      status: !row
        ? now < this.atTime(today, workStart)
          ? 'NOT_STARTED'
          : 'ABSENT'
        : row.isLate && row.isEarlyLeave
          ? 'LATE_EARLY'
          : row.isLate
            ? 'LATE'
            : row.isEarlyLeave
              ? 'EARLY_LEAVE'
              : 'PRESENT',
    };
  }

  /** 一个职位的今日考勤行 + 计数。 */
  private async summarizeRole(role: AttendanceRole, studioId: string | null, today: Date, now: Date) {
    const { workStart, workEnd } = await this.timesOf(role, studioId);
    const rows: any[] = [];

    if (role === 'COMPANION') {
      const companions = await this.prisma.companion.findMany({
        where: { isResigned: false, ...(studioId ? { studioId } : {}) },
        select: { id: true, status: true, user: { select: { username: true, displayName: true } } },
      });
      const ids = companions.map((c) => c.id);
      const records = ids.length
        ? await this.prisma.companionAttendance.findMany({ where: { companionId: { in: ids }, date: today } })
        : [];
      const byId = new Map<string, any>(records.map((a) => [a.companionId, a] as [string, any]));
      for (const c of companions) {
        const a = byId.get(c.id);
        rows.push({
          id: c.id,
          name: c.user?.displayName || c.user?.username || '陪玩',
          role,
          online: c.status !== 'OFFLINE',
          onDuty: !!a && !a.logoutAt,
          loginAt: a?.loginAt ?? null,
          logoutAt: a?.logoutAt ?? null,
          workMinutes: a?.workMinutes ?? 0,
          status: a
            ? a.isLate && a.isEarlyLeave
              ? 'LATE_EARLY'
              : a.isLate
                ? 'LATE'
                : a.isEarlyLeave
                  ? 'EARLY_LEAVE'
                  : 'PRESENT'
            : now < this.atTime(today, workStart)
              ? 'NOT_STARTED'
              : 'ABSENT',
        });
      }
    } else {
      const users = await this.prisma.user.findMany({
        where: { role, resignedAt: null, ...(studioId ? { studioId } : {}) },
        select: { id: true, username: true, displayName: true },
      });
      const ids = users.map((u) => u.id);
      const records = ids.length
        ? await this.prisma.staffAttendance.findMany({ where: { userId: { in: ids }, date: today } })
        : [];
      const byId = new Map<string, any>(records.map((a) => [a.userId, a] as [string, any]));
      for (const u of users) {
        const a = byId.get(u.id);
        rows.push({
          id: u.id,
          name: u.displayName || u.username || '员工',
          role,
          online: !!a && !a.logoutAt,
          onDuty: !!a && !a.logoutAt,
          loginAt: a?.loginAt ?? null,
          logoutAt: a?.logoutAt ?? null,
          workMinutes: 0,
          status: a
            ? String(a.status || 'PRESENT')
            : now < this.atTime(today, workStart)
              ? 'NOT_STARTED'
              : 'ABSENT',
        });
      }
    }

    const counts = {
      total: rows.length,
      late: rows.filter((r) => r.status === 'LATE' || r.status === 'LATE_EARLY').length,
      earlyLeave: rows.filter((r) => r.status === 'EARLY_LEAVE' || r.status === 'LATE_EARLY').length,
      absent: rows.filter((r) => r.status === 'ABSENT').length,
      notStarted: rows.filter((r) => r.status === 'NOT_STARTED').length,
      present: rows.filter((r) => ['PRESENT', 'LATE', 'EARLY_LEAVE', 'LATE_EARLY'].includes(r.status)).length,
    };
    const rank: Record<string, number> = { LATE_EARLY: 0, LATE: 1, EARLY_LEAVE: 2, ABSENT: 3, PRESENT: 4, NOT_STARTED: 5 };
    rows.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || String(a.name).localeCompare(String(b.name)));

    return { enabled: true, workStart, workEnd, rows, counts };
  }
}
