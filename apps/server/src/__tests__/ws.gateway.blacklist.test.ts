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
 *
 * 2026-09-23 又加了**本店开关**（`blacklist.enabled`，店长自己拨）：两道闸都开才下发真名单。
 * 下面一并锁住：本店关掉就不下发、本店没拨过跟随全站总开关、各店开关互不影响。
 */
function setup(
  opts: {
    studioBlacklist?: Array<{ processName: string }>;
    autoKill?: unknown;
    /** 哪几家店把「黑名单是否生效」关掉了（模拟 StudioConfig 里的本店覆盖）。 */
    studioDisabled?: string[];
  } = {},
) {
  const prisma = {
    companion: { findUnique: vi.fn().mockResolvedValue({ status: "AVAILABLE", studioId: "studio-1" }) },
    companionStatusBlacklist: {
      findMany: vi.fn().mockResolvedValue(opts.studioBlacklist ?? [{ processName: "DeltaForceClient-Win64-Shipping" }]),
    },
    processWhitelist: { findMany: vi.fn().mockResolvedValue([{ processName: "explorer.exe" }]) },
    systemConfig: {
      findUnique: vi.fn().mockResolvedValue(opts.autoKill === undefined ? null : { key: "blacklist.auto_kill", value: opts.autoKill }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    studioConfig: {
      findMany: vi.fn((args: any) =>
        Promise.resolve(
          (opts.studioDisabled ?? []).includes(args?.where?.studioId)
            ? [{ key: "blacklist.enabled", value: false }]
            : [],
        ),
      ),
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

  it("本店开关没拨过：跟随全站总开关，行为与以前一致", async () => {
    const { gw, emitted } = setup({ autoKill: true });

    await gw.pushCurrentBlacklist("companion-1", "studio-1", true);

    expect(emitted[0].data.blacklist.map((b: any) => b.processName)).toEqual([
      "DeltaForceClient-Win64-Shipping",
    ]);
  });

  it("本店开关关掉：全站总开关开着也只下发空名单（本店一键止血）", async () => {
    const { gw, emitted } = setup({ autoKill: true, studioDisabled: ["studio-1"] });

    await gw.pushCurrentBlacklist("companion-1", "studio-1", true);

    expect(emitted[0].data.blacklist).toEqual([]);
  });

  it("各店开关互不影响：A 店关掉不会连累 B 店", async () => {
    const { gw, emitted } = setup({ autoKill: true, studioDisabled: ["studio-a"] });

    await gw.pushCurrentBlacklist("companion-a", "studio-a", true);
    await gw.pushCurrentBlacklist("companion-b", "studio-b", true);

    expect(emitted[0].data.blacklist).toEqual([]);
    expect(emitted[1].data.blacklist).toHaveLength(1);
  });

  it("5 秒内重复推送只查一次配置，避免工作室广播把库打满", async () => {
    const { gw, prisma } = setup({ autoKill: true });

    await gw.isAutoKillEnabled();
    await gw.isAutoKillEnabled();
    await gw.isAutoKillEnabled();

    expect(prisma.systemConfig.findUnique).toHaveBeenCalledTimes(1);
  });
});
