// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WsGateway } from "../ws/ws.gateway";
import { presence } from "../common/presence";

/**
 * 语音通话改成走 WebSocket 中转（不再点对点打洞）之后，
 * 音频帧必须：只发给通话对端、单帧不能过大、每秒不能刷太多。
 * 老板 2026-09-21 报「王昊和邵泽慧互相听不到声音」，
 * 这条通道现在就是他们唯一的声音来源，转发错一次就是「没声音」。
 */
function harness() {
  const emits: Array<{ room: string; event: string; data: any }> = [];
  const server = {
    to: (room: string) => ({
      emit: (event: string, data: any) => {
        emits.push({ room, event, data });
      },
    }),
  };
  const jwt = { verify: vi.fn() };
  const prisma = {
    user: { findUnique: vi.fn(async ({ where }: any) => ({ id: where.id })) },
    companion: { findUnique: vi.fn(async () => null) },
  };
  const gw = new WsGateway(
    jwt as never,
    prisma as never,
    { getBridgedStudioIds: vi.fn().mockResolvedValue([]) } as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  (gw as any).server = server;
  return { gw, emits };
}

function client(id: string, username: string) {
  return { data: { user: { id, username, role: "COMPANION" } } };
}

const frame = (bytes = 640) => ({ pcm: new ArrayBuffer(bytes), seq: 1 });

describe("语音通话中继", () => {
  beforeEach(() => presence.reset());

  it("主叫发起后，音频只发给被叫", async () => {
    const { gw, emits } = harness();
    const alice = client("u-alice", "王昊");

    await gw.handleCallOffer(alice as never, { targetUserId: "u-bob" });
    emits.length = 0;

    gw.handleCallAudio(alice as never, { to: "u-bob", ...frame() } as never);

    expect(emits).toHaveLength(1);
    expect(emits[0].room).toBe("user:u-bob");
    expect(emits[0].event).toBe("call:audio");
    expect(emits[0].data.from).toBe("u-alice");
    expect((emits[0].data.pcm as ArrayBuffer).byteLength).toBe(640);
  });

  it("被叫接听后也能把音频发回主叫", async () => {
    const { gw, emits } = harness();
    const alice = client("u-alice", "王昊");
    const bob = client("u-bob", "邵泽慧");

    await gw.handleCallOffer(alice as never, { targetUserId: "u-bob" });
    await gw.handleCallAnswer(bob as never, { targetUserId: "u-alice" });
    emits.length = 0;

    gw.handleCallAudio(bob as never, { to: "u-alice", ...frame() } as never);

    expect(emits).toHaveLength(1);
    expect(emits[0].room).toBe("user:u-alice");
    expect(emits[0].data.from).toBe("u-bob");
  });

  it("没在通话中的人发音频会被丢掉", () => {
    const { gw, emits } = harness();
    gw.handleCallAudio(client("u-eve", "路人") as never, { to: "u-bob", ...frame() } as never);
    expect(emits).toHaveLength(0);
  });

  it("发给非通话对端会被丢掉（防止拿语音通道当传话筒）", async () => {
    const { gw, emits } = harness();
    const alice = client("u-alice", "王昊");
    await gw.handleCallOffer(alice as never, { targetUserId: "u-bob" });
    emits.length = 0;

    gw.handleCallAudio(alice as never, { to: "u-carol", ...frame() } as never);

    expect(emits).toHaveLength(0);
  });

  it("超大帧会被丢掉（单帧上限 8KB）", async () => {
    const { gw, emits } = harness();
    const alice = client("u-alice", "王昊");
    await gw.handleCallOffer(alice as never, { targetUserId: "u-bob" });
    emits.length = 0;

    gw.handleCallAudio(alice as never, { to: "u-bob", pcm: new ArrayBuffer(9000) } as never);

    expect(emits).toHaveLength(0);
  });

  it("每秒超过 100 帧的部分会被限速丢掉", async () => {
    const { gw, emits } = harness();
    const alice = client("u-alice", "王昊");
    await gw.handleCallOffer(alice as never, { targetUserId: "u-bob" });
    emits.length = 0;

    for (let i = 0; i < 130; i++) {
      gw.handleCallAudio(alice as never, { to: "u-bob", ...frame() } as never);
    }

    expect(emits).toHaveLength(100);
  });

  it("挂断会同时清掉双方的会话", async () => {
    const { gw } = harness();
    const alice = client("u-alice", "王昊");
    const bob = client("u-bob", "邵泽慧");

    await gw.handleCallOffer(alice as never, { targetUserId: "u-bob" });
    await gw.handleCallAnswer(bob as never, { targetUserId: "u-alice" });
    await gw.handleCallHangup(alice as never, { targetUserId: "u-bob" });

    const sessions = (gw as any).callSessions as Map<string, unknown>;
    expect(sessions.has("u-alice")).toBe(false);
    expect(sessions.has("u-bob")).toBe(false);
  });

  it("断开不会立刻掐断通话：先告诉对端网络抖动，宽限期内连回来就继续", async () => {
    vi.useFakeTimers();
    try {
      const { gw, emits } = harness();
      const alice = client("u-alice", "王昊");
      await gw.handleCallOffer(alice as never, { targetUserId: "u-bob" });
      emits.length = 0;

      (gw as any).scheduleCallEndOnDisconnect({ id: "u-alice", username: "王昊", role: "COMPANION", studioId: "s1" });

      // 断线瞬间只提示「对方网络抖动」，不能挂断
      expect(emits.map((e) => e.event)).toEqual(["call:peer-unstable"]);
      expect(((gw as any).callSessions as Map<string, unknown>).has("u-alice")).toBe(true);

      // 宽限期过一半就重连回来了：通话保留、不再挂断
      presence.addSocket("u-alice");
      vi.advanceTimersByTime(20_000);
      const pending = (gw as any).pendingCallEndTimers as Map<string, unknown>;
      clearTimeout(pending.get("u-alice") as never);
      pending.delete("u-alice");
      vi.advanceTimersByTime(60_000);
      expect(emits.some((e) => e.event === "call:hangup")).toBe(false);
      expect(((gw as any).callSessions as Map<string, unknown>).has("u-alice")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("宽限期内没回来才真的挂断并清会话", async () => {
    vi.useFakeTimers();
    try {
      const { gw, emits } = harness();
      const alice = client("u-alice", "王昊");
      await gw.handleCallOffer(alice as never, { targetUserId: "u-bob" });
      emits.length = 0;

      (gw as any).scheduleCallEndOnDisconnect({ id: "u-alice", username: "王昊", role: "COMPANION", studioId: "s1" });
      presence.removeSocket("u-alice");
      vi.advanceTimersByTime(46_000);

      expect(emits.some((e) => e.room === "user:u-bob" && e.event === "call:hangup")).toBe(true);
      expect(((gw as any).callSessions as Map<string, unknown>).has("u-alice")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
