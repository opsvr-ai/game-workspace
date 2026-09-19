import { describe, it, expect, vi } from "vitest";
import { WsGateway } from "../ws/ws.gateway";

/**
 * 2026-09-20 事故回归测试。
 *
 * 事故经过：陪玩正在「娱乐中」打三角洲，客户端重连时服务端把状态猜成「空闲」，
 * 又把「空闲状态的进程黑名单」（三角洲）按权威状态推给客户端，客户端随即
 * 每 10 秒 taskkill 一次，游戏当场掉线。
 *
 * 这里锁住两条底线：
 *  1) 不是陪玩本人切的状态（连接补推）绝不带 status；
 *  2) 总开关关闭时不下发名单，客户端手里名单为空自然杀不到东西。
 */
function setup(opts: { studioBlacklist?: Array<{ processName: string }>; autoKill?: unknown } = {}) {
  const prisma = {
    companion: { findUnique: vi.fn().mockResolvedValue({ status: "AVAILABLE", studioId: "studio-1" }) },
    companionStatusBlacklist: {
      findMany: vi.fn().mockResolvedValue(opts.studioBlacklist ?? [{ processName: "DeltaForceClient-Win64-Shipping" }]),
    },
    processWhitelist: { findMany: vi.fn().mockResolvedValue([{ processName: "explorer.exe" }]) },
    systemConfig: {
      findUnique: vi.fn().mockResolvedValue(opts.autoKill === undefined ? null : { key: "blacklist.auto_kill", value: opts.autoKill }),
    },
  };
  const emitted: Array<{ room: string; event: string; data: any }> = [];
  const server = {
    to: (room: string) => ({ emit: (event: string, data: any) => emitted.push({ room, event, data }) }),
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

describe("黑名单下发：不能按猜出来的状态杀进程", () => {
  it("按连接补推（非权威）时不下发 status，客户端保留自己选的状态", async () => {
    const { gw, emitted } = setup();

    await gw.pushCurrentBlacklist("companion-1", "studio-1");

    expect(emitted).toHaveLength(1);
    expect(emitted[0].room).toBe("companion:companion-1");
    expect(emitted[0].data.status).toBeUndefined();
    expect(emitted[0].data.authoritative).toBe(false);
  });

  it("陪玩本人切状态（权威）时才把状态下发，客户端才会照着杀", async () => {
    const { gw, emitted } = setup();

    await gw.pushCurrentBlacklist("companion-1", "studio-1", true);

    expect(emitted[0].data.status).toBe("AVAILABLE");
    expect(emitted[0].data.authoritative).toBe(true);
  });

  it("总开关默认关闭：即使陪玩是空闲，也只下发空名单", async () => {
    const { gw, emitted } = setup();

    await gw.pushCurrentBlacklist("companion-1", "studio-1", true);

    expect(emitted[0].data.blacklist).toEqual([]);
    expect(emitted[0].data.whitelist.length).toBeGreaterThan(0);
  });

  it("显式打开开关后才下发真实名单", async () => {
    const { gw, emitted } = setup({ autoKill: true });

    await gw.sendBlacklistUpdate(
      "companion-1",
      [{ processName: "DeltaForceClient-Win64-Shipping", processPath: null }],
      [],
      1,
      "AVAILABLE",
      true,
    );

    expect(emitted[0].data.blacklist.map((b: any) => b.processName)).toEqual(["DeltaForceClient-Win64-Shipping"]);
  });

  it("5 秒内重复推送只查一次配置，避免工作室广播把库打满", async () => {
    const { gw, prisma } = setup({ autoKill: true });

    await gw.isAutoKillEnabled();
    await gw.isAutoKillEnabled();
    await gw.isAutoKillEnabled();

    expect(prisma.systemConfig.findUnique).toHaveBeenCalledTimes(1);
  });
});
