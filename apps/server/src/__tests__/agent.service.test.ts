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
        downloadUrl: '/api/agent/download/latest',
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
});
