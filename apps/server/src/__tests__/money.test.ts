import { describe, it, expect } from 'vitest';
import { yuanToCents, centsToYuan, sumCents } from '../common/money';

describe('money', () => {
  it('converts yuan to cents without float error', () => {
    expect(yuanToCents(19.9)).toBe(1990);
    expect(yuanToCents(0.1 + 0.2)).toBe(30);
    expect(yuanToCents(0)).toBe(0);
  });

  it('converts cents back to yuan', () => {
    expect(centsToYuan(1990)).toBe(19.9);
  });

  it('sums integer cents', () => {
    expect(sumCents([1990, 10, 0])).toBe(2000);
  });
});
