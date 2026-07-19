// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardService } from '../dashboard/dashboard.service';
import { createMockPrisma, MockPrisma } from '../__mocks__/prisma.mock';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function tomorrow() {
  const d = today();
  d.setDate(d.getDate() + 1);
  return d;
}

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-001',
    amount: 100,
    status: 'DONE',
    type: 'NEW',
    companionId: 'comp-001',
    customerId: 'cust-001',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeCompanion(overrides: Record<string, any> = {}) {
  return {
    id: 'comp-001',
    status: 'AVAILABLE',
    monthlyRevenue: 500,
    user: { username: 'companion1' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('DashboardService', () => {
  let service: DashboardService;
  let mockPrisma: MockPrisma;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new DashboardService(mockPrisma as any);
    vi.clearAllMocks();
  });

  // =========================================================================
  // getDashboard()
  // =========================================================================
  describe('getDashboard', () => {
    it('should return studio daily stats with revenue metrics', async () => {
      // Orders done today
      mockPrisma.order.findMany.mockResolvedValueOnce([
        makeOrder({ amount: 100 }),
        makeOrder({ id: 'order-002', amount: 200 }),
      ]);
      // Companions
      mockPrisma.companion.findMany.mockResolvedValueOnce([
        makeCompanion({ status: 'AVAILABLE' }),
        makeCompanion({ id: 'comp-002', status: 'BUSY' }),
        makeCompanion({ id: 'comp-003', status: 'OFFLINE' }),
      ]);
      // Companion time logs
      mockPrisma.companionTimeLog.findMany.mockResolvedValueOnce([]);
      // Monthly ranking companions
      mockPrisma.companion.findMany.mockResolvedValueOnce([makeCompanion({ monthlyRevenue: 500 })]);
      // System config for low warning
      mockPrisma.systemConfig.findUnique.mockResolvedValueOnce({ key: 'revenue.low_warning', value: 300 });
      // Transactions
      mockPrisma.transaction.findMany.mockResolvedValueOnce([]);

      const result = await service.getDashboard('studio-001');

      // Total revenue = 100 + 200 = 300
      expect(result.today.totalRevenue).toBe(300);
      expect(result.today.orderCount).toBe(2);
      expect(result.today.onlineCount).toBe(2);
      expect(result.today.totalCount).toBe(3);
    });

    it('should calculate accept rate correctly', async () => {
      mockPrisma.order.findMany.mockResolvedValueOnce([]);
      // 2 online (AVAILABLE + BUSY), 1 BUSY → accept rate = 50%
      mockPrisma.companion.findMany.mockResolvedValueOnce([
        makeCompanion({ status: 'AVAILABLE' }),
        makeCompanion({ id: 'comp-002', status: 'BUSY' }),
        makeCompanion({ id: 'comp-003', status: 'RESTING' }),
      ]);
      mockPrisma.companionTimeLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.companion.findMany.mockResolvedValueOnce([makeCompanion({ monthlyRevenue: 300 })]);
      mockPrisma.systemConfig.findUnique.mockResolvedValueOnce({ key: 'revenue.low_warning', value: 300 });
      mockPrisma.transaction.findMany.mockResolvedValueOnce([]);

      const result = await service.getDashboard('studio-001');

      // Online count: AVAILABLE + BUSY = 2
      expect(result.today.onlineCount).toBe(2);
      // Accept rate: busy (1) / online (2) * 100 = 50
      expect(result.today.acceptRate).toBe(50);
    });

    it('should handle empty date range (no data)', async () => {
      mockPrisma.order.findMany.mockResolvedValueOnce([]);
      mockPrisma.companion.findMany.mockResolvedValueOnce([]);
      mockPrisma.companionTimeLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.companion.findMany.mockResolvedValueOnce([]);
      mockPrisma.systemConfig.findUnique.mockResolvedValueOnce(null);
      mockPrisma.transaction.findMany.mockResolvedValueOnce([]);

      const result = await service.getDashboard(null);

      expect(result.today.totalRevenue).toBe(0);
      expect(result.today.orderCount).toBe(0);
      expect(result.today.onlineCount).toBe(0);
      expect(result.today.totalCount).toBe(0);
      expect(result.today.acceptRate).toBe(0);
      expect(result.ranking).toHaveLength(0);
      expect(result.alerts).toHaveLength(0);
    });

    it('should return online companion count (AVAILABLE, BUSY, ENTERTAINMENT)', async () => {
      mockPrisma.order.findMany.mockResolvedValueOnce([]);
      mockPrisma.companion.findMany.mockResolvedValueOnce([
        makeCompanion({ status: 'AVAILABLE' }),
        makeCompanion({ id: 'comp-002', status: 'BUSY' }),
        makeCompanion({ id: 'comp-003', status: 'ENTERTAINMENT' }),
        makeCompanion({ id: 'comp-004', status: 'OFFLINE' }),
        makeCompanion({ id: 'comp-005', status: 'RESTING' }),
      ]);
      mockPrisma.companionTimeLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.companion.findMany.mockResolvedValueOnce([makeCompanion({ monthlyRevenue: 500 })]);
      mockPrisma.systemConfig.findUnique.mockResolvedValueOnce(null);
      mockPrisma.transaction.findMany.mockResolvedValueOnce([]);

      const result = await service.getDashboard('studio-001');

      // AVAILABLE, BUSY, ENTERTAINMENT = online (3), OFFLINE not counted
      expect(result.today.onlineCount).toBe(3);
      expect(result.today.totalCount).toBe(5);
    });
  });

  // =========================================================================
  // getTrend()
  // =========================================================================
  describe('getTrend', () => {
    it('should return daily revenue trend for the specified number of days', async () => {
      // Simulate 7 days of orders (each day one order of 50)
      mockPrisma.order.findMany.mockResolvedValue([makeOrder({ amount: 50 })]);

      const result = await service.getTrend('studio-001', 7);

      expect(result).toHaveLength(7);
      // Each day has revenue 50 since we return the same mock for all days
      for (const day of result) {
        expect(day.revenue).toBe(50);
        expect(day.orderCount).toBe(1);
        expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  });

  // =========================================================================
  // getRevenueOverview()
  // =========================================================================
  describe('getRevenueOverview', () => {
    it('should calculate yesterday and monthly revenue', async () => {
      // First 2 calls: order.findMany for yesterday + for monthly
      mockPrisma.order.findMany.mockResolvedValueOnce([makeOrder({ amount: 150 })]);
      mockPrisma.order.findMany.mockResolvedValueOnce([
        makeOrder({ amount: 100, type: 'NEW' }),
        makeOrder({ id: 'o2', amount: 50, type: 'RENEW' }),
      ]);
      mockPrisma.companion.findMany.mockResolvedValueOnce([makeCompanion()]);

      const result = await service.getRevenueOverview('studio-001');

      expect(result.yesterdayRevenue).toBe(150);
      expect(result.monthlyRevenue).toBe(150);
      expect(result.typeBreakdown.NEW).toBe(100);
      expect(result.typeBreakdown.RENEW).toBe(50);
      expect(result.companionRevenue).toHaveLength(1);
      expect(result.companionRevenue[0].revenue).toBe(150);
    });
  });
});
