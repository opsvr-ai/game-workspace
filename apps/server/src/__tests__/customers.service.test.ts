import { describe, it, expect, beforeEach } from 'vitest';
import { CustomersService } from '../customers/customers.service';
import { NotFoundException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';
import { UserRole } from '@chunlv/shared';

describe('CustomersService', () => {
  let service: CustomersService;
  let mockPrisma: MockPrisma;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new CustomersService(mockPrisma as any);
  });

  describe('findAll', () => {
    it('COMPANION sees only own customers', async () => {
      const companionUser = {
        id: 'u1',
        username: 'zhangsan',
        role: UserRole.COMPANION,
        studioId: 'studio-1',
        companionId: 'comp-1',
      };

      const expectedCustomers = [
        { id: 'c1', wechatId: 'wx1', companionId: 'comp-1' },
      ];

      mockPrisma.customer.findMany.mockResolvedValue(expectedCustomers);

      const result = await service.findAll(companionUser);

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companionId: 'comp-1',
            isDeletedByCustomer: false,
          }),
        }),
      );
      expect(result).toEqual(expectedCustomers);
    });

    it('CS sees studio customers', async () => {
      const csUser = {
        id: 'u2',
        username: 'kefu01',
        role: UserRole.CS,
        studioId: 'studio-1',
        companionId: undefined,
      };

      const expectedCustomers = [
        { id: 'c1', wechatId: 'wx1', studioId: 'studio-1' },
        { id: 'c2', wechatId: 'wx2', studioId: 'studio-1' },
      ];

      mockPrisma.customer.findMany.mockResolvedValue(expectedCustomers);

      const result = await service.findAll(csUser);

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { studioId: 'studio-1' },
        }),
      );
      expect(result).toEqual(expectedCustomers);
    });
  });

  describe('findOne', () => {
    it('returns customer with orders', async () => {
      const customerWithOrders = {
        id: 'c1',
        wechatId: 'wx1',
        companion: { user: { username: 'zhangsan' } },
        orders: [{ id: 'o1', amount: 100 }],
      };

      mockPrisma.customer.findUnique.mockResolvedValue(customerWithOrders);

      const result = await service.findOne('c1');

      expect(mockPrisma.customer.findUnique).toHaveBeenCalledWith({
        where: { id: 'c1' },
        include: {
          companion: {
            include: {
              user: { select: { username: true } },
            },
          },
          orders: {
            orderBy: { createdAt: 'desc' },
            take: 50,
          },
        },
      });
      expect(result).toEqual(customerWithOrders);
    });

    it('throws NotFoundException for missing customer', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        '客户不存在',
      );
    });
  });

  describe('create', () => {
    it('generates customerCode', async () => {
      const dto = {
        wechatId: 'wx-new',
        studioId: 'studio-1',
      };

      const createdCustomer = {
        id: 'c-new',
        customerCode: '1',
        wechatId: 'wx-new',
        studioId: 'studio-1',
        companion: null,
      };

      // 客户编码走 counter.global_code 自增；真实 Prisma 一定返回记录，
      // mock 不设返回值会让 `cfg.value` 直接炸掉。
      mockPrisma.systemConfig.upsert.mockResolvedValue({
        key: 'counter.global_code',
        value: '0',
      });
      mockPrisma.systemConfig.update.mockResolvedValue({
        key: 'counter.global_code',
        value: '1',
      });
      mockPrisma.customer.create.mockResolvedValue(createdCustomer);

      const result = await service.create(dto);

      // Should generate a customerCode from the global counter
      expect(mockPrisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerCode: '1',
            wechatId: 'wx-new',
            studioId: 'studio-1',
          }),
        }),
      );
      expect(result).toEqual(createdCustomer);
    });
  });

  describe('update', () => {
    it('modifies fields', async () => {
      const existingCustomer = { id: 'c1', wechatId: 'wx-old', studioId: 'studio-1' };
      mockPrisma.customer.findUnique.mockResolvedValue(existingCustomer);

      const updatedCustomer = {
        id: 'c1',
        wechatId: 'wx-updated',
        studioId: 'studio-1',
        notes: 'new note',
      };
      mockPrisma.customer.update.mockResolvedValue(updatedCustomer);

      const result = await service.update('c1', {
        wechatId: 'wx-updated',
        notes: 'new note',
      });

      expect(mockPrisma.customer.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' } }),
      );
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({
            wechatId: 'wx-updated',
            notes: 'new note',
          }),
        }),
      );
      expect(result).toEqual(updatedCustomer);
    });
  });

  describe('delete', () => {
    it('removes customer', async () => {
      const existingCustomer = { id: 'c1', wechatId: 'wx1' };
      mockPrisma.customer.findUnique.mockResolvedValue(existingCustomer);
      mockPrisma.customer.delete.mockResolvedValue(existingCustomer);

      const result = await service.delete('c1');

      expect(mockPrisma.customer.findUnique).toHaveBeenCalledWith({
        where: { id: 'c1' },
      });
      expect(mockPrisma.customer.delete).toHaveBeenCalledWith({
        where: { id: 'c1' },
      });
      expect(result).toEqual(existingCustomer);
    });
  });

  describe('reassign', () => {
    it('changes companionId', async () => {
      const existingCustomer = { id: 'c1', wechatId: 'wx1', companionId: 'comp-old' };
      mockPrisma.customer.findUnique.mockResolvedValue(existingCustomer);

      const newCompanion = { id: 'comp-new', billingCode: 'ZXYZ' };
      mockPrisma.companion.findUnique.mockResolvedValue(newCompanion);

      const reassignedCustomer = {
        id: 'c1',
        wechatId: 'wx1',
        companionId: 'comp-new',
        companion: { user: { username: 'lisi' } },
      };
      mockPrisma.customer.update.mockResolvedValue(reassignedCustomer);

      const result = await service.reassign('c1', 'comp-new');

      expect(mockPrisma.customer.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' } }),
      );
      expect(mockPrisma.companion.findUnique).toHaveBeenCalledWith({
        where: { id: 'comp-new' },
      });
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: { companionId: 'comp-new' },
        }),
      );
      expect(result).toEqual(reassignedCustomer);
    });
  });
});
