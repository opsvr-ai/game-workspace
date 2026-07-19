// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthController } from '../health/health.controller';
import { createMockPrisma, MockPrisma } from '../__mocks__/prisma.mock';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('HealthController', () => {
  let controller: HealthController;
  let mockPrisma: MockPrisma;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    controller = new HealthController(mockPrisma as any);
    vi.clearAllMocks();
  });

  describe('check', () => {
    it('should return ok when database is reachable', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);

      const result = await controller.check();

      expect(result.status).toBe('ok');
      expect(result.db).toBe('ok');
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });

    it('should return error when database query fails', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));

      const result = await controller.check();

      expect(result.status).toBe('error');
      expect(result.db).toBe('error');
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
