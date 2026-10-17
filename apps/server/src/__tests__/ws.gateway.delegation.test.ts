// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsGateway } from '../ws/ws.gateway';
import { WsConnectionService } from '../ws/ws-connection.service';
import { presence } from '../common/presence';

/**
 * 拆分回归：ws.gateway.ts 从 1,553 行拆成「网关（入口 + 委托）+ 连接 / 事件语义 / 黑名单 / 语音」四层后，
 * 公开方法必须**一字不差**地还是原来那条链路：
 *
 *  1) 公开方法委托后，仍然 emit 到原来的 room / 事件（payload 语义不变，例如陪玩端仍看不到客户来源）；
 *  2) handleConnection / handleDisconnect 委托后，仍然做原来的房间编排 / 在线登记 / 断线置离线广播。
 *
 * 用假 server 打桩，不需要真的起 Socket.IO。
 */
function captureServer() {
  const emitted: Array<{ room: string; event: string; data: any }> = [];
  const server = {
    to: (room: string) => ({
      emit: (event: string, data: any) => {
        emitted.push({ room, event, data });
      },
    }),
  };
  return { emitted, server };
}

function clientOf(id: string, username: string) {
  return { data: { user: { id, username, role: 'COMPANION' } } };
}

describe('WsGateway 公开方法委托：事件语义层 / 语音层 / 黑名单层', () => {
  it('pushOrder / notifyUser / notifyCompanion / broadcastToStudio / call:offer / blacklist:update 仍打到原来的 room 与事件', async () => {
    const { emitted, server } = captureServer();
    const prisma = {
      user: { findUnique: vi.fn(async ({ where }: any) => ({ id: where.id })) },
      companion: { findUnique: vi.fn(async () => null) },
    };
    const gw = new WsGateway(
      null as never,
      prisma as never,
      { getBridgedStudioIds: vi.fn().mockResolvedValue([]) } as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    (gw as unknown as { server: unknown }).server = server;

    // 新单推送：陪玩房间 + order:new，且「客户来源」字段照旧被摘掉
    gw.pushOrder('c1', { id: 'order-1', customFields: { customerSource: '小红书', customerWechat: 'wx1' } });
    expect(emitted[0].room).toBe('companion:c1');
    expect(emitted[0].event).toBe('order:new');
    expect(emitted[0].data.customFields).not.toHaveProperty('customerSource');
    expect(emitted[0].data.customFields.customerWechat).toBe('wx1');

    // 点对点通知：user 房间 / companion 房间
    gw.notifyUser('u1', 'review:notice', { title: 'x' });
    expect(emitted[1]).toMatchObject({ room: 'user:u1', event: 'review:notice', data: { title: 'x' } });

    gw.notifyCompanion('c2', 'work-wechat:updated', { ok: true });
    expect(emitted[2]).toMatchObject({ room: 'companion:c2', event: 'work-wechat:updated' });

    // 工作室广播
    gw.broadcastToStudio('s1', 'status:broadcast', { companionId: 'c1', status: 'AVAILABLE' });
    expect(emitted[3]).toMatchObject({ room: 'studio:s1', event: 'status:broadcast' });

    // 语音层委托：call:offer 仍投递到对端的 user 房间
    await gw.handleCallOffer(clientOf('u-alice', '王昊') as never, { targetUserId: 'u-bob' } as never);
    expect(emitted[4]).toMatchObject({ room: 'user:u-bob', event: 'call:offer' });
    expect(emitted[4].data.fromUserId).toBe('u-alice');

    // 黑名单层委托：分不清店铺（studioId=undefined）= 一律下发空名单（客户端当场停手）
    await gw.sendBlacklistUpdate(
      'c1',
      [{ processName: 'DeltaForceClient-Win64-Shipping', processPath: null }],
      [],
      1,
      'AVAILABLE',
      true,
      undefined,
    );
    expect(emitted[5].room).toBe('companion:c1');
    expect(emitted[5].event).toBe('blacklist:update');
    expect(emitted[5].data.blacklist).toEqual([]);
  });
});

describe('WsGateway 连接层委托：handleConnection / handleDisconnect', () => {
  const COMPANION_PAYLOAD = {
    sub: 'u1',
    username: 'c1',
    role: 'COMPANION',
    studioId: 's1',
    companionId: 'c1',
  };

  function setup() {
    const { emitted, server } = captureServer();
    const jwt = { verify: vi.fn().mockReturnValue(COMPANION_PAYLOAD) };
    const prisma = {
      systemConfig: { findUnique: vi.fn().mockResolvedValue({ key: 'ws.offline_grace_seconds', value: 0 }) },
      orderSession: { findFirst: vi.fn().mockResolvedValue(null) },
      companion: {
        // handleConnection 读当前状态、掉线置离线（switchCompanionStatus）也读一次
        findUnique: vi.fn().mockResolvedValue({ status: 'AVAILABLE' }),
        update: vi.fn().mockResolvedValue({}),
      },
      companionTimeLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
      companionStatusBlacklist: { findMany: vi.fn().mockResolvedValue([]) },
      processWhitelist: { findMany: vi.fn().mockResolvedValue([]) },
      studioConfig: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
      managedPC: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(null) },
    };
    const companions = {
      resolvePresenceStatus: vi.fn().mockResolvedValue('AVAILABLE'),
      ensureAttendance: vi.fn().mockResolvedValue(undefined),
      ensureStaffAttendance: vi.fn().mockResolvedValue(undefined),
      hasActiveServiceSession: vi.fn().mockResolvedValue(false),
      finalizeAttendance: vi.fn().mockResolvedValue(undefined),
    };
    const bridgeService = { getBridgedStudioIds: vi.fn().mockResolvedValue([]) };
    const gw = new WsGateway(
      jwt as never,
      prisma as never,
      bridgeService as never,
      companions as never,
      null as never,
      null as never,
      null as never,
    );
    (gw as unknown as { server: unknown }).server = server;
    return { gw, prisma, companions, emitted };
  }

  function client() {
    return {
      id: 'sock-1',
      handshake: { address: '::ffff:1.2.3.4', auth: { token: 'tok' }, query: {} },
      conn: { transport: { name: 'websocket' } },
      data: {} as Record<string, any>,
      join: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  beforeEach(() => presence.reset());

  it('连接后仍进 user/studio/companion/pc 房间并登记在线；断开后仍走宽限期置离线并广播状态', async () => {
    const { gw, prisma, companions, emitted } = setup();
    const c = client();

    await gw.handleConnection(c as never);

    // 房间编排：跟拆分前完全一致
    const joined = c.join.mock.calls.map((args) => args[0]);
    expect(joined).toEqual(expect.arrayContaining(['user:u1', 'studio:s1', 'companion:c1', 'pc:c1']));
    // 在线映射 / 在线注册表
    expect(gw.isCompanionConnected('c1')).toBe(true);
    expect(presence.hasSocket('u1')).toBe(true);
    // 连接时仍然按在线状态落库、并记考勤
    expect(companions.ensureAttendance).toHaveBeenCalledWith('c1');

    await gw.handleDisconnect(c as never);

    // 断线宽限配成 0 = 立刻置离线（老行为），并走统一状态入口
    expect(prisma.companion.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'OFFLINE' } });
    expect(companions.finalizeAttendance).toHaveBeenCalledWith('c1');
    // 状态广播仍然走 studio 房间（桥接 studio 无，只有本店）
    expect(emitted).toEqual(
      expect.arrayContaining([
        { room: 'studio:s1', event: 'status:broadcast', data: { companionId: 'c1', status: 'OFFLINE' } },
      ]),
    );
    expect(gw.isCompanionConnected('c1')).toBe(false);
    expect(presence.hasSocket('u1')).toBe(false);
  });
});

