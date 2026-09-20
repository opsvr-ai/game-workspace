// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WsGateway } from "../ws/ws.gateway";

/**
 * 2026-09-21 老板报「软件动不动就掉线」的回归测试。
 *
 * 掉线感的来源：客户端刷新页面、网络抖一下、服务端发版重启，连接都会断几秒；
 * 以前服务端一断就立刻把人置成 OFFLINE 并广播给所有控制台，看起来就是「又掉线了」。
 * 现在改成宽限期内连回来就当没掉过，超时才真置离线。
 */
function setup(opts: { inService?: boolean; graceSeconds?: number } = {}) {
  const prisma = {
    systemConfig: {
      findUnique: vi.fn().mockResolvedValue({
        key: "ws.offline_grace_seconds",
        value: opts.graceSeconds ?? 60,
      }),
    },
    companion: { update: vi.fn().mockResolvedValue({}) },
  };
  const companions = {
    hasActiveServiceSession: vi.fn().mockResolvedValue(!!opts.inService),
    finalizeAttendance: vi.fn().mockResolvedValue(undefined),
  };
  const emitted: Array<{ room: string; event: string }> = [];
  const server = {
    to: (room: string) => ({ emit: (event: string) => emitted.push({ room, event }) }),
  };
  const bridgeService = { getBridgedStudioIds: vi.fn().mockResolvedValue([]) };
  const gw = new WsGateway(
    null as never,
    prisma as never,
    bridgeService as never,
    companions as never,
    null as never,
    null as never,
    null as never,
  );
  (gw as unknown as { server: unknown }).server = server;
  return { gw, prisma, companions, emitted, bridgeService };
}

const client = {
  id: "sock-1",
  handshake: { address: "::1" },
  data: { user: { id: "u1", username: "c1", role: "COMPANION", studioId: undefined, companionId: "c1" } },
};
const asPrivate = (gw: WsGateway) => gw as unknown as {
  companionSockets: Map<string, Set<string>>;
  cancelPendingOfflineTransition: (companionId: string) => boolean;
  scheduleOfflineTransition: (companionId: string, studioId?: string) => Promise<void>;
};

describe("置离线宽限期：秒级闪断不算掉线", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("断开后不立刻置离线，宽限期到了才置离线", async () => {
    const { gw, prisma, companions } = setup();
    asPrivate(gw).companionSockets.set("c1", new Set(["sock-1"]));

    await gw.handleDisconnect(client as never);
    expect(prisma.companion.update).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(59_000);
    expect(prisma.companion.update).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_500);
    expect(prisma.companion.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "OFFLINE" },
    });
    expect(companions.finalizeAttendance).toHaveBeenCalledWith("c1");
  });

  it("宽限期内连回来就不置离线", async () => {
    const { gw, prisma } = setup();
    asPrivate(gw).companionSockets.set("c1", new Set(["sock-1"]));

    await gw.handleDisconnect(client as never);
    expect(asPrivate(gw).cancelPendingOfflineTransition("c1")).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(prisma.companion.update).not.toHaveBeenCalled();
  });

  it("定时器已经跑过之后没人再连回来，撤定时器返回 false", async () => {
    const { gw } = setup();
    asPrivate(gw).companionSockets.set("c1", new Set(["sock-1"]));
    await gw.handleDisconnect(client as never);
    expect(asPrivate(gw).cancelPendingOfflineTransition("c1")).toBe(true);
    expect(asPrivate(gw).cancelPendingOfflineTransition("c1")).toBe(false);
  });

  it("有服务在身：宽限期满后标忙碌而不是离线", async () => {
    const { gw, prisma } = setup({ inService: true });
    asPrivate(gw).companionSockets.set("c1", new Set(["sock-1"]));

    await gw.handleDisconnect(client as never);
    await vi.advanceTimersByTimeAsync(61_000);

    expect(prisma.companion.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "BUSY" },
    });
  });

  it("宽限期配成 0 时保持老行为（立刻置离线）", async () => {
    const { gw, prisma } = setup({ graceSeconds: 0 });
    asPrivate(gw).companionSockets.set("c1", new Set(["sock-1"]));

    await gw.handleDisconnect(client as never);
    expect(prisma.companion.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "OFFLINE" },
    });
  });
});
