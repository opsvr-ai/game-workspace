// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService } from '../agent/agent.service';
import { createMockPrisma, MockPrisma } from '../__mocks__/prisma.mock';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('AgentService', () => {
  let service: AgentService;
  let mockPrisma: MockPrisma;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new AgentService(mockPrisma as any);
    vi.clearAllMocks();
  });

  // =========================================================================
  // getLatestVersion()
  // =========================================================================
  describe('getLatestVersion', () => {
    it('should return latest version and download URL from system config', async () => {
      mockPrisma.systemConfig.findUnique
        .mockResolvedValueOnce({ key: 'agent.latest_version', value: '2.5.0' })
        .mockResolvedValueOnce({ key: 'agent.latest_download_url', value: '/api/agent/download/latest' });

      const result = await service.getLatestVersion();

      expect(result).toEqual({
        version: '2.5.0',
        downloadUrl: '/api/agent/download/latest',
      });
      expect(mockPrisma.systemConfig.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should return defaults when system config is not set', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      const result = await service.getLatestVersion();

      expect(result).toEqual({
        version: '1.0.0',
        downloadUrl: '/uploads/chunlv-latest.zip',
      });
    });
  });

  // =========================================================================
  // getVersionStatus()
  // =========================================================================
  describe('getVersionStatus', () => {
    it('should return version status for all online companions', async () => {
      mockPrisma.systemConfig.findUnique
        .mockResolvedValueOnce({ key: 'agent.latest_version', value: '2.0.0' })
        .mockResolvedValueOnce({ key: 'agent.latest_download_url', value: '/api/agent/download/latest' });

      mockPrisma.companion.findMany.mockResolvedValue([
        {
          id: 'comp-001',
          status: 'BUSY',
          pc: { agentVersion: '2.0.0', lastHeartbeat: new Date() },
          user: { username: 'zhangsan', displayName: '张三' },
        },
        {
          id: 'comp-002',
          status: 'AVAILABLE',
          pc: { agentVersion: '1.5.0', lastHeartbeat: new Date() },
          user: { username: 'lisi', displayName: null },
        },
      ]);

      const result = await service.getVersionStatus();

      expect(result.latestVersion).toBe('2.0.0');
      expect(result.onlineCount).toBe(2);
      expect(result.upToDateCount).toBe(1);
      expect(result.pendingCount).toBe(1);
      expect(result.list).toHaveLength(2);
      expect(result.list[0].isLatest).toBe(true);
      expect(result.list[0].name).toBe('张三');
      expect(result.list[1].isLatest).toBe(false);
      expect(result.list[1].name).toBe('lisi');
    });

    it('should handle companions without pc data (no agent installed)', async () => {
      mockPrisma.systemConfig.findUnique
        .mockResolvedValueOnce({ key: 'agent.latest_version', value: '2.0.0' })
        .mockResolvedValueOnce({ key: 'agent.latest_download_url', value: '/api/agent/download/latest' });

      mockPrisma.companion.findMany.mockResolvedValue([
        {
          id: 'comp-003',
          status: 'AVAILABLE',
          pc: null,
          user: { username: 'wangwu', displayName: null },
        },
      ]);

      const result = await service.getVersionStatus();

      expect(result.list[0].agentVersion).toBe('0.0.0');
      expect(result.list[0].isLatest).toBe(false);
    });
  });

  // =========================================================================
  // resolveUpdateScope() —— 更新名额按店隔离（P0-6）
  // =========================================================================
  describe('resolveUpdateScope', () => {
    it('陪玩账号：按 Companion 档案取所属店', async () => {
      mockPrisma.companion.findUnique.mockResolvedValueOnce({ studioId: 'studio-a' });

      await expect(service.resolveUpdateScope('comp-001')).resolves.toBe('studio-a');
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('客服账号跑陪玩端：Companion 查不到，退回按用户取所属店（别掉进全网共享名额）', async () => {
      // 老板 2026-10-08：孙可馨那台就是这种 —— CS 账号登录陪玩端，
      // 令牌 sub 是用户 id，Companion 查不到 → 以前落到全网共用那一个名额，
      // 一天 600+ 次申请全被别的机器挤掉，包始终下不下来。
      mockPrisma.companion.findUnique.mockResolvedValueOnce(null);
      mockPrisma.user.findUnique.mockResolvedValueOnce({ studioId: 'studio-b' });

      await expect(service.resolveUpdateScope('user-d4e592ed')).resolves.toBe('studio-b');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-d4e592ed' },
        select: { studioId: true },
      });
    });

    it('两边都查不到：退回全网共享名额（保持老行为）', async () => {
      mockPrisma.companion.findUnique.mockResolvedValueOnce(null);
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.resolveUpdateScope('ghost-id')).resolves.toBe('');
    });

    it('未登录的新机器（anon:IP）：不打库，直接给全网共享名额', async () => {
      await expect(service.resolveUpdateScope('anon:1.2.3.4')).resolves.toBe('');
      expect(mockPrisma.companion.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('空身份：同样是全网共享名额', async () => {
      await expect(service.resolveUpdateScope('')).resolves.toBe('');
      expect(mockPrisma.companion.findUnique).not.toHaveBeenCalled();
    });

    it('结果带缓存：10 分钟内再来问不打第二次库', async () => {
      mockPrisma.companion.findUnique.mockResolvedValueOnce({ studioId: 'studio-c' });

      await expect(service.resolveUpdateScope('comp-cache')).resolves.toBe('studio-c');
      await expect(service.resolveUpdateScope('comp-cache')).resolves.toBe('studio-c');
      expect(mockPrisma.companion.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('deploy script generation', () => {
    it('should escape single quotes in remote deploy credentials', () => {
      const script = service.generateRemoteDeployScript({
        targetIPs: ['192.168.1.10'],
        adminUser: 'admin',
        adminPass: "p'$(value)\"",
        serverUrl: 'http://192.168.1.2:3001',
      });

      expect(script).toContain(`$adminUser = 'admin'`);
      expect(script).toContain(`$adminPass = 'p''$(value)"'`);
      expect(script).not.toContain(`$adminPass = "p'$(value)""`);
    });

    it('should reject malformed server URLs when generating scripts', () => {
      const script = service.generateDeployScript('http://192.168.1.2:3001 bad path');

      expect(script).toContain(`$url = 'http://127.0.0.1:3001/api/agent/download/exe'`);
    });
  });
});
