import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';
import { createMockPrisma, MockPrisma } from '../__mocks__/prisma.mock';
import { WsGateway } from '../ws/ws.gateway';
import { OrderStatus } from '@chunlv/shared';

function createMockWsGateway() {
  return {
    broadcastToStudio: vi.fn(),
    pushOrder: vi.fn(),
  } as unknown as WsGateway;
}

function createMockWorkflowService() {
  return {
    grab: vi.fn(),
    confirm: vi.fn(),
    complete: vi.fn(),
    cancel: vi.fn(),
    completeWithBilling: vi.fn(),
  };
}

function createMockDispatchService() {
  return {
    assign: vi.fn(),
    acceptAssignment: vi.fn(),
    declineAssignment: vi.fn(),
    quickGrab: vi.fn(),
  };
}

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: MockPrisma;
  let wsGateway: ReturnType<typeof createMockWsGateway>;
  let workflowService: ReturnType<typeof createMockWorkflowService>;
  let dispatchService: ReturnType<typeof createMockDispatchService>;

  beforeEach(() => {
    prisma = createMockPrisma();
    wsGateway = createMockWsGateway();
    workflowService = createMockWorkflowService();
    dispatchService = createMockDispatchService();
    service = new OrdersService(prisma as any, wsGateway as any, workflowService as any, dispatchService as any);
    vi.clearAllMocks();
  });

  // ─── create() ───────────────────────────────────────────────

  describe('create', () => {
    const baseDto = {
      type: 'NEW',
      studioId: 'studio-1',
      csUserId: 'cs-1',
      customerId: 'customer-1',
      dispatchType: 'POOL',
      amount: 100,
      gameName: 'LOL',
      isOnline: true,
    };

    it('creates POOL order with status PENDING and null companionId', async () => {
      const created = { id: 'order-1', ...baseDto, status: 'PENDING', companionId: null };
      prisma.order.create.mockResolvedValue(created);

      const result = await service.create(baseDto);

      expect(prisma.order.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companionId: null,
          status: 'PENDING',
          dispatchType: 'POOL',
        }),
        include: { customer: true },
      });
      expect(result.status).toBe('PENDING');
      expect(result.companionId).toBeNull();
      expect(wsGateway.broadcastToStudio).toHaveBeenCalledWith('studio-1', 'order:pool_updated', created);
    });

    it('creates DIRECT order with specified companionId', async () => {
      const dto = { ...baseDto, dispatchType: 'DIRECT', companionId: 'companion-1' };
      const created = { id: 'order-2', ...dto, status: 'PENDING' };
      prisma.order.create.mockResolvedValue(created);

      const result = await service.create(dto);

      expect(prisma.order.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companionId: 'companion-1',
          status: 'PENDING',
          dispatchType: 'DIRECT',
        }),
        include: { customer: true },
      });
      expect(result.companionId).toBe('companion-1');
      // POOL broadcast should NOT be called for DIRECT orders
      expect(wsGateway.broadcastToStudio).not.toHaveBeenCalled();
    });
  });

  // ─── findPool() ─────────────────────────────────────────────

  describe('findPool', () => {
    it('returns only PENDING + POOL + unassigned orders', async () => {
      const poolOrders = [{ id: 'o1', status: 'PENDING', dispatchType: 'POOL', companionId: null }];
      prisma.order.findMany.mockResolvedValue(poolOrders);

      const result = await service.findPool();

      expect(prisma.order.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          status: 'PENDING',
          dispatchType: 'POOL',
        }),
        include: expect.objectContaining({
          customer: expect.any(Object),
        }),
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(poolOrders);
    });
  });

  // ─── grab() ─────────────────────────────────────────────────

  describe('grab', () => {
    const orderId = 'order-1';
    const companionId = 'companion-1';

    it('companion grabs POOL order -> status GRABBED, companionId set', async () => {
      const grabbedOrder = {
        id: orderId,
        status: 'GRABBED' as const,
        companionId,
        studioId: 'studio-1',
      };

      workflowService.grab.mockResolvedValue(grabbedOrder);

      const result = await service.grab(orderId, companionId);

      expect(workflowService.grab).toHaveBeenCalledWith(orderId, companionId);
      expect(result.status).toBe('GRABBED');
      expect(result.companionId).toBe(companionId);
    });

    it('throws ForbiddenException when grabbing non-POOL order', async () => {
      workflowService.grab.mockRejectedValue(new ForbiddenException('只能抢派单池中的订单'));

      await expect(service.grab(orderId, companionId)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when grabbing already-grabbed order', async () => {
      workflowService.grab.mockRejectedValue(new ForbiddenException('该订单已被抢'));

      await expect(service.grab(orderId, companionId)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when grabbing non-existent order', async () => {
      workflowService.grab.mockRejectedValue(new NotFoundException('订单不存在'));

      await expect(service.grab(orderId, companionId)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── state machine validation ───────────────────────────────

  describe('state machine validation', () => {
    it('cannot grab CANCELLED order', async () => {
      workflowService.grab.mockRejectedValue(new ForbiddenException('订单状态不允许此操作'));

      await expect(service.grab('order-1', 'companion-1')).rejects.toThrow(ForbiddenException);
    });

    it('cannot confirm un-grabbed order', async () => {
      workflowService.confirm.mockRejectedValue(new ForbiddenException('订单状态不允许此操作'));

      await expect(service.confirm('order-1', 'companion-1')).rejects.toThrow(ForbiddenException);
    });

    it('cannot complete un-confirmed order', async () => {
      workflowService.complete.mockRejectedValue(new ForbiddenException('订单状态不允许此操作'));

      await expect(service.complete('order-1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── confirm() ──────────────────────────────────────────────

  describe('confirm', () => {
    it('companion confirms their own GRABBED order', async () => {
      const confirmedOrder = {
        id: 'order-1',
        status: OrderStatus.CONFIRMED,
        companionId: 'companion-1',
      };

      workflowService.confirm.mockResolvedValue(confirmedOrder);

      const result = await service.confirm('order-1', 'companion-1');

      expect(workflowService.confirm).toHaveBeenCalledWith('order-1', 'companion-1');
      expect(result.status).toBe(OrderStatus.CONFIRMED);
    });
  });

  // ─── complete() ─────────────────────────────────────────────

  describe('complete', () => {
    it('complete CONFIRMED order -> status DONE', async () => {
      const doneOrder = {
        id: 'order-1',
        status: OrderStatus.DONE,
        companionId: 'companion-1',
      };

      workflowService.complete.mockResolvedValue(doneOrder);

      const result = await service.complete('order-1');

      expect(workflowService.complete).toHaveBeenCalledWith('order-1');
      expect(result.status).toBe(OrderStatus.DONE);
    });
  });

  // ─── cancel() ───────────────────────────────────────────────

  describe('cancel', () => {
    it('cancel PENDING order -> status CANCELLED', async () => {
      const cancelledOrder = {
        id: 'order-1',
        status: OrderStatus.CANCELLED,
        companionId: null,
      };

      workflowService.cancel.mockResolvedValue(cancelledOrder);

      const result = await service.cancel('order-1');

      expect(workflowService.cancel).toHaveBeenCalledWith('order-1');
      expect(result.status).toBe(OrderStatus.CANCELLED);
    });
  });
});