describe('WsGateway 新拆层委托：状态 / 指令回执 / chat', () => {
  function setup() {
    const { emitted, server } = captureServer();
    const prisma = {
      orderSession: { findFirst: vi.fn().mockResolvedValue(null) },
      companion: {
        findUnique: vi.fn().mockResolvedValue({ status: 'AVAILABLE' }),
        update: vi.fn().mockResolvedValue({}),
      },
      companionPC: { update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue({ id: 'pc-1' }) },
      companionTimeLog: { updateMany: vi.fn().mockResolvedValue({}), create: vi.fn().mockResolvedValue({}) },
      companionStatusBlacklist: { findMany: vi.fn().mockResolvedValue([]) },
      processWhitelist: { findMany: vi.fn().mockResolvedValue([]) },
      studioConfig: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
      pCOperationLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const gw = new WsGateway(
      null as never,
      prisma as never,
      { getBridgedStudioIds: vi.fn().mockResolvedValue([]) } as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    (gw as unknown as { server: unknown }).server = server;
    return { gw, prisma, emitted };
  }

  const companionClient = (studioId: string | null = 's1') => ({
    data: { user: { id: 'u1', username: 'c1', role: 'COMPANION', studioId, companionId: 'c1' } },
  });

  it('companion:status 委托后：仍切库 / 记计时日志 / 推黑名单 / 广播工作室', async () => {
    const { gw, prisma, emitted } = setup();
    // 第一次读是切状态前的旧状态（AVAILABLE），之后（pushCurrentBlacklist）读到的就是新状态。
    prisma.companion.findUnique.mockResolvedValueOnce({ status: 'AVAILABLE' }).mockResolvedValue({
      status: 'ENTERTAINMENT',
    });

    // IDLE 走旧客户端兼容映射 → ENTERTAINMENT
    await gw.handleStatusChange(companionClient() as never, { status: 'IDLE' } as never);

    expect(prisma.companion.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'ENTERTAINMENT' } });
    expect(prisma.companionPC.update).toHaveBeenCalledWith({
      where: { companionId: 'c1' },
      data: { currentMode: 'ENTERTAINMENT' },
    });
    expect(prisma.companionTimeLog.create).toHaveBeenCalled();
    // 权威状态的黑名单下发 + 工作室广播都还在
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          room: 'companion:c1',
          event: 'blacklist:update',
          data: expect.objectContaining({ status: 'ENTERTAINMENT', authoritative: true }),
        }),
        {
          room: 'studio:s1',
          event: 'status:broadcast',
          data: { companionId: 'c1', status: 'ENTERTAINMENT', mode: undefined },
        },
      ]),
    );
  });

  it('companion:status 的「服务中禁止切状态」判断仍在', async () => {
    const { gw, prisma } = setup();
    prisma.orderSession.findFirst.mockResolvedValue({ id: 'sess-1' });

    await gw.handleStatusChange(companionClient() as never, { status: 'AVAILABLE' } as never);

    expect(prisma.companion.update).not.toHaveBeenCalled();
  });

  it('pc:command_ack 委托后：回执仍落 PCOperationLog', async () => {
    const { gw, prisma } = setup();

    await gw.handleCommandAck(companionClient() as never, { command: 'update', success: false } as never);

    expect(prisma.pCOperationLog.create).toHaveBeenCalledWith({
      data: { pcId: 'pc-1', operation: 'update', operatorId: 'u1', detail: JSON.stringify({ success: false }) },
    });
  });

  it('chat:send 委托后：仍广播 chat:new 到 studio 房间；没有工作室的连接直接丢弃', async () => {
    const { gw, emitted } = setup();

    await gw.handleChatSend(companionClient() as never, { text: 'hi', orderId: 'o1' } as never);
    expect(emitted[0]).toMatchObject({
      room: 'studio:s1',
      event: 'chat:new',
      data: {
        text: 'hi',
        senderId: 'u1',
        senderRole: 'COMPANION',
        senderName: 'c1',
        orderId: 'o1',
        companionId: 'c1',
      },
    });

    emitted.length = 0;
    await gw.handleChatSend(companionClient(null) as never, { text: 'hi' } as never);
    expect(emitted).toHaveLength(0);
  });
});

