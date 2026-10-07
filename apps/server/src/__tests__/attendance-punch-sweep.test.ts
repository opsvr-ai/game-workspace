// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AttendancePunchSweepService } from "../companions/attendance-punch-sweep.service";
import { presence } from "../common/presence";

/**
 * 「到点补卡」巡检（老板 2026-10-07）。
 *
 * 上班卡改成「只在班次内算数」之后，凌晨就开机、一整天没断过的人不会再有连接事件，
 * 只能靠这个巡检在上班时间到了之后把卡补上；这个文件锁住两件事：
 *   1. 只给「连接还在」的人补（presence 里 sockets > 0）；
 *   2. 客服 / 店长走 punchInForStaffOnDuty，陪玩走 punchInForCompanionOnDuty。
 */
describe("到点补卡巡检", () => {
  beforeEach(() => presence.reset());
  afterEach(() => presence.reset());

  function setup() {
    const prisma = {
      user: { findMany: vi.fn(async () => [{ id: "u1", role: "CS" }]) },
      companion: { findMany: vi.fn(async () => [{ id: "c1" }]) },
    };
    const attendance = {
      punchInForStaffOnDuty: vi.fn(async () => true),
      punchInForCompanionOnDuty: vi.fn(async () => true),
    };
    return { svc: new AttendancePunchSweepService(prisma as never, attendance as never), prisma, attendance };
  }

  it("没人在线 → 一次数据库查询都不发", async () => {
    const { svc, prisma, attendance } = setup();
    await svc.tick();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(attendance.punchInForStaffOnDuty).not.toHaveBeenCalled();
  });

  it("在线的人：客服 / 店长补上班卡，陪玩也补", async () => {
    presence.addSocket("u1");
    const { svc, prisma, attendance } = setup();
    await svc.tick();
    expect(prisma.user.findMany).toHaveBeenCalledOnce();
    expect(attendance.punchInForStaffOnDuty).toHaveBeenCalledWith("u1", "CS");
    expect(attendance.punchInForCompanionOnDuty).toHaveBeenCalledWith("c1");
  });

  it("连接已经断开（sockets = 0）的人不补卡", async () => {
    presence.addSocket("u1");
    presence.removeSocket("u1");
    const { svc, attendance } = setup();
    await svc.tick();
    expect(attendance.punchInForStaffOnDuty).not.toHaveBeenCalled();
  });

  it("补卡抛错不影响其他人（一条坏数据不能拖垮整轮）", async () => {
    presence.addSocket("u1");
    const { svc, attendance } = setup();
    attendance.punchInForStaffOnDuty.mockRejectedValueOnce(new Error("boom"));
    await expect(svc.tick()).resolves.toBeUndefined();
    expect(attendance.punchInForCompanionOnDuty).toHaveBeenCalled();
  });
});
