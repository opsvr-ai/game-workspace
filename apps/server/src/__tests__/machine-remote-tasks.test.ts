// craftsman-ignore: TS001,TS003
import { describe, it, expect, beforeEach } from 'vitest';
import { MachineService } from '../agent/machine.service';
import { createMockPrisma, MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 老板 2026-10-01：「你看看还谁不是全自动的……以后都弄全自动好么？」
 *
 * 两条规矩要钉住：
 *   ① 任务给谁执行 —— 看门狗（SYSTEM 服务，`as=system`）优先，客户端（登录用户权限，`as=user`）
 *      在看门狗活着的时候领不到。起因：叶号那台登录的 Windows 账号不是管理员，任务白派。
 *   ② 上报即自愈 —— 机器一上报发现「远程管理没开通 / 看门狗不是最新」就自动补一条任务，
 *      而且是自动补的（createdBy=system），不用有人点。
 */
describe('MachineService 远程任务：看门狗优先 + 上报即自愈', () => {
  let service: MachineService;
  let mockPrisma: MockPrisma;
  const machineId = 'user-20240831vs-aabbccddeeff';
  const machineKey = `client.machine.${machineId}`;

  const machineRow = (over: Record<string, unknown> = {}) => ({
    key: machineKey,
    value: {
      machineId,
      clientType: 'COMPANION',
      hostname: 'User-20240831VS',
      primaryIp: '192.168.0.132',
      appVersion: '1.0.20260932',
      remoteReady: true,
      lastSource: 'companion-client',
      ...over,
    },
  });

  const taskRow = (over: Record<string, unknown> = {}) => ({
    key: 'client.task.t1',
    value: {
      id: 't1',
      machineId,
      machineLabel: 'User-20240831VS',
      type: 'diag',
      status: 'pending',
      createdAt: '2026-09-30T16:00:00.000Z',
      ...over,
    },
  });

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new MachineService(mockPrisma as any);
  });

  it('看门狗报过之后，客户端就领不到任务了（任务一律系统权限执行）', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue(machineRow({ systemPollAt: new Date().toISOString() }));
    mockPrisma.systemConfig.findMany.mockResolvedValue([taskRow()]);
    const got = await service.takeTasks(machineId, 3, 'user');
    expect(got.tasks).toHaveLength(0);
    // 而且不能把任务标成「执行中」—— 没领走就得留给人来领
    expect(mockPrisma.systemConfig.update).not.toHaveBeenCalled();
  });

  it('看门狗三分钟没动静了，客户端照样能领（老机器上没人升级看门狗也不至于卡死）', async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    mockPrisma.systemConfig.findUnique.mockResolvedValue(machineRow({ systemPollAt: stale }));
    mockPrisma.systemConfig.findMany.mockResolvedValue([taskRow()]);
    const got = await service.takeTasks(machineId, 3, 'user');
    expect(got.tasks).toHaveLength(1);
    expect(mockPrisma.systemConfig.update).toHaveBeenCalled();
  });

  it('看门狗自己领任务不受影响', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue(machineRow({ systemPollAt: new Date().toISOString() }));
    mockPrisma.systemConfig.findMany.mockResolvedValue([taskRow()]);
    const got = await service.takeTasks(machineId, 3, 'system');
    expect(got.tasks).toHaveLength(1);
  });

  it('远程管理没开通 → 上报就自动补一条任务，署名字段是 system', async () => {
    // 机器行读得到（createTask 要照着它落任务），但没配 watchdog.latest_build
    mockPrisma.systemConfig.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.key === machineKey ? machineRow() : null),
    );
    mockPrisma.systemConfig.findMany.mockResolvedValue([]);
    mockPrisma.systemConfig.upsert.mockResolvedValue({});
    mockPrisma.systemConfig.create.mockResolvedValue({});
    await service.reportMachine({
      machineId,
      clientType: 'COMPANION',
      hostname: 'User-20240831VS',
      primaryIp: '192.168.0.132',
      mac: 'AA-BB-CC-DD-EE-FF',
      remoteReady: false,
      source: 'companion-client',
    });
    // autoHeal 是 fire-and-forget，给它一轮微任务
    await new Promise((r) => setTimeout(r, 0));
    const created = (mockPrisma.systemConfig.create as any).mock.calls.map((c: any[]) => c[0]?.data?.value);
    const heal = created.find((v: any) => v?.type === 'enable-remote');
    expect(heal).toBeTruthy();
    expect(heal.createdBy).toBe('system');
    expect(heal.reason).toContain('自动自愈');
  });

  it('什么都齐了就不补任务（别无事生非地天天派）', async () => {
    mockPrisma.systemConfig.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.key === 'watchdog.latest_build' ? { key: where.key, value: '2026093006' } : null),
    );
    mockPrisma.systemConfig.findMany.mockResolvedValue([]);
    mockPrisma.systemConfig.upsert.mockResolvedValue({});
    mockPrisma.systemConfig.create.mockResolvedValue({});
    await service.reportMachine({
      machineId,
      clientType: 'COMPANION',
      hostname: 'User-20240831VS',
      primaryIp: '192.168.0.132',
      mac: 'AA-BB-CC-DD-EE-FF',
      remoteReady: true,
      watchdogBuild: '2026093006',
      source: 'companion-client',
    });
    await new Promise((r) => setTimeout(r, 0));
    const created = (mockPrisma.systemConfig.create as any).mock.calls.map((c: any[]) => c[0]?.data?.value);
    expect(created.filter((v: any) => v?.type === 'enable-remote')).toHaveLength(0);
  });

  it('客户端来报时，脚本留下的重复台账行会被清掉（同一台机器不再两条记录）', async () => {
    const canonicalId = 'pc-20260409cdbj-00e04c405d73';
    const strayId = 'pc-20260409cdbj-005056c00008';
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null);
    mockPrisma.systemConfig.findMany.mockResolvedValue([
      {
        key: `client.machine.${canonicalId}`,
        value: {
          machineId: canonicalId,
          hostname: 'PC-20260409CDBJ',
          primaryIp: '192.168.0.140',
          ips: ['192.168.0.140'],
          lastSource: 'companion-client',
          appVersion: '1.0.20260932',
        },
      },
      {
        key: `client.machine.${strayId}`,
        value: {
          machineId: strayId,
          hostname: 'PC-20260409CDBJ',
          primaryIp: '192.168.81.1',
          ips: ['192.168.81.1', '192.168.136.1', '192.168.0.140'],
          lastSource: 'enable-remote',
          appVersion: '',
        },
      },
    ]);
    mockPrisma.systemConfig.upsert.mockResolvedValue({});
    mockPrisma.systemConfig.delete.mockResolvedValue({});
    await service.reportMachine({
      machineId: canonicalId,
      clientType: 'COMPANION',
      hostname: 'PC-20260409CDBJ',
      primaryIp: '192.168.0.140',
      ips: ['192.168.0.140'],
      mac: '00-E0-4C-40-5D-73',
      remoteReady: true,
      watchdogBuild: '2026093006',
      source: 'companion-client',
    });
    await new Promise((r) => setTimeout(r, 0));
    const deleted = (mockPrisma.systemConfig.delete as any).mock.calls.map((c: any[]) => c[0]?.where?.key);
    expect(deleted).toContain(`client.machine.${strayId}`);
  });

  it('同名的另一台机器不会被误删（主机名一样、IP 不搭界）', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null);
    mockPrisma.systemConfig.findMany.mockResolvedValue([
      {
        key: 'client.machine.user-20240831vs-30560fb36770',
        value: {
          machineId: 'user-20240831vs-30560fb36770',
          hostname: 'User-20240831VS',
          primaryIp: '192.168.0.197',
          ips: ['192.168.0.197'],
          lastSource: 'enable-remote',
          appVersion: '',
        },
      },
    ]);
    mockPrisma.systemConfig.upsert.mockResolvedValue({});
    mockPrisma.systemConfig.delete.mockResolvedValue({});
    await service.reportMachine({
      machineId: 'user-20240831vs-345a60f446b6',
      clientType: 'COMPANION',
      hostname: 'User-20240831VS',
      primaryIp: '192.168.0.125',
      ips: ['192.168.0.125'],
      mac: '34-5A-60-F4-46-B6',
      remoteReady: true,
      watchdogBuild: '2026093006',
      source: 'companion-client',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockPrisma.systemConfig.delete).not.toHaveBeenCalled();
  });
});
