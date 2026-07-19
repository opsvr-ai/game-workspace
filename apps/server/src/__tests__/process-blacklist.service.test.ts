// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessBlacklistService } from '../process-blacklist/process-blacklist.service';
import { createMockPrisma, MockPrisma } from '../__mocks__/prisma.mock';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('ProcessBlacklistService', () => {
  let service: ProcessBlacklistService;
  let mockPrisma: MockPrisma;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new ProcessBlacklistService(mockPrisma as any);
    vi.clearAllMocks();
  });

  // =========================================================================
  // addBlacklist()
  // =========================================================================
  describe('addBlacklist', () => {
    it('should create a new blacklist entry', async () => {
      const entry = {
        id: 'bl-1',
        studioId: 's1',
        processName: 'bad.exe',
        processPath: 'C:\\bad.exe',
        isActive: true,
        createdAt: new Date(),
      };
      mockPrisma.processBlacklist.create.mockResolvedValue(entry);

      const result = await service.addBlacklist('s1', 'bad.exe', 'C:\\bad.exe');

      expect(mockPrisma.processBlacklist.create).toHaveBeenCalledWith({
        data: { studioId: 's1', processName: 'bad.exe', processPath: 'C:\\bad.exe' },
      });
      expect(result).toEqual(entry);
    });

    it('should create a blacklist entry without processPath', async () => {
      const entry = {
        id: 'bl-2',
        studioId: 's1',
        processName: 'evil.exe',
        processPath: null,
        isActive: true,
        createdAt: new Date(),
      };
      mockPrisma.processBlacklist.create.mockResolvedValue(entry);

      const result = await service.addBlacklist('s1', 'evil.exe');

      expect(mockPrisma.processBlacklist.create).toHaveBeenCalledWith({
        data: { studioId: 's1', processName: 'evil.exe', processPath: undefined },
      });
      expect(result.processPath).toBeNull();
    });
  });

  // =========================================================================
  // listBlacklist()
  // =========================================================================
  describe('listBlacklist', () => {
    it('should return paginated blacklists filtered by studioId', async () => {
      const items = [{ id: 'bl-1', studioId: 's1', processName: 'bad.exe', isActive: true }];
      mockPrisma.processBlacklist.findMany.mockResolvedValue(items);
      mockPrisma.processBlacklist.count.mockResolvedValue(1);

      const result = await service.listBlacklist('s1', 1, 20);

      expect(mockPrisma.processBlacklist.findMany).toHaveBeenCalledWith({
        where: { studioId: 's1' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(mockPrisma.processBlacklist.count).toHaveBeenCalledWith({ where: { studioId: 's1' } });
      expect(result).toEqual({ items, total: 1, page: 1, pageSize: 20 });
    });

    it('should handle an empty blacklist', async () => {
      mockPrisma.processBlacklist.findMany.mockResolvedValue([]);
      mockPrisma.processBlacklist.count.mockResolvedValue(0);

      const result = await service.listBlacklist('s1');

      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    });
  });

  // =========================================================================
  // addWhitelist()
  // =========================================================================
  describe('addWhitelist', () => {
    it('should create a whitelist entry', async () => {
      const entry = { id: 'wl-1', studioId: 's1', processName: 'chrome.exe', processPath: null, isSystem: false };
      mockPrisma.processWhitelist.create.mockResolvedValue(entry);

      const result = await service.addWhitelist('s1', 'chrome.exe');

      expect(mockPrisma.processWhitelist.create).toHaveBeenCalledWith({
        data: { studioId: 's1', processName: 'chrome.exe', processPath: undefined, isSystem: false },
      });
      expect(result).toEqual(entry);
    });
  });

  // =========================================================================
  // addCompanionOverride()
  // =========================================================================
  describe('addCompanionOverride', () => {
    it('should create a companion override entry', async () => {
      const entry = {
        id: 'ov-1',
        companionId: 'c1',
        processName: 'game.exe',
        processPath: null,
        isActive: true,
        createdAt: new Date(),
      };
      mockPrisma.companionBlacklistOverride.create.mockResolvedValue(entry);

      const result = await service.addCompanionOverride('c1', 'game.exe', 'C:\\game.exe');

      expect(mockPrisma.companionBlacklistOverride.create).toHaveBeenCalledWith({
        data: { companionId: 'c1', processName: 'game.exe', processPath: 'C:\\game.exe' },
      });
      expect(result).toEqual(entry);
    });
  });

  // =========================================================================
  // saveProcessReport()
  // =========================================================================
  describe('saveProcessReport', () => {
    it('should create a process report entry', async () => {
      mockPrisma.companionProcessReport.count.mockResolvedValue(0);
      const report = { id: 'rpt-1', companionId: 'c1', processes: [], totalCount: 5 };
      mockPrisma.companionProcessReport.create.mockResolvedValue(report);

      const processes = [{ name: 'game.exe', pid: 1234 }];
      const result = await service.saveProcessReport('c1', processes, 5);

      expect(mockPrisma.companionProcessReport.create).toHaveBeenCalledWith({
        data: {
          companionId: 'c1',
          processes,
          totalCount: 5,
          reportTime: expect.any(Date),
        },
      });
      expect(result).toEqual(report);
    });

    it('should rotate old reports when count exceeds 50', async () => {
      mockPrisma.companionProcessReport.count.mockResolvedValue(50);
      mockPrisma.companionProcessReport.findMany.mockResolvedValue([{ id: 'old-1' }]);
      mockPrisma.companionProcessReport.create.mockResolvedValue({ id: 'rpt-new', companionId: 'c1', totalCount: 1 });

      await service.saveProcessReport('c1', [], 1);

      // Should delete the oldest report (50 - 49 = 1 to keep 49 existing + 1 new = 50)
      expect(mockPrisma.companionProcessReport.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['old-1'] } },
      });
      expect(mockPrisma.companionProcessReport.create).toHaveBeenCalled();
    });
  });
});
