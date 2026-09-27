import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { TrafficAccountService } from '../traffic-account/traffic-account.service';

function createPrismaMock() {
  return {
    trafficAccount: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  };
}

describe('TrafficAccountService — 账号归属调整', () => {
  let service: TrafficAccountService;
  let prisma: ReturnType<typeof createPrismaMock>;

  const acc = { id: 'acc-1', studioId: 'studio-1', userId: 'cs-old', nickname: 'XHS-1' };
  const admin = { id: 'admin-1', role: 'ADMIN', studioId: 'studio-1' };

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new TrafficAccountService(prisma as any);
    prisma.trafficAccount.findUnique.mockResolvedValue(acc);
    prisma.trafficAccount.update.mockResolvedValue({ ...acc, userId: 'cs-new' });
  });

  it('店长可以把归属改成本工作室在职客服', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'cs-new', studioId: 'studio-1', resignedAt: null });

    await service.update(admin, 'acc-1', { userId: 'cs-new' });

    expect(prisma.trafficAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { userId: 'cs-new' },
    });
  });

  it('不能转给已离职的员工', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'cs-new', studioId: 'studio-1', resignedAt: new Date() });

    await expect(service.update(admin, 'acc-1', { userId: 'cs-new' })).rejects.toThrow(ForbiddenException);
    expect(prisma.trafficAccount.update).not.toHaveBeenCalled();
  });

  it('不能转给别的工作室的员工', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'cs-new', studioId: 'studio-2', resignedAt: null });

    await expect(service.update(admin, 'acc-1', { userId: 'cs-new' })).rejects.toThrow(ForbiddenException);
  });

  it('客服不能改归属（只能改自己账号的内容）', async () => {
    const cs = { id: 'cs-old', role: 'CS', studioId: 'studio-1' };

    await expect(service.update(cs, 'acc-1', { userId: 'cs-new' })).rejects.toThrow(ForbiddenException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('归属没变时不做校验，也不写 userId', async () => {
    await service.update(admin, 'acc-1', { userId: 'cs-old', nickname: '改名' });

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.trafficAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { nickname: '改名' },
    });
  });
});
