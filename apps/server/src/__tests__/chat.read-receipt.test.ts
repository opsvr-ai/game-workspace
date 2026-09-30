// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi } from "vitest";
import { ChatService } from "../chat/chat.service";
import { ChatGateway } from "../chat/chat.gateway";

/**
 * 「已阅读 / 未读」回执（老板 2026-09-21 要求）：
 * 客服给陪玩发消息后，双方都要清楚对方看没看到。
 * 服务端要做两件事：① 消息列表告诉前端「对方读到哪一条」；
 * ② 对方一读就推一条 chat:read 给发消息的人，不用等刷新。
 */
function serviceWith(prisma: any) {
  return new ChatService(prisma as never, {} as never);
}

describe("消息已读回执", () => {
  it("1v1 会话标已读：更新自己那侧的 readSeq，并回传对端 userId", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      chatRoom: {
        findUnique: vi.fn().mockResolvedValue({
          participantA: "user-a",
          participantB: "user-b",
          isGroup: false,
          lastMessageSeq: 42,
        }),
        update,
      },
    };
    const result = await serviceWith(prisma).markRead("room-1", "user-a");

    expect(result).toEqual({ readSeq: 42, peerUserId: "user-b", isGroup: false });
    expect(update).toHaveBeenCalledWith({ where: { id: "room-1" }, data: { aReadSeq: 42 } });
  });

  it("B 侧标已读写的是 bReadSeq", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      chatRoom: {
        findUnique: vi.fn().mockResolvedValue({
          participantA: "user-a",
          participantB: "user-b",
          isGroup: false,
          lastMessageSeq: 7,
        }),
        update,
      },
    };
    const result = await serviceWith(prisma).markRead("room-1", "user-b");

    expect(result.peerUserId).toBe("user-a");
    expect(update).toHaveBeenCalledWith({ where: { id: "room-1" }, data: { bReadSeq: 7 } });
  });

  it("群聊不推单条已读（peerUserId 为空）", async () => {
    const memberUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      chatRoom: {
        findUnique: vi.fn().mockResolvedValue({
          participantA: "user-a",
          participantB: "user-b",
          isGroup: true,
          lastMessageSeq: 9,
        }),
      },
      chatRoomMember: { update: memberUpdate },
    };
    const result = await serviceWith(prisma).markRead("room-g", "user-a");

    expect(result.isGroup).toBe(true);
    expect(result.peerUserId).toBeNull();
    expect(memberUpdate).toHaveBeenCalledWith({
      where: { roomId_userId: { roomId: "room-g", userId: "user-a" } },
      data: { readSeq: 9 },
    });
  });

  it("消息列表带上「对方读到哪一条」", async () => {
    const prisma = {
      chatMessageV3: { findMany: vi.fn().mockResolvedValue([]) },
      chatRoom: {
        findUnique: vi.fn().mockResolvedValue({
          participantA: "user-a",
          participantB: "user-b",
          isGroup: false,
          aReadSeq: 3,
          bReadSeq: 88,
        }),
      },
    };
    const service = serviceWith(prisma);

    // user-a 看会话：对方（user-b）读到 88
    const asA = await service.getRoomMessages("room-1", undefined, undefined, 50, "user-a");
    expect(asA.peerReadSeq).toBe(88);

    // user-b 看会话：对方（user-a）读到 3
    const asB = await service.getRoomMessages("room-1", undefined, undefined, 50, "user-b");
    expect(asB.peerReadSeq).toBe(3);
  });

  it("群聊不给 peerReadSeq（没有单条已读概念）", async () => {
    const prisma = {
      chatMessageV3: { findMany: vi.fn().mockResolvedValue([]) },
      chatRoom: {
        findUnique: vi.fn().mockResolvedValue({
          participantA: "user-a",
          participantB: "user-b",
          isGroup: true,
          aReadSeq: 3,
          bReadSeq: 88,
        }),
      },
    };
    const result = await serviceWith(prisma).getRoomMessages("room-g", undefined, undefined, 50, "user-a");
    expect(result.peerReadSeq).toBeUndefined();
  });

  it("对方一读就推 chat:read 给发消息的人", () => {
    const emits: Array<{ target: string; event: string; data: any }> = [];
    const gateway = new ChatGateway(
      { lpush: vi.fn(), expire: vi.fn(), lrange: vi.fn(), del: vi.fn() } as never,
      {} as never,
      {} as never,
    );
    (gateway as any).server = {
      to: (target: string) => ({ emit: (event: string, data: any) => emits.push({ target, event, data }) }),
    };

    gateway.notifyRead("user-a", { roomId: "room-1", readerId: "user-b", readSeq: 12 });

    // 推给「这个人的房间」，不是某一条具体连接：一个人开着好几个窗口时，
    // 谁都能收到，也不会因为其中一条断开就全都收不到（老板 2026-09-30 报的问题）。
    expect(emits).toEqual([
      { target: "user:user-a", event: "chat:read", data: { roomId: "room-1", readerId: "user-b", readSeq: 12 } },
    ]);
  });

  it("同一个人开多条连接：断开一条后，另一条照样收得到消息", () => {
    const emits: Array<{ target: string; event: string; data: any }> = [];
    const gateway = new ChatGateway(
      { lpush: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) } as never,
      { verify: vi.fn().mockReturnValue({ sub: "user-h", username: "黄浩", role: "ADMIN", studioId: "st-1" }) } as never,
      { ensureUserInStudioGroup: vi.fn().mockResolvedValue(undefined) } as never,
    );

    // extractUser 要求配了 JWT_SECRET 才认令牌（这里只验「多条连接」的记账逻辑）
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

    let middleware: any;
    const connectionHandlers: Array<(s: any) => void> = [];
    const fakeServer: any = {
      use: (fn: any) => { middleware = fn; },
      on: (ev: string, fn: any) => { if (ev === "connection") connectionHandlers.push(fn); },
      to: (target: string) => ({ emit: (event: string, data: any) => emits.push({ target, event, data }) }),
    };
    (gateway as any).server = fakeServer; // 线上由 Nest 注入，测试里手动挂上
    gateway.afterInit(fakeServer);

    const makeSocket = (id: string) => {
      const handlers: Record<string, () => void> = {};
      return {
        id,
        handshake: { auth: { token: "tok" }, query: {} },
        data: {} as any,
        join: vi.fn(),
        on: (ev: string, fn: () => void) => { handlers[ev] = fn; },
        handlers,
      } as any;
    };

    // 客服端同时开了两个窗口 → 同一个 userId 两条 /chat 连接
    const s1 = makeSocket("sock-1");
    const s2 = makeSocket("sock-2");
    for (const s of [s1, s2]) {
      middleware(s, () => {});
      connectionHandlers.forEach((h) => h(s));
    }
    expect((gateway as any).userSockets.get("user-h").size).toBe(2);

    // 关掉其中一个窗口
    s1.handlers.disconnect();

    // 人还在线（还有一条连接），不能被当成掉线
    expect((gateway as any).userSockets.get("user-h").size).toBe(1);

    gateway.notifyNewMessage("user-h", { roomId: "room-1", message: { id: "m1" } });
    expect(emits.some((e) => e.target === "user:user-h" && e.event === "message:new")).toBe(true);

    gateway.notifyRead("user-h", { roomId: "room-1", readerId: "user-b", readSeq: 3 });
    expect(emits.some((e) => e.target === "user:user-h" && e.event === "chat:read")).toBe(true);

    // 最后一条也断了，才算真离线
    s2.handlers.disconnect();
    expect((gateway as any).userSockets.has("user-h")).toBe(false);
  });

  it("对方不在线时不报错（离线靠上线后重新拉消息）", () => {
    const gateway = new ChatGateway({} as never, {} as never, {} as never);
    (gateway as any).server = { to: () => ({ emit: vi.fn() }) };
    expect(() => gateway.notifyRead("user-offline", { roomId: "r", readerId: "u", readSeq: 1 })).not.toThrow();
  });
});
