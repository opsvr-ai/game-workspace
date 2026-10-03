// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CompanionAttendanceService } from "../companions/companion-attendance.service";

/**
 * 今日考勤汇总（老板 2026-10-04）。
 *
 * 老板原话：「哪个陪玩什么状态……谁迟到了 谁早退了 …… 我想看的数据全部放首页我去看多好」。
 * 运营看板首页那一块「今日考勤」就是这份数据，这个文件锁住：
 *   1. 三个职位分开算，各用各的上下班时间；
 *   2. 迟到 / 早退 / 未打卡 / 正常 分类正确，有问题的排前面；
 *   3. 还没到上班时间的人不算「未打卡」（免得早上 8 点打开首页一片红）；
 *   4. 考勤关掉的职位整块不出现。
 */

function setup(
  overrides: Record<string, any> = {},
  data: Record<string, any> = {},
  opts: { seedEnabled?: boolean } = {},
) {
  const seed =
    opts.seedEnabled === false
      ? {}
      : {
          "attendance.companion.enabled": true,
          "attendance.cs.enabled": true,
          "attendance.manager.enabled": true,
        };
  const cfg: Record<string, any> = { ...seed, ...overrides };
  const prisma = {
    systemConfig: {
      findMany: vi.fn(async ({ where }: any) =>
        (where.key.in as string[])
          .filter((k) => k in cfg)
          .map((k) => ({ key: k, value: cfg[k] })),
      ),
    },
    studioConfig: { findMany: vi.fn(async () => []) },
    companion: {
      findUnique: vi.fn(async () => ({ studioId: "s1" })),
      findMany: vi.fn(async () => data.companions ?? []),
    },
    companionAttendance: {
      findUnique: vi.fn(async () => data.myRow ?? null),
      findMany: vi.fn(async () => data.companionRows ?? []),
    },
    user: {
      findUnique: vi.fn(async () => ({ studioId: "s1" })),
      findMany: vi.fn(async ({ where }: any) =>
        (data.staffUsers ?? []).filter((u: any) => !where?.role || u.role === where.role)),
    },
    staffAttendance: {
      findMany: vi.fn(async () => data.staffRows ?? []),
    },
  };
  return { svc: new CompanionAttendanceService(prisma as never), prisma };
}

const at = (local: string) => vi.setSystemTime(new Date(local));
const day = new Date("2026-10-04T00:00:00");

