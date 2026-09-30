import { describe, it, expect, vi } from "vitest";
import { WsGateway } from "../ws/ws.gateway";

/**
 * 老板 2026-10-01 口径：**空闲 / 挂机（休息）一律弹**；
 * **娱乐中、接单中可以自己关**（娱乐中默认弹 `notifyWhileEntertainment`，
 * 接单中默认不打扰 `notifyWhileBusy`）。
 * 这个测试把收件人条件钉死，避免以后又被改回去。
 */
function setup(matched: Array<{ id: string; status: string; user?: { username: string } }> = []) {
  const prisma = { companion: { findMany: vi.fn().mockResolvedValue(matched) } };
  const emitted: Array<{ room: string; event: string; data: unknown }> = [];
  const server = {
    to: (room: string) => ({ emit: (event: string, data: unknown) => emitted.push({ room, event, data }) }),
  };
  const gw = new WsGateway(
    null as never,
    prisma as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  (gw as unknown as { server: unknown }).server = server;
  return { gw, prisma, emitted };
}

describe("WsGateway.broadcastNewOrder 收件人规则", () => {
  it("查的是「本店 + (空闲 或 挂机 或 娱乐中且本人未关 或 接单中且本人开了开关)」", async () => {
    const { gw, prisma } = setup([]);
    await gw.broadcastNewOrder("studio-1", { orderCode: "X1" });

    const where = prisma.companion.findMany.mock.calls[0][0].where;
    expect(where.studioId).toBe("studio-1");
    expect(where.OR).toEqual([
      { status: "AVAILABLE" },
      { status: "RESTING" },
      { status: "ENTERTAINMENT", notifyWhileEntertainment: true },
      { status: "BUSY", notifyWhileBusy: true },
    ]);
  });

  it("空闲、挂机、娱乐中、开了开关的接单中，都能收到 order:urgent", async () => {
    const { gw, emitted } = setup([
      { id: "c-idle", status: "AVAILABLE", user: { username: "空闲的人" } },
      { id: "c-rest", status: "RESTING", user: { username: "挂机的人" } },
      { id: "c-fun", status: "ENTERTAINMENT", user: { username: "娱乐中的人" } },
      { id: "c-busy", status: "BUSY", user: { username: "打单中但开了开关的人" } },
    ]);

    await expect(gw.broadcastNewOrder("studio-1", { orderCode: "X2" })).resolves.toBe(4);
    expect(emitted.map((e) => e.room)).toEqual([
      "companion:c-idle",
      "companion:c-rest",
      "companion:c-fun",
      "companion:c-busy",
    ]);
    expect(emitted.every((e) => e.event === "order:urgent")).toBe(true);
  });

  it("一个人都没命中时返回 0，不推任何弹窗", async () => {
    const { gw, emitted } = setup([]);
    await expect(gw.broadcastNewOrder("studio-1", {})).resolves.toBe(0);
    expect(emitted).toHaveLength(0);
  });
});
