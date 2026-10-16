// craftsman-ignore: TS001,TS003
import { describe, it, expect, beforeEach } from 'vitest';
import { MachineService } from '../agent/machine.service';
import { createMockPrisma, MockPrisma } from '../__mocks__/prisma.mock';
import { ONBOARD_REPORT_TOKEN } from '../agent/agent-token';

/**
 * 老板 2026-10-17：「现在就换」。
 *
 * 孙可馨一直是在**陪玩端程序**里登客服账号（界面是客服的，底层是陪玩端的壳），
 * 台账里只能记成陪玩端。以前这种事得人到电脑跟前双击安装包；
 * 现在云端点个名（`client.wanted_kind.<machineId>`）就够：
 * 那台机器下次上报时发现「点名要的端 ≠ 我现在的端」，就自动补一条换端任务，
 * 由看门狗以 SYSTEM 权限执行。换好了自动撤点名，不会反复派。
 */
describe('MachineService 云端点名换端', () => {
  let service: MachineService;
  let mockPrisma: MockPrisma;
  const machineId = 'bf-202406300325-0ae0afae2d4a';
  const machineKey = `client.machine.${machineId}`;
  const wantedKey = `client.wanted_kind.${machineId}`;

  const machineRow = (over: Record<string, unknown> = {}) => ({
    key: machineKey,
    value: {
      machineId,
      clientType: 'COMPANION',
      hostname: 'BF-202406300325',
      primaryIp: '192.168.1.143',
      appVersion: '1.0.20261023',
      remoteReady: true,
      lastSource: 'companion-client',
      ...over,
    },
  });

  /** 心跳（客户端每 5 分钟一次）。 */
  const heartbeat = (over: Record<string, unknown> = {}) =>
    service.reportMachine({
      machineId,
      hostname: 'BF-202406300325',
      primaryIp: '192.168.1.143',
      mac: 'AA-BB-CC-DD-EE-FF',
      source: 'companion-client',
      ...over,
    });

  const createdTasks = () =>
    (mockPrisma.systemConfig.create as any).mock.calls
      .map((c: any[]) => c[0]?.data?.value)
      .filter((v: any) => v && v.type === 'switch-client');

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new MachineService(mockPrisma as any);
    mockPrisma.systemConfig.upsert.mockResolvedValue({});
    mockPrisma.systemConfig.create.mockResolvedValue({});
    mockPrisma.systemConfig.update.mockResolvedValue({});
    mockPrisma.systemConfig.delete.mockResolvedValue({});
    mockPrisma.systemConfig.findMany.mockResolvedValue([]);
  });

  it('点名要客服端、这台还报陪玩端 → 自动派一条换端任务（署名 system）', async () => {
    mockPrisma.systemConfig.findUnique.mockImplementation(({ where }: any) => {
      if (where?.key === wantedKey) return Promise.resolve({ key: wantedKey, value: 'cs' });
      if (where?.key === machineKey) return Promise.resolve(machineRow());
      return Promise.resolve(null);
    });
    await heartbeat({ clientType: 'COMPANION', remoteReady: true, watchdogBuild: '2026093006' });
    await new Promise((r) => setTimeout(r, 0));
    const tasks = createdTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].machineId).toBe(machineId);
    expect(tasks[0].clientKind).toBe('cs');
    expect(tasks[0].createdBy).toBe('system');
    expect(tasks[0].createdById).toBe('');
    expect(tasks[0].status).toBe('pending');
    expect(String(tasks[0].reason)).toContain('自动换端');
    // 换端要下 80MB 安装包，得给足超时；但只能给到看门狗的上限 600 秒（超了它会退回 240，反而更短）
    expect(tasks[0].timeoutSec).toBe(600);
    // 换的时候别把老客户端先卸了 —— 这条任务只负责“装新端并验在不在”
    expect(tasks[0].command).toBe('');
  });

  it('换端任务发给客户端时，带的是换端脚本 + -Kind cs；超时夹在看门狗上限以内', async () => {
    mockPrisma.systemConfig.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.key === machineKey ? machineRow({ systemPollAt: new Date().toISOString() }) : null),
    );
    const task = await service.createTask({
      machineId,
      type: 'switch-client',
      clientKind: 'cs',
      // 故意写一个「看着更保险」的 1800：看门狗收到 >600 会退回 240 秒默认值，
      // 所以服务端必须自己先夹住（2026-10-17 差点踩上）。
      timeoutSec: 1800,
      reason: '自动换端：换成客服端',
      actor: { username: 'system', id: '' },
    });
    mockPrisma.systemConfig.findMany.mockResolvedValue([{ key: `client.task.${task.id}`, value: task }]);
    const got = await service.takeTasks(machineId, 3, 'system');
    expect(got.tasks).toHaveLength(1);
    const payload = got.tasks[0] as any;
    expect(payload.type).toBe('switch-client');
    expect(payload.mode).toBe('script');
    // -TaskId / -Token：脚本自己把结果回传（装机包会中途把看门狗停掉，看门狗报不回来）
    expect(payload.args).toEqual([
      '-ServerUrl', '__SERVER__', '-Kind', 'cs', '-TaskId', payload.id, '-Token', ONBOARD_REPORT_TOKEN,
    ]);
    expect(payload.timeoutSec).toBe(600);
    // 脚本正文要真是「装目标端 → 验在不在 → 退旧端 → 搬账号密码」那一份
    expect(String(payload.script)).toContain('[换端]');
    expect(String(payload.script)).toContain('/api/agent/download/cs');
    expect(String(payload.script)).toContain('HKEY_USERS');
    expect(String(payload.script)).toContain('/api/agent/machine-task-result');
  });

  it('已经换成客服端了 → 不再派任务，也不许动别的台账行（点名留着当目标状态）', async () => {
    mockPrisma.systemConfig.findUnique.mockImplementation(({ where }: any) => {
      if (where?.key === wantedKey) return Promise.resolve({ key: wantedKey, value: 'cs' });
      if (where?.key === 'watchdog.latest_build') return Promise.resolve({ key: where.key, value: '2026093006' });
      if (where?.key === machineKey) return Promise.resolve(machineRow({ clientType: 'CS' }));
      return Promise.resolve(null);
    });
    await heartbeat({ clientType: 'CS', remoteReady: true, watchdogBuild: '2026093006' });
    await new Promise((r) => setTimeout(r, 0));
    expect(createdTasks()).toHaveLength(0);
    // 点名是「这台电脑应该是客服端」的目标状态，换成功了也留着 ——
    // 万一有人又把旧端点开，下一次心跳还会自动换回来。
    expect(mockPrisma.systemConfig.delete).not.toHaveBeenCalled();
  });

  it('没点名就不许动人家的客户端（平时一台都不许换）', async () => {
    mockPrisma.systemConfig.findUnique.mockImplementation(({ where }: any) => {
      if (where?.key === 'watchdog.latest_build') return Promise.resolve({ key: where.key, value: '2026093006' });
      if (where?.key === machineKey) return Promise.resolve(machineRow());
      return Promise.resolve(null);
    });
    await heartbeat({ clientType: 'COMPANION', remoteReady: true, watchdogBuild: '2026093006' });
    await new Promise((r) => setTimeout(r, 0));
    expect(createdTasks()).toHaveLength(0);
    expect(mockPrisma.systemConfig.delete).not.toHaveBeenCalled();
  });

  it('点名值写成对象 {"kind":"cs"} 也认（管理端两种写法都会出现）', async () => {
    mockPrisma.systemConfig.findUnique.mockImplementation(({ where }: any) => {
      if (where?.key === wantedKey) return Promise.resolve({ key: wantedKey, value: { kind: 'cs' } });
      if (where?.key === machineKey) return Promise.resolve(machineRow());
      return Promise.resolve(null);
    });
    await heartbeat({ clientType: 'COMPANION', remoteReady: true, watchdogBuild: '2026093006' });
    await new Promise((r) => setTimeout(r, 0));
    const tasks = createdTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].clientKind).toBe('cs');
  });

  it('刚派过还在待执行 → 不重复派（心跳每 5 分钟一次，不能变成 5 分钟一次换端）', async () => {
    mockPrisma.systemConfig.findUnique.mockImplementation(({ where }: any) => {
      if (where?.key === wantedKey) return Promise.resolve({ key: wantedKey, value: 'cs' });
      if (where?.key === 'watchdog.latest_build') return Promise.resolve({ key: where.key, value: '2026093006' });
      if (where?.key === machineKey) return Promise.resolve(machineRow());
      return Promise.resolve(null);
    });
    mockPrisma.systemConfig.findMany.mockResolvedValue([
      {
        key: 'client.task.t-old',
        value: {
          id: 't-old',
          machineId,
          type: 'switch-client',
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      },
    ]);
    await heartbeat({ clientType: 'COMPANION', remoteReady: true, watchdogBuild: '2026093006' });
    await new Promise((r) => setTimeout(r, 0));
    expect(createdTasks()).toHaveLength(0);
  });

  it('上一轮换端失败了（任务已结束）→ 一小时内不重复派，过了冷却还会再试', async () => {
    const wantedImpl = ({ where }: any) => {
      if (where?.key === wantedKey) return Promise.resolve({ key: wantedKey, value: 'cs' });
      if (where?.key === 'watchdog.latest_build') return Promise.resolve({ key: where.key, value: '2026093006' });
      if (where?.key === machineKey) return Promise.resolve(machineRow());
      return Promise.resolve(null);
    };
    const failedTask = (agoMin: number) => ({
      key: 'client.task.t-failed',
      value: {
        id: 't-failed',
        machineId,
        type: 'switch-client',
        status: 'done',
        createdAt: new Date(Date.now() - agoMin * 60 * 1000).toISOString(),
      },
    });

    mockPrisma.systemConfig.findUnique.mockImplementation(wantedImpl);
    mockPrisma.systemConfig.findMany.mockResolvedValue([failedTask(10)]);
    await heartbeat({ clientType: 'COMPANION', remoteReady: true, watchdogBuild: '2026093006' });
    await new Promise((r) => setTimeout(r, 0));
    expect(createdTasks()).toHaveLength(0);

    mockPrisma.systemConfig.findUnique.mockImplementation(wantedImpl);
    mockPrisma.systemConfig.findMany.mockResolvedValue([failedTask(90)]);
    await heartbeat({ clientType: 'COMPANION', remoteReady: true, watchdogBuild: '2026093006' });
    await new Promise((r) => setTimeout(r, 0));
    expect(createdTasks()).toHaveLength(1);
  });
});
