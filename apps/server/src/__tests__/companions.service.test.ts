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

describe('CompanionsService', () => {
  let service: CompanionsService;
  let mockPrisma: MockPrisma;
  let mockRevenueService: ReturnType<typeof createMockRevenueService>;
  let mockAttendanceService: ReturnType<typeof createMockAttendanceService>;
  let mockWechatService: ReturnType<typeof createMockWechatService>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    mockRevenueService = createMockRevenueService();
    mockAttendanceService = createMockAttendanceService();
    mockWechatService = createMockWechatService();
    service = new CompanionsService(
      mockPrisma as any,
      mockRevenueService as any,
      mockAttendanceService as any,
      mockWechatService as any,
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
          user: { select: { username: true, avatar: true, displayName: true } },
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
    it('companion updates own status', async () => {
      const companionUser = {
        id: 'u5',
        username: 'zhangsan',
        role: 'COMPANION' as const,
        studioId: 'studio-1',
        companionId: 'comp-1',
      };

      const updatedCompanion = { id: 'comp-1', status: 'BUSY' };
      mockPrisma.companion.update.mockResolvedValue(updatedCompanion);

      const result = await service.updateStatus('comp-1', 'BUSY', companionUser);

      expect(mockPrisma.companion.update).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: { status: 'BUSY' },
      });
      expect(result).toEqual(updatedCompanion);
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
