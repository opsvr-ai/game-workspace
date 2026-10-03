// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CompanionAttendanceService } from "../companions/companion-attendance.service";

/**
 * 考勤口径回归（老板 2026-10-04）。
 *
 * 老板原话：「再加一个客服、店长考勤时间，而且给每个加上一个开关，我有的职位暂时不需要开考勤」。
 * 这个文件锁住三件事：
 *   1. 三个职位各自一个开关，关掉 = 不记考勤（陪玩不再自动打卡，客服/店长不参与工资扣款）；
 *   2. 客服 / 店长按各自的上/下班时间自动判迟到、早退；
 *   3. 管理端手动登记的一律优先，自动打卡绝不复写。
 */

function setup(
  overrides: Record<string, any> = {},
  data: Record<string, any> = {},
  opts: { seedEnabled?: boolean } = {},
) {
  // 默认把三个开关都显式配上（这些用例考的是「开了之后怎么算」）；
  // 想测「没配过时的默认值」就传 { seedEnabled: false }。
  const seed =
    opts.seedEnabled === false
      ? {}
      : {
          "attendance.companion.enabled": true,
          "attendance.cs.enabled": true,
          "attendance.manager.enabled": true,
        };
  const cfg: Record<string, any> = { ...seed, ...overrides };
  const created: any[] = [];
  const prisma = {
    systemConfig: {
      findMany: vi.fn(async ({ where }: any) =>
        (where.key.in as string[])
          .filter((k) => k in cfg)
          .map((k) => ({ key: k, value: cfg[k] })),
      ),
    },
    studioConfig: { findMany: vi.fn(async () => []) },
    companion: { findUnique: vi.fn(async () => ({ studioId: "s1" })) },
    companionAttendance: {
      findUnique: vi.fn(async () => data.companionExisting ?? null),
      create: vi.fn(async ({ data: d }: any) => {
        created.push(d);
        return { id: "ca1", workMinutes: 0, ...d };
      }),
      update: vi.fn(async ({ data: d }: any) => ({ id: "ca1", ...d })),
    },
    user: {
      findUnique: vi.fn(async () => ({ studioId: "s1" })),
      findMany: vi.fn(async () => data.users ?? []),
    },
    staffAttendance: {
      findUnique: vi.fn(async () => data.staffExisting ?? null),
      create: vi.fn(async ({ data: d }: any) => {
        created.push(d);
        return { id: "sa1", ...d };
      }),
      update: vi.fn(async ({ data: d }: any) => ({ id: "sa1", ...d })),
      findMany: vi.fn(async ({ where }: any) => {
        data.lastWhere = where;
        return data.staffRows ?? [];
      }),
    },
  };
  return { svc: new CompanionAttendanceService(prisma as never), prisma, created };
}

const at = (local: string) => vi.setSystemTime(new Date(local));

