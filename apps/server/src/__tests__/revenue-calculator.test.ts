import { describe, it, expect } from 'vitest';
import {
  resolveTier,
  resolveCompanionPctTiered,
  computeSharePct,
  effectiveTenureMonths,
  monthsBetween,
} from '../common/revenue-calculator';

describe('revenue-calculator', () => {
  it('resolves 5200/10000 tiers', () => {
    expect(resolveTier(3000).companion).toBe(50);
    expect(resolveTier(8000).companion).toBe(60);
    expect(resolveTier(12000).companion).toBe(70);
  });

  it('applies tenure gate to top tier', () => {
    expect(resolveCompanionPctTiered(12000, 6)).toBe(70);
    expect(resolveCompanionPctTiered(12000, 5)).toBe(60);
    expect(resolveCompanionPctTiered(8000, 5)).toBe(60);
  });

  it('最高档换成别的数（比如线下的七三）时，没满 6 个月回落的是「下一档」而不是写死的 60', () => {
    const offlineTiers = [
      { min: 0, max: 5199.99, companion: 55 },
      { min: 5200, max: 9999.99, companion: 64 },
      { min: 10000, max: null, companion: 73 },
    ];
    expect(resolveCompanionPctTiered(12000, 6, offlineTiers)).toBe(73);
    expect(resolveCompanionPctTiered(12000, 5, offlineTiers)).toBe(64);
    expect(resolveCompanionPctTiered(8000, 5, offlineTiers)).toBe(64);
  });

  it('老员工勾选 = 豁免 6 个月工龄，直接拿最高档（老板说「到时候我会告诉你谁是满半年」）', () => {
    const fresh = new Date();
    expect(effectiveTenureMonths(fresh, false)).toBe(0);
    expect(effectiveTenureMonths(fresh, true)).toBe(6);
    // 建档满 7 个月又 1 天，才算满 6 个月（少一天不算，避免提前发钱）
    const sevenMonthsAgo = new Date(fresh.getFullYear(), fresh.getMonth() - 7, fresh.getDate());
    expect(monthsBetween(sevenMonthsAgo)).toBe(7);
  });

  it('computes fixed share pct', () => {
    expect(computeSharePct({ splitMode: 'FIXED', monthlyRevenue: 0, revenueShare: 0.7 })).toBe(70);
  });
});
