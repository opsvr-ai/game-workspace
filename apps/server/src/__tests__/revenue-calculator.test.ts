import { describe, it, expect } from 'vitest';
import { resolveTier, resolveCompanionPctTiered, computeSharePct } from '../common/revenue-calculator';

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

  it('computes fixed share pct', () => {
    expect(computeSharePct({ splitMode: 'FIXED', monthlyRevenue: 0, revenueShare: 0.7 })).toBe(70);
  });
});
