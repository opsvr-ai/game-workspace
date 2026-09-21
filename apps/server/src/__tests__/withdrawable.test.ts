// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeWithdrawable } from '../common/withdrawable';
import { createMockPrisma } from '../__mocks__/prisma.mock';

// ---------------------------------------------------------------------------
// 可支取余额口径（老板 2026-09-21 拍板）：
//   (当月累计业绩 × 分润比例) − 当月已支取 − 当月待审支取 − 未打存单预留
//   未打存单预留 = 客户存单里还没打完的余额，原样全额扣（不乘分润比例）
// ---------------------------------------------------------------------------
function setup(opts: {
  monthRevenue: number;
  withdrawn?: number;
  pending?: number[];
  deposits?: number[];
  share?: number;
}) {
  const prisma = createMockPrisma();
  prisma.companion.findUnique.mockResolvedValue({
    revenueShare: opts.share ?? 0.5,
    createdAt: new Date(),
    isSeniorStaff: false,
    studio: { splitMode: 'FIXED' },
  } as never);
  prisma.order.aggregate
    .mockResolvedValueOnce({ _sum: { amount: opts.monthRevenue } })
    .mockResolvedValueOnce({ _sum: { amount: opts.monthRevenue } });
  prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: opts.withdrawn ?? 0 } });
  prisma.walletTransaction.findMany.mockImplementation(async (args: any) => {
    const rows = (opts.pending ?? []).map((amount, i) => ({ amount, id: `tx-${i + 1}` }));
    const exclude = args?.where?.id?.not;
    return rows.filter((row) => row.id !== exclude) as never;
  });
  prisma.systemConfig.findUnique.mockResolvedValue(null);
  prisma.customer.findMany.mockResolvedValue(
    (opts.deposits ?? []).map((depositBalance) => ({ depositBalance })) as never,
  );
  return prisma;
}

describe('computeWithdrawable：未打存单预留', () => {
  beforeEach(() => vi.clearAllMocks());

  it('存单没打完的余额原样全额扣，不乘分润比例', async () => {
    const prisma = setup({ monthRevenue: 2000, deposits: [200, 100], share: 0.5 });
    const r = await computeWithdrawable(prisma as unknown as never, 'comp-1');
    expect(r.splitRatio).toBe(50);
    expect(r.depositReserve).toBe(300); // 不是 300 × 50% = 150
    expect(r.withdrawable).toBe(700); // 2000×50% − 0 − 0 − 300
  });

  it('存单全部打完（余额 0）时不预留，业绩全额按比例进可支取', async () => {
    const prisma = setup({ monthRevenue: 1000, deposits: [0], share: 0.5 });
    const r = await computeWithdrawable(prisma as unknown as never, 'comp-1');
    expect(r.depositReserve).toBe(0);
    expect(r.withdrawable).toBe(500);
  });

  it('已支取和待审支取都要扣掉', async () => {
    const prisma = setup({
      monthRevenue: 2000,
      withdrawn: 200,
      pending: [100, 50],
      deposits: [0],
      share: 0.5,
    });
    const r = await computeWithdrawable(prisma as unknown as never, 'comp-1');
    expect(r.approvedWithdrawn).toBe(200);
    expect(r.pendingWithdraw).toBe(150);
    expect(r.withdrawable).toBe(650); // 1000 − 200 − 150
  });

  it('存单押着超过业绩时归零，不出现负数', async () => {
    const prisma = setup({ monthRevenue: 400, deposits: [500], share: 0.5 });
    const r = await computeWithdrawable(prisma as unknown as never, 'comp-1');
    expect(r.depositReserve).toBe(500);
    expect(r.withdrawable).toBe(0);
  });

  it('审核本笔待审支取时可以用 excludeTxId 把它排除掉', async () => {
    const prisma = setup({ monthRevenue: 2000, pending: [300], deposits: [0], share: 0.5 });
    const r = await computeWithdrawable(prisma as unknown as never, 'comp-1', { excludeTxId: 'tx-1' });
    expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 'tx-1' } }) }),
    );
    expect(r.pendingWithdraw).toBe(0);
  });
});
