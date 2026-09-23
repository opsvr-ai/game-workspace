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
 *  2) 开关关着时不下发名单，客户端手里名单为空自然杀不到东西。
 *
 * 2026-09-24 老板拍板：**不要全站总闸**，只留店长自己的「本店黑名单是否生效」
 * （`blacklist.enabled`）。以前那道 `blacklist.auto_kill` 已经整条去掉，所以下面锁住的是：
 * 本店开关拨开才下发真名单；**没拨过 / 关掉都下发空名单**（默认关 = 线上现状：只记录不杀）；
 * 各店开关互不影响。顺带说明：如果哪天又冒出一道「全局闸」，这几个用例会直接变红。
 */
function setup(
  opts: {
    studioBlacklist?: Array<{ processName: string }>;
    /** 哪几家店把「本店黑名单是否生效」拨开了（模拟 StudioConfig 里的本店值）。 */
    studioEnabled?: string[];
    /** 哪几家店显式拨成「不生效」。 */
    studioDisabled?: string[];
  } = {},
) {
  const enabled = new Set(opts.studioEnabled ?? []);
  const disabled = new Set(opts.studioDisabled ?? []);
  const prisma = {
    companion: { findUnique: vi.fn().mockResolvedValue({ status: "AVAILABLE", studioId: "studio-1" }) },
    companionStatusBlacklist: {
      findMany: vi.fn().mockResolvedValue(opts.studioBlacklist ?? [{ processName: "DeltaForceClient-Win64-Shipping" }]),
    },
    processWhitelist: { findMany: vi.fn().mockResolvedValue([{ processName: "explorer.exe" }]) },
    // 全站那一份配置里不该再有杀进程开关了：下面统一返回空，模拟「查不到」。
    systemConfig: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    studioConfig: {
      findMany: vi.fn((args: any) => {
        const studioId = args?.where?.studioId;
        if (enabled.has(studioId)) return Promise.resolve([{ key: "blacklist.enabled", value: true }]);
        if (disabled.has(studioId)) return Promise.resolve([{ key: "blacklist.enabled", value: false }]);
        return Promise.resolve([]);
      }),
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
    const { gw, emitted } = setup({ studioEnabled: ["studio-1"] });

    await gw.pushCurrentBlacklist("companion-1", "studio-1");

    expect(emitted).toHaveLength(1);
    expect(emitted[0].room).toBe("companion:companion-1");
    expect(emitted[0].data.status).toBeUndefined();
    expect(emitted[0].data.authoritative).toBe(false);
  });

  it("陪玩本人切状态（权威）时才把状态下发，客户端才会照着杀", async () => {
    const { gw, emitted } = setup({ studioEnabled: ["studio-1"] });

    await gw.pushCurrentBlacklist("companion-1", "studio-1", true);

    expect(emitted[0].data.status).toBe("AVAILABLE");
    expect(emitted[0].data.authoritative).toBe(true);
  });

  it("本店开关没拨过（默认关）：即使陪玩是空闲，也只下发空名单", async () => {
    const { gw, emitted } = setup();

    await gw.pushCurrentBlacklist("companion-1", "studio-1", true);

    expect(emitted[0].data.blacklist).toEqual([]);
    expect(emitted[0].data.whitelist.length).toBeGreaterThan(0);
  });

  it("本店开关显式拨成「不生效」：同样只下发空名单（一键止血）", async () => {
    const { gw, emitted } = setup({ studioDisabled: ["studio-1"] });

    await gw.pushCurrentBlacklist("companion-1", "studio-1", true);

    expect(emitted[0].data.blacklist).toEqual([]);
  });

  it("本店开关拨开后才下发真实名单（唯一的一道闸）", async () => {
    const { gw, emitted } = setup({ studioEnabled: ["studio-1"] });

    await gw.pushCurrentBlacklist("companion-1", "studio-1", true);

    expect(emitted[0].data.blacklist.map((b: any) => b.processName)).toEqual([
      "DeltaForceClient-Win64-Shipping",
    ]);
  });

  it("直接推名单时也受本店开关约束：开着才发真名单", async () => {
    const { gw, emitted } = setup({ studioEnabled: ["studio-1"] });

    await gw.sendBlacklistUpdate(
      "companion-1",
      [{ processName: "DeltaForceClient-Win64-Shipping", processPath: null }],
      [],
      1,
      "AVAILABLE",
      true,
      "studio-1",
    );

    expect(emitted[0].data.blacklist.map((b: any) => b.processName)).toEqual(["DeltaForceClient-Win64-Shipping"]);
  });

  it("分不出是哪家店时不发真名单（说不清就绝不动手）", async () => {
    const { gw, emitted } = setup({ studioEnabled: ["studio-1"] });

    await gw.sendBlacklistUpdate(
      "companion-1",
      [{ processName: "DeltaForceClient-Win64-Shipping", processPath: null }],
      [],
      1,
      "AVAILABLE",
      true,
      undefined,
    );

    expect(emitted[0].data.blacklist).toEqual([]);
  });

  it("各店开关互不影响：A 店拨开不会连累 B 店（B 没拨过 = 不生效）", async () => {
    const { gw, emitted } = setup({ studioEnabled: ["studio-a"] });

    await gw.pushCurrentBlacklist("companion-a", "studio-a", true);
    await gw.pushCurrentBlacklist("companion-b", "studio-b", true);

    expect(emitted[0].data.blacklist).toHaveLength(1);
    expect(emitted[1].data.blacklist).toEqual([]);
  });

  it("5 秒内重复推送只查一次配置，避免工作室广播把库打满", async () => {
    const { gw, prisma } = setup({ studioEnabled: ["studio-1"] });

    await gw.isStudioBlacklistEnabled("studio-1");
    await gw.isStudioBlacklistEnabled("studio-1");
    await gw.isStudioBlacklistEnabled("studio-1");

    expect(prisma.studioConfig.findMany).toHaveBeenCalledTimes(1);
  });
});
