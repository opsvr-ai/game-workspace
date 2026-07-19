import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { BillingService } from '../billing/billing.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

describe('BillingService', () => {
  let service: BillingService;
  let mockPrisma: MockPrisma;
  let mockTransactionService: {
    createTransaction: ReturnType<typeof vi.fn>;
    approve: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
    batchApprove: ReturnType<typeof vi.fn>;
    batchReject: ReturnType<typeof vi.fn>;
  };
  let mockSettlementService: {
    getProfitLoss: ReturnType<typeof vi.fn>;
    getOverview: ReturnType<typeof vi.fn>;
    runMonthlySettlement: ReturnType<typeof vi.fn>;
    getDailyRevenue: ReturnType<typeof vi.fn>;
    getMonthlyRevenue: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    mockTransactionService = {
      createTransaction: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      batchApprove: vi.fn(),
      batchReject: vi.fn(),
    };
    mockSettlementService = {
      getProfitLoss: vi.fn(),
      getOverview: vi.fn(),
      runMonthlySettlement: vi.fn(),
      getDailyRevenue: vi.fn(),
      getMonthlyRevenue: vi.fn(),
    };
    service = new BillingService(mockPrisma as any, mockTransactionService as any, mockSettlementService as any);
    vi.clearAllMocks();
  });

  // ── Transaction management ──

  describe('createTransaction', () => {
    it('creates a PENDING transaction', async () => {
      const dto = {
        orderId: 'order-1',
        companionId: 'comp-1',
        amount: 100,
        paymentMethod: 'WECHAT',
        screenshotUrl: 'https://img.example.com/1.png',
        paidAt: '2026-06-25T10:00:00Z',
      };

      const mockTx = {
        id: 'tx-1',
        orderId: 'order-1',
        companionId: 'comp-1',
        amount: 100,
        paymentMethod: 'WECHAT',
        screenshotUrl: 'https://img.example.com/1.png',
        status: 'PENDING',
        paidAt: new Date('2026-06-25T10:00:00Z'),
        order: { id: 'order-1', type: 'NEW', amount: 100 },
        companion: { id: 'comp-1', user: { username: 'zhangsan' } },
      };

      mockTransactionService.createTransaction.mockResolvedValue(mockTx);

      const result = await service.createTransaction(dto);

      expect(result).toEqual(mockTx);
      expect(result.status).toBe('PENDING');
      expect(mockTransactionService.createTransaction).toHaveBeenCalledWith(dto);
    });
  });

  describe('approve', () => {
    it('approves transaction and returns result', async () => {
      const transactionId = 'tx-1';
      const reviewerId = 'reviewer-1';

      mockTransactionService.approve.mockResolvedValue({
        id: transactionId,
        status: 'APPROVED',
        reviewedById: reviewerId,
      });

      const result = await service.approve(transactionId, reviewerId);

      expect(result.status).toBe('APPROVED');
      expect(result.reviewedById).toBe(reviewerId);
      expect(mockTransactionService.approve).toHaveBeenCalledWith(transactionId, reviewerId);
    });

    it('throws NotFoundException for missing transaction', async () => {
      mockTransactionService.approve.mockRejectedValue(new NotFoundException('报账记录不存在'));

      await expect(service.approve('nonexistent', 'reviewer-1')).rejects.toThrow(NotFoundException);
      await expect(service.approve('nonexistent', 'reviewer-1')).rejects.toThrow('报账记录不存在');
    });

    it('throws ForbiddenException for already-approved transaction', async () => {
      mockTransactionService.approve.mockRejectedValue(new ForbiddenException('该报账已处理'));

      await expect(service.approve('tx-1', 'reviewer-1')).rejects.toThrow(ForbiddenException);
      await expect(service.approve('tx-1', 'reviewer-1')).rejects.toThrow('该报账已处理');
    });
  });

  describe('reject', () => {
    it('rejects transaction to REJECTED', async () => {
      const transactionId = 'tx-1';
      const reviewerId = 'reviewer-1';

      mockTransactionService.reject.mockResolvedValue({
        id: transactionId,
        status: 'REJECTED',
        reviewedById: reviewerId,
      });

      const result = await service.reject(transactionId, reviewerId);

      expect(result.status).toBe('REJECTED');
      expect(result.reviewedById).toBe(reviewerId);
      expect(mockTransactionService.reject).toHaveBeenCalledWith(transactionId, reviewerId);
    });
  });

  // ── Batch operations ──

  describe('batchApprove', () => {
    it('processes multiple transactions and returns succeeded/failed counts', async () => {
      const ids = ['tx-1', 'tx-2', 'tx-3'];
      const reviewerId = 'reviewer-1';

      mockTransactionService.batchApprove.mockResolvedValue({
        succeeded: 2,
        failed: 1,
        errors: ['tx-2: 该报账已处理'],
      });

      const result = await service.batchApprove(ids, reviewerId);

      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('tx-2');
      expect(result.errors[0]).toContain('该报账已处理');
      expect(mockTransactionService.batchApprove).toHaveBeenCalledWith(ids, reviewerId);
    });
  });

  // ── Revenue statistics ──

  describe('getDailyRevenue', () => {
    it('returns breakdown by order type with correct totals', async () => {
      const studioId = 'studio-1';
      const dateStr = '2026-06-25';

      mockSettlementService.getDailyRevenue.mockResolvedValue({
        date: '2026-06-25',
        studioId: 'studio-1',
        breakdown: {
          NEW: { count: 2, amount: 150 },
          RENEW: { count: 1, amount: 200 },
          REPURCHASE: { count: 0, amount: 0 },
          TIP: { count: 2, amount: 50 },
        },
        totalAmount: 400,
      });

      const result = await service.getDailyRevenue(studioId, dateStr);

      expect(result.date).toBe('2026-06-25');
      expect(result.studioId).toBe(studioId);
      expect(result.breakdown.NEW).toEqual({ count: 2, amount: 150 });
      expect(result.breakdown.RENEW).toEqual({ count: 1, amount: 200 });
      expect(result.breakdown.REPURCHASE).toEqual({ count: 0, amount: 0 });
      expect(result.breakdown.TIP).toEqual({ count: 2, amount: 50 });
      expect(result.totalAmount).toBe(400);
      expect(mockSettlementService.getDailyRevenue).toHaveBeenCalledWith(studioId, dateStr);
    });
  });

  describe('getMonthlyRevenue', () => {
    it('returns companion revenue aggregation', async () => {
      const studioId = 'studio-1';
      const monthStr = '2026-06';

      mockSettlementService.getMonthlyRevenue.mockResolvedValue({
        month: '2026-06',
        studioId: 'studio-1',
        totalAmount: 350,
        companionRevenue: [
          { name: 'zhangsan', amount: 150 },
          { name: 'lisi', amount: 200 },
        ],
      });

      const result = await service.getMonthlyRevenue(studioId, monthStr);

      expect(result.month).toBe('2026-06');
      expect(result.studioId).toBe(studioId);
      expect(result.totalAmount).toBe(350);
      expect(result.companionRevenue).toEqual(
        expect.arrayContaining([
          { name: 'zhangsan', amount: 150 },
          { name: 'lisi', amount: 200 },
        ]),
      );
      expect(mockSettlementService.getMonthlyRevenue).toHaveBeenCalledWith(studioId, monthStr);
    });
  });

  describe('getProfitLoss', () => {
    it('returns revenue minus expenses', async () => {
      const studioId = 'studio-1';

      const now = new Date();
      const expectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      mockSettlementService.getProfitLoss.mockResolvedValue({
        totalRevenue: 5000,
        totalExpense: 1200,
        profit: 3800,
        studioId: 'studio-1',
        month: expectedMonth,
      });

      const result = await service.getProfitLoss(studioId);

      expect(result.totalRevenue).toBe(5000);
      expect(result.totalExpense).toBe(1200);
      expect(result.profit).toBe(3800);
      expect(result.studioId).toBe(studioId);
      expect(result.month).toBe(expectedMonth);
      expect(mockSettlementService.getProfitLoss).toHaveBeenCalledWith(studioId);
    });
  });

  // ── Expense management ──

  describe('createExpense', () => {
    it('creates expense record', async () => {
      const studioId = 'studio-1';
      const dto = {
        category: 'RENT',
        amount: 3000,
        description: 'Monthly office rent',
      };

      const mockExpense = {
        id: 'exp-1',
        studioId,
        category: 'RENT',
        amount: 3000,
        description: 'Monthly office rent',
        date: new Date(),
      };

      mockPrisma.expense.create.mockResolvedValue(mockExpense);

      const result = await service.createExpense(studioId, dto);

      expect(result).toEqual(mockExpense);
      expect(mockPrisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          studioId,
          category: 'RENT',
          amount: 3000,
          description: 'Monthly office rent',
        }),
      });
    });
  });
});