describe("考勤：三个职位各自一个开关", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("陪玩默认**不开**（老板 2026-10-04：提成制、没底薪）→ 一条都不记", async () => {
    at("2026-10-04T10:30:00");
    const { svc, created } = setup(
      { "attendance.workStart": "09:00", "attendance.workEnd": "18:00" },
      {},
      { seedEnabled: false },
    );
    expect(await svc.ensureAttendance("c1")).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("店长把陪玩考勤打开后：客户端上线就打卡，晚于上班时间记迟到", async () => {
    at("2026-10-04T10:30:00");
    const { svc, created } = setup({ "attendance.workStart": "09:00", "attendance.workEnd": "18:00" });
    const row: any = await svc.ensureAttendance("c1");
    expect(created).toHaveLength(1);
    expect(created[0].isLate).toBe(true);
    expect(row.isLate).toBe(true);
  });

  it("陪玩上班时间前打卡不算迟到", async () => {
    at("2026-10-04T08:30:00");
    const { svc, created } = setup({ "attendance.workStart": "09:00" });
    await svc.ensureAttendance("c1");
    expect(created[0].isLate).toBe(false);
  });

  it("陪玩开关关掉 → 一条都不记", async () => {
    at("2026-10-04T10:30:00");
    const { svc, created } = setup({ "attendance.companion.enabled": false });
    expect(await svc.ensureAttendance("c1")).toBeNull();
    expect(await svc.finalizeAttendance("c1")).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("客服开关关掉 → 不记考勤", async () => {
    at("2026-10-04T10:30:00");
    const { svc, created } = setup({ "attendance.cs.enabled": false });
    expect(await svc.ensureStaffAttendance("u1", "CS")).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("客服默认开着：按客服自己的上班时间判迟到", async () => {
    at("2026-10-04T10:30:00");
    const late = setup({ "attendance.cs.workStart": "09:00" });
    await late.svc.ensureStaffAttendance("u1", "CS");
    expect(late.created[0].status).toBe("LATE");
    expect(late.created[0].loginAt).toBeInstanceOf(Date);

    const onTime = setup({ "attendance.cs.workStart": "11:00" });
    await onTime.svc.ensureStaffAttendance("u1", "CS");
    expect(onTime.created[0].status).toBe("PRESENT");
  });

  it("店长的上下班时间跟客服分开", async () => {
    at("2026-10-04T10:30:00");
    // 客服线 09:00（迟到），店长线 12:00（正常）——两套配置互不影响
    const { svc, created } = setup({
      "attendance.cs.workStart": "09:00",
      "attendance.manager.workStart": "12:00",
    });
    await svc.ensureStaffAttendance("u1", "CS");
    await svc.ensureStaffAttendance("u2", "ADMIN");
    expect(created[0].status).toBe("LATE");
    expect(created[1].status).toBe("PRESENT");
  });

  it("老板不考勤（不写记录）", async () => {
    at("2026-10-04T10:30:00");
    const { svc, created } = setup();
    expect(await svc.ensureStaffAttendance("u-owner", "OWNER")).toBeNull();
    expect(created).toHaveLength(0);
  });
});

describe("考勤：手动登记优先，自动打卡不覆盖", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("当天已经登记过（比如缺勤）→ 自动上班卡不写", async () => {
    at("2026-10-04T10:30:00");
    const existing = { id: "sa1", userId: "u1", status: "ABSENT" };
    const { svc, created } = setup({}, { staffExisting: existing });
    const row: any = await svc.ensureStaffAttendance("u1", "CS");
    expect(row).toBe(existing);
    expect(created).toHaveLength(0);
  });

  it("下班卡：早于下班时间走记早退", async () => {
    at("2026-10-04T17:00:00");
    const { svc, prisma } = setup(
      { "attendance.cs.workEnd": "18:00" },
      { staffExisting: { id: "sa1", status: "PRESENT" } },
    );
    const row: any = await svc.finalizeStaffAttendance("u1", "CS");
    expect(row.status).toBe("EARLY_LEAVE");
    expect(row.logoutAt).toBeInstanceOf(Date);
    expect(prisma.staffAttendance.update).toHaveBeenCalledOnce();
  });

  it("下班卡：到点之后走不算早退", async () => {
    at("2026-10-04T19:00:00");
    const { svc } = setup(
      { "attendance.cs.workEnd": "18:00" },
      { staffExisting: { id: "sa1", status: "PRESENT" } },
    );
    const row: any = await svc.finalizeStaffAttendance("u1", "CS");
    expect(row.status).toBe("PRESENT");
  });

  it("半夜断开（还没到上班时间）不记早退", async () => {
    at("2026-10-04T03:15:00");
    const { svc } = setup(
      { "attendance.cs.workStart": "09:00", "attendance.cs.workEnd": "18:00" },
      { staffExisting: { id: "sa1", status: "PRESENT" } },
    );
    const row: any = await svc.finalizeStaffAttendance("u1", "CS");
    expect(row.status).toBe("PRESENT");
    expect(row.logoutAt).toBeInstanceOf(Date);
  });

  it("下班卡：手动登记的缺勤不被改成早退", async () => {
    at("2026-10-04T17:00:00");
    const { svc } = setup(
      { "attendance.cs.workEnd": "18:00" },
      { staffExisting: { id: "sa1", status: "ABSENT" } },
    );
    const row: any = await svc.finalizeStaffAttendance("u1", "CS");
    expect(row.status).toBe("ABSENT");
  });

  it("客服考勤关掉后，下班卡也不记", async () => {
    at("2026-10-04T17:00:00");
    const { svc } = setup(
      { "attendance.cs.enabled": false },
      { staffExisting: { id: "sa1", status: "PRESENT" } },
    );
    expect(await svc.finalizeStaffAttendance("u1", "CS")).toBeNull();
  });
});

describe("考勤：客服/店长明细", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("按店过滤时先查本店的人，并把 user 拼上", async () => {
    at("2026-10-04T10:30:00");
    const { svc, prisma } = setup({}, {
      users: [{ id: "u1", username: "孙可馨", role: "CS", studioId: "s1" }],
      staffRows: [{ id: "sa1", userId: "u1", date: new Date("2026-10-04"), status: "PRESENT" }],
    });
    const rows: any[] = await svc.getStaffAttendance({ studioId: "s1" });
    expect(prisma.user.findMany).toHaveBeenCalled();
    expect(rows[0].user.username).toBe("孙可馨");
  });

  it("日期区间按整段（含结束当天）过滤", async () => {
    at("2026-10-04T10:30:00");
    const { svc, prisma } = setup();
    await svc.getStaffAttendance({ dateFrom: "2026-10-01", dateTo: "2026-10-04" });
    const where = (prisma.staffAttendance.findMany as any).mock.calls[0][0].where;
    expect(where.date.gte.toISOString()).toBe(new Date("2026-10-01").toISOString());
    expect(where.date.lte.getHours()).toBe(23);
  });
});
