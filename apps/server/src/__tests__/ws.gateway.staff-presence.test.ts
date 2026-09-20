// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WsGateway } from "../ws/ws.gateway";
import { presence } from "../common/presence";

/**
 * 客服 / 店长 / 老板 的 WebSocket 连接现在也要登记在线状态、也要有日志。
 * 以前只处理陪玩（companionId），管理员/客服的连接在服务端是隐形的：
 * 老板报「谁掉线了」时既看不到断开日志，也算不出他到底在不在。
 */
function setup() {
  const jwt = {
    verify: vi.fn().mockReturnValue({
      sub: "u-admin",
      username: "hanlei1",
      role: "ADMIN",
      studioId: "studio-1",
    }),
  };
  const bridgeService = { getBridgedStudioIds: vi.fn().mockResolvedValue([]) };
  const gw = new WsGateway(
    jwt as never,
    null as never,
    bridgeService as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  return { gw, jwt };
}

function adminClient() {
  return {
    id: "sock-admin",
    handshake: { address: "::ffff:1.2.3.4", auth: { token: "tok" } },
    data: {} as Record<string, unknown>,
    conn: { transport: { name: "websocket" } },
    join: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
}

describe("非陪玩（客服/店长/老板）连接登记在线", () => {
  beforeEach(() => presence.reset());

  it("连接后在线，断开后离线", async () => {
    const { gw } = setup();
    const client = adminClient();

    await gw.handleConnection(client as never);
    expect(presence.hasSocket("u-admin")).toBe(true);
    expect((client.data as any).user.role).toBe("ADMIN");

    await gw.handleDisconnect(client as never);
    expect(presence.hasSocket("u-admin")).toBe(false);
  });

  it("令牌无效时既不登记在线也不抛错", async () => {
    const { gw, jwt } = setup();
    jwt.verify.mockImplementation(() => {
      throw new Error("invalid signature");
    });
    const client = adminClient();

    await gw.handleConnection(client as never);
    expect(presence.hasSocket("u-admin")).toBe(false);
  });
});