describe("今日考勤汇总：分类与排序", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("陪玩：迟到 / 早退 / 未打卡 / 正常 分类正确，有问题的排前面", async () => {
    at("2026-10-04T10:30:00");
    const { svc } = setup(
      { "attendance.workStart": "09:00", "attendance.workEnd": "18:00" },
      {
        companions: [
          { id: "c1", status: "AVAILABLE", user: { username: "张三", displayName: "张三" } },
          { id: "c2", status: "AVAILABLE", user: { username: "李四", displayName: "李四" } },
          { id: "c3", status: "OFFLINE", user: { username: "王五", displayName: "王五" } },
          { id: "c4", status: "AVAILABLE", user: { username: "赵六", displayName: "赵六" } },
        ],
        companionRows: [
          { companionId: "c1", date: day, loginAt: new Date("2026-10-04T09:40:00"), logoutAt: null, workMinutes: 0, isLate: true, isEarlyLeave: false },
          { companionId: "c2", date: day, loginAt: new Date("2026-10-04T08:50:00"), logoutAt: new Date("2026-10-04T17:00:00"), workMinutes: 490, isLate: false, isEarlyLeave: true },
          { companionId: "c4", date: day, loginAt: new Date("2026-10-04T08:50:00"), logoutAt: null, workMinutes: 0, isLate: false, isEarlyLeave: false },
        ],
      },
    );
    const res: any = await svc.summarizeToday("s1");
    const rows = res.roles.COMPANION.rows;
    expect(res.roles.COMPANION.counts).toMatchObject({ total: 4, late: 1, earlyLeave: 1, absent: 1, present: 3 });
    expect(rows[0]).toMatchObject({ name: "张三", status: "LATE", onDuty: true });
    expect(rows[1]).toMatchObject({ name: "李四", status: "EARLY_LEAVE", onDuty: false });
    expect(rows[2]).toMatchObject({ name: "王五", status: "ABSENT" });
    expect(rows[3]).toMatchObject({ name: "赵六", status: "PRESENT", onDuty: true });
  });

  it("还没到上班时间的人算「未到点」，不算未打卡", async () => {
    at("2026-10-04T08:10:00");
    const { svc } = setup(
      { "attendance.workStart": "09:00" },
      { companions: [{ id: "c1", status: "OFFLINE", user: { username: "张三" } }] },
    );
    const res: any = await svc.summarizeToday("s1");
    expect(res.roles.COMPANION.rows[0].status).toBe("NOT_STARTED");
    expect(res.roles.COMPANION.counts.absent).toBe(0);
    expect(res.roles.COMPANION.counts.notStarted).toBe(1);
  });

  it("客服 / 店长各用各的上下班时间，老板不出现", async () => {
    at("2026-10-04T10:30:00");
    const { svc } = setup(
      { "attendance.cs.workStart": "09:00", "attendance.manager.workStart": "12:00" },
      {
        staffUsers: [
          { id: "u1", username: "孙可馨", displayName: "孙可馨", role: "CS" },
          { id: "u2", username: "店长甲", displayName: "店长甲", role: "ADMIN" },
        ],
        staffRows: [
          { userId: "u1", date: day, status: "LATE", loginAt: new Date("2026-10-04T09:30:00"), logoutAt: null },
        ],
      },
    );
    const res: any = await svc.summarizeToday("s1");
    expect(res.roles.CS.rows[0]).toMatchObject({ name: "孙可馨", status: "LATE" });
    expect(res.roles.CS.workStart).toBe("09:00");
    // 店长 12:00 上班，10:30 还没到点，不算未打卡
    expect(res.roles.ADMIN.rows[0]).toMatchObject({ name: "店长甲", status: "NOT_STARTED" });
    expect(res.roles.ADMIN.counts.absent).toBe(0);
    expect(res.roles.OWNER).toBeUndefined();
  });

  it("陪玩考勤没配过时默认不开（老板 2026-10-04：陪玩没必要考勤）→ 汇总里没有陪玩那一块", async () => {
    at("2026-10-04T10:30:00");
    const { svc } = setup(
      { "attendance.cs.workStart": "09:00", "attendance.manager.workStart": "09:00" },
      { companions: [{ id: "c1", status: "AVAILABLE", user: { username: "张三" } }] },
      { seedEnabled: false },
    );
    const res: any = await svc.summarizeToday(null);
    expect(res.roles.COMPANION).toBeUndefined();
  });

  it("考勤关掉的职位整块不出现", async () => {
    at("2026-10-04T10:30:00");
    const { svc } = setup(
      { "attendance.cs.enabled": false, "attendance.manager.enabled": false },
      { companions: [{ id: "c1", status: "AVAILABLE", user: { username: "张三" } }] },
    );
    const res: any = await svc.summarizeToday("s1");
    expect(Object.keys(res.roles)).toEqual(["COMPANION"]);
  });
});

describe("陪玩自己的今日考勤", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("返回自己的迟到状态和打卡时间", async () => {
    at("2026-10-04T10:30:00");
    const { svc } = setup(
      { "attendance.workStart": "09:00", "attendance.workEnd": "18:00" },
      { myRow: { loginAt: new Date("2026-10-04T09:40:00"), logoutAt: null, workMinutes: 0, isLate: true, isEarlyLeave: false } },
    );
    const res: any = await svc.myToday("c1");
    expect(res).toMatchObject({ status: "LATE", isLate: true, onDuty: true, workStart: "09:00" });
  });

  it("陪玩考勤没配过时默认不开 → myToday 返回 null（陪玩端整张卡不显示）", async () => {
    at("2026-10-04T10:30:00");
    const { svc } = setup({}, {}, { seedEnabled: false });
    expect(await svc.myToday("c1")).toBeNull();
  });

  it("考勤关掉时返回 null（陪玩端不显示这个徽章）", async () => {
    at("2026-10-04T10:30:00");
    const { svc } = setup({ "attendance.companion.enabled": false });
    expect(await svc.myToday("c1")).toBeNull();
  });
});
