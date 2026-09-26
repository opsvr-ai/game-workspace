import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanionsService } from '../companions/companions.service';
import { ForbiddenException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

function createMockRevenueService() {
  return {
    getRanking: vi.fn(),
    getWallet: vi.fn(),
    checkEntertainmentBlocked: vi.fn(),
  };
}

function createMockAttendanceService() {
  return {
    ensureAttendance: vi.fn(),
    finalizeAttendance: vi.fn(),
    getAttendance: vi.fn(),
  };
}

function createMockWechatService() {
  return {
    listWorkWechats: vi.fn(),
    addWorkWechat: vi.fn(),
    bindWechat: vi.fn(),
    unbindWechat: vi.fn(),
  };
}

function createMockExcellenceService() {
  return {
    computeForCompanions: vi.fn().mockResolvedValue(new Map()),
    computeOne: vi.fn().mockResolvedValue({ tier: 'MIDDLE', score: 0 }),
    get: vi.fn(),
  };
}

function createMockBridgeService() {
  return {
    getBridgedStudioIds: vi.fn().mockResolvedValue([]),
  };
}

describe('CompanionsService', () => {
  let service: CompanionsService;
  let mockPrisma: MockPrisma;
  let mockRevenueService: ReturnType<typeof createMockRevenueService>;
  let mockAttendanceService: ReturnType<typeof createMockAttendanceService>;
  let mockWechatService: ReturnType<typeof createMockWechatService>;
  let mockExcellenceService: ReturnType<typeof createMockExcellenceService>;
  let mockBridgeService: ReturnType<typeof createMockBridgeService>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    mockRevenueService = createMockRevenueService();
    mockAttendanceService = createMockAttendanceService();
    mockWechatService = createMockWechatService();
    mockExcellenceService = createMockExcellenceService();
    mockBridgeService = createMockBridgeService();
    const mockStudiosService = {
      resignEmployee: vi.fn().mockResolvedValue({ success: true }),
    };
    service = new CompanionsService(
      mockPrisma as any,
      mockRevenueService as any,
      mockAttendanceService as any,
      mockWechatService as any,
      mockExcellenceService as any,
      mockBridgeService as any,
      mockStudiosService as any,
    );

    // Set up default return values for additional prisma calls used by findAll
    mockPrisma.processKillLog.groupBy.mockResolvedValue([]);
    mockPrisma.processKillLog.findMany.mockResolvedValue([]);
    mockPrisma.order.groupBy.mockResolvedValue([]);
    mockPrisma.order.findMany.mockResolvedValue([]);
  });

  describe('findAll', () => {
    it('returns companions with PC status', async () => {
      const user = {
        id: 'u1',
        username: 'admin',
        role: 'ADMIN' as const,
        studioId: 'studio-1',
      };

      const companions = [
        {
          id: 'comp-1',
          status: 'ONLINE',
          user: { username: 'zhangsan' },
          pc: { currentMode: 'AUTO', isThrottled: false, lastHeartbeat: '2024-01-01T00:00:00Z' },
        },
      ];

      mockPrisma.companion.findMany.mockResolvedValue(companions);

      const result = await service.findAll(user);

      expect(mockPrisma.companion.findMany).toHaveBeenCalledWith({
        where: { studioId: 'studio-1' },
        include: {
          user: { select: { id: true, username: true, avatar: true, displayName: true } },
          pc: { select: { currentMode: true, isThrottled: true, lastHeartbeat: true } },
        },
      });
      // Result is decorated with processStatus and todayOrderCount
      expect(result).toHaveLength(1);
      expect(result[0].processStatus).toBe('NORMAL');
      expect(result[0].todayOrderCount).toBe(0);
    });
  });

  describe('updateStatus', () => {
    it('listPersonnel: 在线状态由服务端按服务器时间判定', async () => {
      const fresh = { lastHeartbeat: new Date(), currentMode: 'ENTERTAINMENT' };
      const stale = { lastHeartbeat: new Date(Date.now() - 10 * 60 * 1000), currentMode: null };
      const base = {
        username: 'zhangsan',
        role: 'COMPANION',
        displayName: '张三',
        avatar: null,
        isAuthorized: true,
        resignedAt: null,
        studio: { id: 'studio-1', name: '店', type: 'OWN' },
      };
      const companionRow = (pc: any, status = 'AVAILABLE') => ({
        ...base,
        id: 'u-comp',
        companion: {
          id: 'comp-1',
          status,
          games: [],
          realName: null,
          phone: null,
          monthlyRevenue: 0,
          isResigned: false,
          isSeniorStaff: false,
          pc,
        },
      });
      const owner = { id: 'u-owner', username: 'hanlei', role: 'OWNER', studioId: null };

      // 心跳新鲜 = 在线
      mockPrisma.user.findMany.mockResolvedValue([companionRow(fresh)]);
      const [online] = await service.listPersonnel(owner);
      expect(online.isOnline).toBe(true);

      // 心跳过期 = 离线（即使状态还写着空闲）
      mockPrisma.user.findMany.mockResolvedValue([companionRow(stale)]);
      const [offline] = await service.listPersonnel(owner);
      expect(offline.isOnline).toBe(false);

      // 没有心跳（老数据/没装客户端）时退回工作状态
      mockPrisma.user.findMany.mockResolvedValue([companionRow(null)]);
      const [byStatus] = await service.listPersonnel(owner);
      expect(byStatus.isOnline).toBe(true);

      // 客服：客户端心跳新鲜 = 在线，过期 = 离线
      const csRow = { ...base, id: 'cs-1', username: 'kefu01', role: 'CS', companion: null };
      mockPrisma.user.findMany.mockResolvedValue([csRow]);
      mockPrisma.systemConfig.findMany.mockResolvedValue([
        { key: 'cs.client.version.cs-1', value: { version: '1.0.0', lastSeen: new Date().toISOString() } },
      ]);
      const [csOnline] = await service.listPersonnel(owner);
      expect(csOnline.isOnline).toBe(true);

      mockPrisma.systemConfig.findMany.mockResolvedValue([
        {
          key: 'cs.client.version.cs-1',
          value: { version: '1.0.0', lastSeen: new Date(Date.now() - 30 * 60 * 1000).toISOString() },
        },
      ]);
      const [csOffline] = await service.listPersonnel(owner);
      expect(csOffline.isOnline).toBe(false);
    });

    it('companion switches own status to a non-BUSY mode', async () => {
      const companionUser = {
        id: 'u5',
        username: 'zhangsan',
        role: 'COMPANION' as const,
        studioId: 'studio-1',
        companionId: 'comp-1',
      };

      mockPrisma.companionPC.upsert.mockResolvedValue({ id: 'pc-1' });
      mockPrisma.companion.findUnique.mockResolvedValue({ status: 'AVAILABLE' });
      mockPrisma.orderSession.findFirst.mockResolvedValue(null);
      mockPrisma.companionTimeLog.findFirst.mockResolvedValue(null);
      mockPrisma.companionTimeLog.create.mockResolvedValue({ id: 'log-1' });

      const updatedCompanion = { id: 'comp-1', status: 'ENTERTAINMENT' };
      mockPrisma.companion.update.mockResolvedValue(updatedCompanion);

      const result = await service.updateStatus('comp-1', 'ENTERTAINMENT', companionUser);

      expect(mockPrisma.companion.update).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: { status: 'ENTERTAINMENT' },
      });
      expect(result).toEqual(updatedCompanion);
    });

    it('rejects a manual switch to BUSY (接单状态只能由开始服务进入)', async () => {
      const companionUser = {
        id: 'u5',
        username: 'zhangsan',
        role: 'COMPANION' as const,
        studioId: 'studio-1',
        companionId: 'comp-1',
      };

      mockPrisma.companionPC.upsert.mockResolvedValue({ id: 'pc-1' });
      mockPrisma.companion.findUnique.mockResolvedValue({ status: 'AVAILABLE' });

      await expect(service.updateStatus('comp-1', 'BUSY', companionUser)).rejects.toThrow(
        '接单状态由开始服务自动进入，无法手动切换',
      );
      expect(mockPrisma.companion.update).not.toHaveBeenCalled();
    });

    it("throws ForbiddenException when updating other's status", async () => {
      const otherUser = {
        id: 'u3',
        username: 'admin',
        role: 'ADMIN' as const,
        studioId: 'studio-1',
        companionId: undefined,
      };

      await expect(service.updateStatus('comp-1', 'BUSY', otherUser)).rejects.toThrow(ForbiddenException);

      await expect(service.updateStatus('comp-1', 'BUSY', otherUser)).rejects.toThrow('只能更新自己的状态');

      // Also test a user with a different companionId
      const otherCompanionUser = {
        id: 'u4',
        username: 'lisi',
        role: 'COMPANION' as const,
        studioId: 'studio-1',
        companionId: 'comp-2',
      };

      await expect(service.updateStatus('comp-1', 'BUSY', otherCompanionUser)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getRanking', () => {
    it('returns top 10 companions by revenue score', async () => {
      mockRevenueService.getRanking.mockResolvedValue([
        { name: 'Zhang San', totalAmount: 300, totalCount: 2, score: 300 },
        { name: 'lisi', totalAmount: 0, totalCount: 0, score: 0 },
      ]);

      const result = await service.getRanking('studio-1', 'revenue');

      expect(mockRevenueService.getRanking).toHaveBeenCalledWith('studio-1', 'revenue');
      expect(result).toHaveLength(2);
      expect(result[0].totalAmount).toBe(300);
      expect(result[0].totalCount).toBe(2);
      expect(result[0].score).toBe(300);
    });
  });

  describe('getRevenue', () => {
    it('aggregates approved transactions', async () => {
      const transactions = [
        { id: 't1', companionId: 'comp-1', amount: 100, status: 'APPROVED' },
        { id: 't2', companionId: 'comp-1', amount: 200, status: 'APPROVED' },
        { id: 't3', companionId: 'comp-1', amount: 50, status: 'APPROVED' },
      ];

      mockPrisma.transaction.findMany.mockResolvedValue(transactions);

      const result = await service.getRevenue('comp-1');

      expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith({
        where: { companionId: 'comp-1', status: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      expect(result).toEqual({
        companionId: 'comp-1',
        transactions,
        total: 350,
      });
    });
  });
});
