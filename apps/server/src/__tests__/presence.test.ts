// craftsman-ignore: TS001,TS003
import { describe, it, expect, beforeEach } from "vitest";
import { presence } from "../common/presence";

/**
 * 老板 2026-09-21 报「hanlei1 又掉线了」的回归测试。
 *
 * 客服 / 店长 / 老板 的在线状态以前只看「窗口可见才发」的 cs-heartbeat，
 * 最小化 / 收进托盘 2 分钟就被判成离线。现在只要客户端连接还活着就算在线。
 */
describe("在线注册表：客户端连接活着 = 在线", () => {
  beforeEach(() => presence.reset());

  it("连接后算在线，断开后不算", () => {
    expect(presence.hasSocket("u1")).toBe(false);
    presence.addSocket("u1");
    expect(presence.hasSocket("u1")).toBe(true);
    presence.removeSocket("u1");
    expect(presence.hasSocket("u1")).toBe(false);
  });

  it("同一账号两条连接：断一条还在线，两条都断才离线", () => {
    presence.addSocket("u1");
    presence.addSocket("u1");
    presence.removeSocket("u1");
    expect(presence.hasSocket("u1")).toBe(true);
    presence.removeSocket("u1");
    expect(presence.hasSocket("u1")).toBe(false);
  });

  it("多余断开不会把连接数算成负数", () => {
    presence.removeSocket("u1");
    presence.removeSocket("u1");
    expect(presence.hasSocket("u1")).toBe(false);
    presence.addSocket("u1");
    expect(presence.hasSocket("u1")).toBe(true);
  });

  it("onlineAs：有连接时返回当前时间，只剩历史心跳时返回心跳时间", () => {
    expect(presence.onlineAs("u1")).toBeNull();

    const beat = Date.now() - 60_000;
    presence.markSeen("u1");
    const seen = presence.onlineAs("u1");
    expect(seen).not.toBeNull();
    expect(seen!.getTime()).toBeGreaterThanOrEqual(beat);

    presence.addSocket("u1");
    expect(presence.onlineAs("u1")!.getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
  });

  it("空 userId 不记录", () => {
    presence.addSocket("");
    presence.markSeen("");
    expect(presence.snapshot()).toEqual([]);
  });
});
