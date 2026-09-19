import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WsGateway } from "../ws/ws.gateway";

function setup(opts: { bridgedIds?: string[]; idle?: string[] } = {}) {
  const prisma = {
    order: { findUnique: vi.fn() },
    companion: { findMany: vi.fn().mockResolvedValue((opts.idle ?? ["c1", "c2"]).map((id) => ({ id }))) },
  };
  const bridgeService = {
    getBridgedStudioIds: vi.fn().mockResolvedValue(opts.bridgedIds ?? ["bridge-1"]),
  };
  const emitted: Array<{ room: string; event: string; data: unknown }> = [];
  const server = {
    to: (room: string) => ({ emit: (event: string, data: unknown) => emitted.push({ room, event, data }) }),
  };
  const gw = new WsGateway(
    null as never,
    prisma as never,
    bridgeService as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  // `server` 平时由 Nest 注入，这里手动挂上即可
  (gw as unknown as { server: unknown }).server = server;
  return { gw, prisma, bridgeService, emitted };
}

const PENDING = { status: "PENDING", companionId: null, claimedCsUserId: null };

describe("WsGateway.broadcastUrgentToBridgedStudios", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("等「桥接工作室等待」时间到，才推给桥接工作室的空闲陪玩", async () => {
    const { gw, prisma, emitted } = setup();
    prisma.order.findUnique.mockResolvedValue(PENDING);

    const p = gw.broadcastUrgentToBridgedStudios("studio-1", "order-1", { _bridged: true }, 300000);
    await vi.advanceTimersByTimeAsync(299999);
    expect(emitted).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe(2);
    expect(emitted.map((e) => e.room)).toEqual(["companion:c1", "companion:c2"]);
    expect(emitted.every((e) => e.event === "order:urgent")).toBe(true);
  });

  it("订单已被抢走，就不弹已经失效的单", async () => {
    const { gw, prisma, emitted } = setup();
    prisma.order.findUnique.mockResolvedValue({ ...PENDING, companionId: "c9" });

    const p = gw.broadcastUrgentToBridgedStudios("studio-1", "order-1", {}, 0);
    await expect(p).resolves.toBe(0);
    expect(emitted).toHaveLength(0);
  });

  it("订单已被客服认领或已不在待处理状态，也不弹", async () => {
    const claimed = setup();
    claimed.prisma.order.findUnique.mockResolvedValue({ ...PENDING, claimedCsUserId: "u1" });
    await expect(claimed.gw.broadcastUrgentToBridgedStudios("studio-1", "order-1", {}, 0)).resolves.toBe(0);
    expect(claimed.emitted).toHaveLength(0);

    const grabbed = setup();
    grabbed.prisma.order.findUnique.mockResolvedValue({ ...PENDING, status: "GRABBED" });
    await expect(grabbed.gw.broadcastUrgentToBridgedStudios("studio-1", "order-1", {}, 0)).resolves.toBe(0);
    expect(grabbed.emitted).toHaveLength(0);
  });

  it("没有桥接工作室时静默返回 0", async () => {
    const { gw, prisma, emitted } = setup({ bridgedIds: [] });
    prisma.order.findUnique.mockResolvedValue(PENDING);
    await expect(gw.broadcastUrgentToBridgedStudios("studio-1", "order-1", {}, 0)).resolves.toBe(0);
    expect(emitted).toHaveLength(0);
  });
});
