// craftsman-ignore: TS001,TS003
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MachineService } from '../agent/machine.service';
import { createMockPrisma, MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 老板 2026-09-30 报「管理端同一台机器出现两条记录、点了开通远程管理还是显示未开通」的回归。
 *
 * 客户端和运维脚本各算各的 machineId：客户端按网卡枚举顺序取第一块非虚拟网卡的 MAC，
 * 脚本按「第一块 Up 的网卡」取 MAC。客服机 PC-20230107AFUW 上两者不一致
 * （…-00ff25fe4260 vs …-0ae0afa217ff），于是台账里多出一行，
 * 「开通远程管理」回传的账号口令落在多出来的那一行上，客户端那一行永远显示未开通。
 */
describe('MachineService.reportMachine 台账归并', () => {
  let service: MachineService;
  let mockPrisma: MockPrisma;

  const clientKey = 'client.machine.pc-20230107afuw-00ff25fe4260';
  const scriptKey = 'client.machine.pc-20230107afuw-0ae0afa217ff';
  const clientRow = {
    key: clientKey,
    value: {
      machineId: 'pc-20230107afuw-00ff25fe4260',
      hostname: 'PC-20230107AFUW',
      primaryIp: '192.168.1.4',
      clientType: 'CS',
      appVersion: '1.0.20260935',
      lastSource: 'cs-client',
    },
  };
  const strayRow = {
    key: scriptKey,
    value: {
      machineId: 'pc-20230107afuw-0ae0afa217ff',
      hostname: 'PC-20230107AFUW',
      primaryIp: '192.168.1.4',
      clientType: 'CS',
      remoteReady: true,
      remoteAccount: 'chunlvops',
      remotePassword: 'OLD',
      lastSource: 'enable-remote',
    },
  };

  const scriptReport = (over: Record<string, unknown> = {}) => ({
    machineId: 'pc-20230107afuw-0ae0afa217ff',
    hostname: 'PC-20230107AFUW',
    primaryIp: '192.168.1.4',
    clientType: 'CS',
    remoteReady: true,
    remoteAccount: 'chunlvops',
    remotePassword: 'Chunlv!b7Tw5abJSDinwJ',
    source: 'enable-remote',
    ...over,
  });

  const upsertArg = () => (mockPrisma.systemConfig.upsert as any).mock.calls[0][0];

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new MachineService(mockPrisma as any);
    vi.clearAllMocks();
    mockPrisma.systemConfig.findUnique.mockImplementation(async ({ where }: any) =>
      where.key === clientKey ? (clientRow as any) : null,
    );
    mockPrisma.systemConfig.findMany.mockResolvedValue([clientRow] as any);
    mockPrisma.systemConfig.upsert.mockResolvedValue({} as any);
  });

  it('脚本算出的那行已经存在：仍然写回客户端那一行（不再各写各的）', async () => {
    mockPrisma.systemConfig.findUnique.mockImplementation(async ({ where }: any) =>
      where.key === clientKey ? (clientRow as any) : where.key === scriptKey ? (strayRow as any) : null,
    );
    mockPrisma.systemConfig.findMany.mockResolvedValue([clientRow, strayRow] as any);

    const res = await service.reportMachine(scriptReport());

    expect(res.machineId).toBe('pc-20230107afuw-00ff25fe4260');
    expect(mockPrisma.systemConfig.upsert).toHaveBeenCalledTimes(1);
    expect(upsertArg().where.key).toBe(clientKey);
    expect(upsertArg().update.value.machineId).toBe('pc-20230107afuw-00ff25fe4260');
    expect(upsertArg().update.value.remoteReady).toBe(true);
    expect(upsertArg().update.value.remoteAccount).toBe('chunlvops');
    expect(upsertArg().update.value.remotePassword).toBe('Chunlv!b7Tw5abJSDinwJ');
  });

  it('脚本先上报、客户端那一行还没有：认领不了就不乱并（自己的 id 照写）', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null as any);
    mockPrisma.systemConfig.findMany.mockResolvedValue([] as any);

    const res = await service.reportMachine(scriptReport());

    expect(res.machineId).toBe('pc-20230107afuw-0ae0afa217ff');
    expect(upsertArg().where.key).toBe(scriptKey);
  });

  it('脚本上报、客户端那一行在但脚本自己的行不存在：认领客户端那一行', async () => {
    const res = await service.reportMachine(scriptReport());

    expect(res.machineId).toBe('pc-20230107afuw-00ff25fe4260');
    expect(upsertArg().where.key).toBe(clientKey);
  });

  it('客户端自己的心跳：永远以自己的 machineId 为准，也不去扫别的行', async () => {
    const res = await service.reportMachine({
      machineId: 'pc-20230107afuw-00ff25fe4260',
      hostname: 'PC-20230107AFUW',
      primaryIp: '192.168.1.4',
      clientType: 'CS',
      appVersion: '1.0.20260936',
      source: 'cs-client',
    });

    expect(res.machineId).toBe('pc-20230107afuw-00ff25fe4260');
    expect(mockPrisma.systemConfig.findMany).not.toHaveBeenCalled();
    expect(upsertArg().update.value.appVersion).toBe('1.0.20260936');
    // 客户端心跳不带 remoteReady，必须保留脚本写进去的「已开通」
    expect(upsertArg().update.value.remoteReady).toBe(false);
  });

  it('主机名一样但 IP 不一样（局域网里 4 台都叫 User-20240831VS）：不许互相认领', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null as any);
    mockPrisma.systemConfig.findMany.mockResolvedValue([
      {
        key: 'client.machine.user-20240831vs-345a60f446b6',
        value: { machineId: 'user-20240831vs-345a60f446b6', hostname: 'User-20240831VS', primaryIp: '192.168.0.125' },
      },
    ] as any);

    const res = await service.reportMachine({
      machineId: 'user-20240831vs-50ebf6ee0d7f',
      hostname: 'User-20240831VS',
      primaryIp: '192.168.0.179',
      clientType: 'COMPANION',
      remoteReady: true,
      source: 'enable-remote',
    });

    expect(res.machineId).toBe('user-20240831vs-50ebf6ee0d7f');
    expect(upsertArg().where.key).toBe('client.machine.user-20240831vs-50ebf6ee0d7f');
  });

  it('拿不到主 IP 就不做归并（宁可多一行，也不要把两台机器合成一台）', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null as any);

    const res = await service.reportMachine({
      machineId: 'pc-20230107afuw-0ae0afa217ff',
      hostname: 'PC-20230107AFUW',
      clientType: 'CS',
      source: 'enable-remote',
    });

    expect(res.machineId).toBe('pc-20230107afuw-0ae0afa217ff');
    expect(mockPrisma.systemConfig.findMany).not.toHaveBeenCalled();
  });

  it('客户端与脚本算出的 IP 不一致（带 VMware 网卡）：主机名唯一时仍认客户端那一行，并删掉脚本多出来的那行', async () => {
    // 实拍 PC-20260409CDBJ：客户端报 192.168.0.140，脚本报 192.168.81.1（VMware 网卡）
    const virtualKey = 'client.machine.pc-20260409cdbj-005056c00008';
    const realKey = 'client.machine.pc-20260409cdbj-00e04c405d73';
    const realRow = {
      key: realKey,
      value: {
        machineId: 'pc-20260409cdbj-00e04c405d73',
        hostname: 'PC-20260409CDBJ',
        primaryIp: '192.168.0.140',
        clientType: 'COMPANION',
        appVersion: '1.0.20260932',
        lastSource: 'companion-client',
      },
    };
    const virtualRow = {
      key: virtualKey,
      value: {
        machineId: 'pc-20260409cdbj-005056c00008',
        hostname: 'PC-20260409CDBJ',
        primaryIp: '192.168.81.1',
        clientType: 'COMPANION',
        lastSource: 'enable-remote',
      },
    };
    mockPrisma.systemConfig.findUnique.mockImplementation(async ({ where }: any) =>
      where.key === virtualKey ? (virtualRow as any) : where.key === realKey ? (realRow as any) : null,
    );
    mockPrisma.systemConfig.findMany.mockResolvedValue([realRow, virtualRow] as any);

    const res = await service.reportMachine({
      machineId: 'pc-20260409cdbj-005056c00008',
      hostname: 'PC-20260409CDBJ',
      primaryIp: '192.168.81.1',
      clientType: 'COMPANION',
      remoteReady: true,
      remoteAccount: 'chunlvops',
      remotePassword: 'Chunlv!abc',
      source: 'enable-remote',
    });

    expect(res.machineId).toBe('pc-20260409cdbj-00e04c405d73');
    expect(upsertArg().where.key).toBe(realKey);
    expect(upsertArg().update.value.remoteReady).toBe(true);
    // 脚本算出来的网卡指纹不许覆盖客户端真实的 IP
    expect(upsertArg().update.value.primaryIp).toBe('192.168.0.140');
    expect(mockPrisma.systemConfig.delete).toHaveBeenCalledTimes(1);
    expect((mockPrisma.systemConfig.delete as any).mock.calls[0][0].where.key).toBe(virtualKey);
  });

  it('主机名一样但不止一条客户端行：不认领（各归各的）', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null as any);
    mockPrisma.systemConfig.findMany.mockResolvedValue([
      {
        key: 'client.machine.pc-a-111111111111',
        value: {
          machineId: 'pc-a-111111111111', hostname: 'PC-A', primaryIp: '192.168.0.10',
          clientType: 'COMPANION', appVersion: '1.0.20260932', lastSource: 'companion-client',
        },
      },
      {
        key: 'client.machine.pc-a-222222222222',
        value: {
          machineId: 'pc-a-222222222222', hostname: 'PC-A', primaryIp: '192.168.0.11',
          clientType: 'COMPANION', appVersion: '1.0.20260932', lastSource: 'companion-client',
        },
      },
    ] as any);

    const res = await service.reportMachine({
      machineId: 'pc-a-333333333333',
      hostname: 'PC-A',
      primaryIp: '192.168.0.12',
      clientType: 'COMPANION',
      source: 'enable-remote',
    });

    expect(res.machineId).toBe('pc-a-333333333333');
    expect(mockPrisma.systemConfig.delete).not.toHaveBeenCalled();
  });
});