/**
 * 线上事故回归（2026-10-17）：Nest 10 在 forwardRef 场景下会先给占位实例，
 * 等真正实例化后再 `Object.assign(占位实例, new Service(...))` —— 新实例的类字段
 * `runtime = null` 会把网关构造期 attach 好的 runtime 覆盖掉。症状是服务能启动，
 * 但第一个 WebSocket 连接/断开就 `WsConnectionService runtime not attached`，进程直接崩。
 * 这里锁住「afterInit 会重新挂 runtime」这个修复。
 */
describe('WsGateway 生命周期：forwardRef 占位实例合并后 runtime 仍需可用', () => {
  it('Object.assign 覆盖构造期 runtime 后，afterInit 会重新挂上', () => {
    const gw = new WsGateway(
      null as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    (gw as unknown as { server: unknown }).server = { use: vi.fn() };

    const conn = (gw as unknown as { connection: { runtime: unknown } }).connection;
    expect(conn.runtime).toBeTruthy();

    // 模拟 Nest 的 forwardRef 合并：类字段把 runtime 覆盖回 null
    Object.assign(conn, new WsConnectionService(null as never, {} as never, {} as never, {} as never));
    expect(conn.runtime).toBeNull();

    // afterInit（Nest 在所有 provider 合并完成之后调用）重新挂一次
    gw.afterInit();
    expect(conn.runtime).toBeTruthy();
    expect(() => (conn as unknown as { r: unknown }).r).not.toThrow();
  });
});
