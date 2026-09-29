import { describe, it, expect } from 'vitest';
import { CommissionService } from '../finance/commission.service';
import { PayrollService } from '../payroll/payroll.service';

/**
 * 底薪一律不打折（老板 2026-09-30）。
 *
 * 老板原话：「今日看板上写『桥接没达标：提成 ×50%、底薪 ×80%』，但月底真正结算用的是
 * 『当月桥接 <130 单 → 底薪减半』。两个口径不是一套，客服照着看板算会觉得钱少了。
 * 要不要统一成一套？」→「这个我建议别这样了，扣底薪客服会不愿意的」。
 *
 * 所以这一轮把三处（今日看板 / 月度提成明细 / 工资生成）统一成**一套、且不扣底薪**：
 *   - 底薪永远全额；
 *   - 桥接提成只按本月单价阶梯（<最低单数 1 元/单 → 3 元 → 5 元），不再额外 ×50%；
 *   - 「每日桥接目标」只当看板上的进度统计。
 *
 * 这份测试钉的就是「谁都不会被倒扣」：以前工资生成里未达标会把底薪 ×80%，现在不能了。
 */

const STUDIO = 'st-own';
const CS = 'cs-1';
const MONTH = '2026-09';

const offlineOrder = (over: Record<string, any> = {}) => ({
  id: 'o-1',
  orderCode: 'ON-1',
  type: 'NEW',
  status: 'DONE',
  contactStatus: 'CONTACTED',
  outcome: 'SUCCESS',
  outcomeReason: null,
  refundedAt: null,
  amount: 1000,
  coAmount: null,
  duration: 1,
  coCompanionId: null,
  customFields: {},
  companionId: 'c-1',
  csUserId: CS,
  attributedCsUserId: CS,
  claimedCsUserId: null,
  poolScope: 'OFFLINE_FIRST',
  createdAt: new Date(),
  companion: { studio: { id: STUDIO, type: 'OFFLINE' }, user: { username: 'c1', displayName: '陪玩一' } },
  sessions: [{ startedAt: new Date() }],
  ...over,
});

function makePrisma(configs: Record<string, any>, orders: any[]) {
  return {
    systemConfig: {
      findMany: async ({ where }: any) =>
        Object.entries(configs)
          .filter(([k]) => ((where && where.key && where.key.in) || []).includes(k))
          .map(([key, value]) => ({ key, value })),
    },
    studioConfig: { findMany: async () => [] },
    user: {
      findMany: async () => [{ id: CS, username: 'shaozh', displayName: '邵泽慧', role: 'CS' }],
    },
    order: { findMany: async () => orders },
    csProfile: { findMany: async () => [] },
    payrollConfig: {
      findUnique: async () => ({
        role: 'CS',
        baseSalary: 3000,
        fullAttendanceDays: 4,
        lateDeduction: 0,
        absentDeduction: 0,
      }),
    },
    staffAttendance: { findMany: async () => [] },
    commissionRule: { findMany: async () => [] },
    commissionLedger: { aggregate: async () => ({ _sum: { amount: 0 } }) },
    payrollRecord: { upsert: async ({ create }: any) => ({ id: 'pr-1', ...create }) },
  } as any;
}

describe('底薪不打折 · 一套口径（老板 2026-09-30）', () => {
  it('今日看板：桥接一单没有，也拿全额底薪 + 全额提成', async () => {
    const svc = new CommissionService(makePrisma({ 'commission.cs_daily_bridge_target': 10 }, [offlineOrder()]));
    const data = await svc.getCsCommissionToday(STUDIO);
    const row = data.csList[0] as any;
    // 底薪 3000 ÷ 出勤 27 天 ≈ 111.11，提成 1000×1% = 10 元，不扣任何东西
    expect(row.salaryDaily).toBeCloseTo(111.11, 2);
    expect(row.totalCommission).toBe(10);
    expect(row.todayPay).toBeCloseTo(121.11, 2);
    // 老的「罚后」字段整条没了：不能又是应发又是罚后两个数
    expect(row.commissionAfter).toBeUndefined();
    expect(row.salaryAfter).toBeUndefined();
    // 今天的达标只是统计
    expect(row.bridgeMet).toBe(false);
    expect(row.bridgeTarget).toBe(10);
  });

  it('今日看板 · 本月桥接阶梯：跑不够就停在第一档，只影响单价', async () => {
    const svc = new CommissionService(makePrisma({}, [offlineOrder()]));
    const data = await svc.getCsCommissionToday(STUDIO);
    const row = data.csList[0] as any;
    expect(row.monthBridgeUnits).toBe(0);
    expect(row.bridgeUnitYuan).toBe(1); // 第一档 1 元/单
    expect(row.bridgeMetMonth).toBe(false);
    expect(row.nextTierUnits).toBe(182); // 再跑 182 单升到 3 元/单
    expect(row.nextTierYuan).toBe(3);
    expect((data.config as any).bridgeLadder.minUnits).toBe(130);
    expect((data.config as any).missSalaryRate).toBeUndefined();
    expect((data.config as any).missCommissionRate).toBeUndefined();
  });

  it('月度提成明细：未达标也不再「底薪减半」', async () => {
    const svc = new CommissionService(makePrisma({}, [offlineOrder()]));
    const mine = await svc.getCsMySalary(STUDIO, CS, MONTH);
    const row = mine.row as any;
    expect(row.bridgeMet).toBe(false); // 本月桥接 0 单
    expect(row.baseSalary).toBe(3000);
    expect(row.baseEffective).toBe(3000); // 以前这里是 1500
    expect(mine.config.baseSalary).toBe(3000);
  });

  it('工资生成：整月桥接没到目标，底薪照发全额', async () => {
    // 目标 10 单/日 → 整月门槛 10 × 31 = 310 单；这里一单桥接都没有
    const prisma = makePrisma({ 'commission.cs_daily_bridge_target': 10 }, [offlineOrder()]);
    const rec = await new PayrollService(prisma).generate(STUDIO, MONTH);
    const row = rec.find((r: any) => r.userId === CS) as any;
    expect(row.baseSalary).toBe(3000); // 以前是 3000 × 80% = 2400
    expect(row.bridgeCount).toBe(0);
    expect(row.bridgeTarget).toBe(10);
  });
});
