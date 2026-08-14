import { describe, it, expect } from 'vitest';
import { floorPriceYuan, auditAmountCents, classifyTransferTotal, extraCents } from '../common/price-rules';

describe('price-rules', () => {
  it('returns first-order floor prices', () => {
    expect(floorPriceYuan('机密', false)).toBe(35);
    expect(floorPriceYuan('绝密', false)).toBe(45);
  });

  it('returns renewal floor prices', () => {
    expect(floorPriceYuan('机密', true)).toBe(45);
    expect(floorPriceYuan('绝密', true)).toBe(60);
  });

  it('computes audit amount in cents from filled hours and declared price', () => {
    expect(auditAmountCents(2, 80)).toBe(16000); // 160 元 = 16000 分
    expect(auditAmountCents(1, 80)).toBe(8000);
  });

  it('classifies transfer total against audit amount', () => {
    expect(classifyTransferTotal(16000, 16000)).toBe('OK');
    expect(classifyTransferTotal(8000, 16000)).toBe('SHORT');
    expect(classifyTransferTotal(18000, 16000)).toBe('EXTRA');
  });

  it('computes extra amount', () => {
    expect(extraCents(18000, 16000)).toBe(2000);
    expect(extraCents(16000, 16000)).toBe(0);
  });
});
