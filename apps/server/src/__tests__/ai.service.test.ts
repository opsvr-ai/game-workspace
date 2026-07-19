// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiService } from '../ai/ai.service';
import { createMockPrisma, MockPrisma } from '../__mocks__/prisma.mock';

// Mock axios to avoid real HTTP calls
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

import axios from 'axios';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-001',
    type: 'NEW',
    amount: 50,
    status: 'DONE',
    companionId: 'comp-001',
    customerId: 'cust-001',
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('AiService', () => {
  let service: AiService;
  let mockPrisma: MockPrisma;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new AiService(mockPrisma as any);
    vi.clearAllMocks();
    delete process.env.DOUBAO_API_KEY;
  });

  // =========================================================================
  // getAdvice()
  // =========================================================================
  describe('getAdvice', () => {
    it('should return AI advice when API key is set and API succeeds', async () => {
      process.env.DOUBAO_API_KEY = 'test-api-key';
      mockPrisma.order.findMany.mockResolvedValue([
        makeOrder({ type: 'NEW', amount: 100 }),
        makeOrder({ id: 'o2', type: 'RENEW', amount: 200 }),
      ]);
      (axios.post as any).mockResolvedValue({
        data: {
          choices: [{ message: { content: '试试多维护老客户，给他们发优惠券' } }],
        },
      });

      const result = await service.getAdvice('comp-001');

      expect(result.fromAI).toBe(true);
      expect(result.advice).toBe('试试多维护老客户，给他们发优惠券');
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('should return local fallback advice when no API key is set', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        makeOrder({ type: 'NEW', amount: 100 }),
        makeOrder({ id: 'o2', type: 'NEW', amount: 50 }),
      ]);

      const result = await service.getAdvice('comp-001');

      expect(result.fromAI).toBe(false);
      // With 100% new rate (>50%), should suggest reducing new customers
      expect(result.advice).toContain('首单');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should return local fallback when AI API call fails', async () => {
      process.env.DOUBAO_API_KEY = 'test-api-key';
      mockPrisma.order.findMany.mockResolvedValue([makeOrder({ type: 'RENEW', amount: 100 })]);
      (axios.post as any).mockRejectedValue(new Error('Network error'));
      // Suppress console.error in test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.getAdvice('comp-001');

      expect(result.fromAI).toBe(false);
      // RENEW rate is 100%, no tips triggered for this case, returns fallback
      expect(typeof result.advice).toBe('string');
      expect(axios.post).toHaveBeenCalledTimes(1);
      consoleSpy.mockRestore();
    });
  });

  // =========================================================================
  // analyzeCustomer()
  // =========================================================================
  describe('analyzeCustomer', () => {
    it('should return customer analysis with ratings', async () => {
      mockPrisma.customerProfile.findUnique.mockResolvedValue({
        customerId: 'cust-001',
        customNotes: '喜欢打王者',
        preferredTime: '晚上21:00',
        likesTalkative: true,
      });
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'cust-001',
        totalSpent: 500,
      });
      mockPrisma.order.findMany.mockResolvedValue([makeOrder({ type: 'REPURCHASE', customerId: 'cust-001' })]);

      const result = await service.analyzeCustomer('cust-001');

      expect(result.analysis.spendingPower.rating).toBe(5); // totalSpent >= 500
      expect(result.suggestions.bestContactTime).toBe('晚上21:00');
      expect(result.suggestions.recommendedStyle).toBe('活泼型');
    });

    it('should throw NotFoundException when customer does not exist', async () => {
      mockPrisma.customerProfile.findUnique.mockResolvedValue(null);
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      mockPrisma.order.findMany.mockResolvedValue([]);

      await expect(service.analyzeCustomer('ghost')).rejects.toThrow('客户不存在');
    });
  });
});
