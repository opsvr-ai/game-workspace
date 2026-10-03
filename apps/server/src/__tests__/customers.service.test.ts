import { describe, it, expect, beforeEach } from 'vitest';
import { CustomersService } from '../customers/customers.service';
import { NotFoundException, ConflictException } from '@nestjs/common';
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
          // 默认只列活跃客户（老板 2026-10-04：封存的收起来）
          where: { studioId: 'studio-1', archivedAt: null },
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
      mockPrisma.order.findMany.mockResolvedValue([]);
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

    // 老板 2026-10-04：客户一直没通过 → 管理端直接删客户。
    // 名下只有「未成交」的僵尸单时，连单一起清掉，否则 RESTRICT 外键会删不掉。
    it('客户只有未成交订单时，连订单一起清掉再删客户', async () => {
      const existingCustomer = { id: 'c1', wechatId: 'wx1' };
      mockPrisma.customer.findUnique.mockResolvedValue(existingCustomer);
      mockPrisma.order.findMany.mockResolvedValue([{ id: 'o1', status: 'GRABBED' }]);
      mockPrisma.transaction.count.mockResolvedValue(0);
      mockPrisma.orderSession.count.mockResolvedValue(0);
      mockPrisma.supplementRequest.count.mockResolvedValue(0);
      mockPrisma.customer.delete.mockResolvedValue(existingCustomer);

      await service.delete('c1');

      expect(mockPrisma.order.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'c1' } });
      expect(mockPrisma.customer.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });

    it('客户已有成交订单时挡住，不动账目', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ id: 'c1', wechatId: 'wx1' });
      mockPrisma.order.findMany.mockResolvedValue([{ id: 'o1', status: 'DONE' }]);

      await expect(service.delete('c1')).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.order.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.customer.delete).not.toHaveBeenCalled();
    });

    it('客户有流水记录时挡住', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ id: 'c1', wechatId: 'wx1' });
      mockPrisma.order.findMany.mockResolvedValue([{ id: 'o1', status: 'GRABBED' }]);
      mockPrisma.transaction.count.mockResolvedValue(1);

      await expect(service.delete('c1')).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.customer.delete).not.toHaveBeenCalled();
    });
  });

  // 老板 2026-10-04：客户一直没通过、小红书也不回 → 封存起来，以后再换陪玩加（不是删除）
  describe('archive / unarchive', () => {
    const admin = {
      id: 'u-admin',
      username: 'boss',
      role: UserRole.ADMIN,
      studioId: 'studio-1',
    };

    it('封存客户：记下时间 / 原因 / 操作人', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ id: 'c1', studioId: 'studio-1', archivedAt: null });
      mockPrisma.customer.update.mockResolvedValue({ id: 'c1' });

      await service.archive('c1', admin as any, '客户一直没通过');

      const arg = mockPrisma.customer.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'c1' });
      expect(arg.data.archivedReason).toBe('客户一直没通过');
      expect(arg.data.archivedByUserId).toBe('u-admin');
      expect(arg.data.archivedAt instanceof Date).toBe(true);
    });

    it('已封存的客户再点封存不重复动', async () => {
      const archived = { id: 'c1', studioId: 'studio-1', archivedAt: new Date() };
      mockPrisma.customer.findUnique.mockResolvedValue(archived);

      const result = await service.archive('c1', admin as any, '再来一次');

      expect(result).toEqual(archived);
      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
    });

    it('解封：清掉封存字段 + 可换陪玩 + 备注留痕', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'c1',
        studioId: 'studio-1',
        archivedAt: new Date(),
        notes: '老备注',
        companionId: 'comp-old',
      });
      mockPrisma.companion.findUnique.mockResolvedValue({ id: 'comp-new', user: { displayName: '李四' } });
      mockPrisma.customer.update.mockResolvedValue({ id: 'c1' });

      await service.unarchive('c1', admin as any, { companionId: 'comp-new' });

      const arg = mockPrisma.customer.update.mock.calls[0][0];
      expect(arg.data.archivedAt).toBeNull();
      expect(arg.data.archivedReason).toBeNull();
      expect(arg.data.archivedByUserId).toBeNull();
      expect(arg.data.companionId).toBe('comp-new');
      expect(String(arg.data.notes)).toContain('老备注');
      expect(String(arg.data.notes)).toContain('解封重试');
      expect(String(arg.data.notes)).toContain('李四');
    });

    it('解封时指定的陪玩不存在 → 报错', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'c1',
        studioId: 'studio-1',
        archivedAt: new Date(),
        companionId: 'comp-old',
      });
      mockPrisma.companion.findUnique.mockResolvedValue(null);

      await expect(
        service.unarchive('c1', admin as any, { companionId: 'ghost' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
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
