import { describe, it, expect } from 'vitest';
import { businessDayOf, settlementMonthRange, businessDayRange, withinRoundTolerance } from '../common/business-day';

describe('business-day', () => {
  it('assigns before-noon time to previous business day', () => {
    const d = new Date(2026, 7, 2, 11, 30); // Aug 2 11:30
    expect(businessDayOf(d).getDate()).toBe(1);
  });

  it('assigns noon and after to same day', () => {
    const d = new Date(2026, 7, 2, 12, 0);
    expect(businessDayOf(d).getDate()).toBe(2);
  });

  it('computes settlement month range with noon boundary', () => {
    const { start, end } = settlementMonthRange('2026-08');
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(7);
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(12);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(8);
    expect(end.getDate()).toBe(1);
    expect(end.getHours()).toBe(12);
  });

  it('computes a business day range with noon boundary', () => {
    const { start, end } = businessDayRange('2026-08-02');
    expect(start.getHours()).toBe(12);
    expect(start.getDate()).toBe(2);
    expect(end.getHours()).toBe(12);
    expect(end.getDate()).toBe(3);
  });

  it('treats round-length differences within tolerance as ok', () => {
    expect(withinRoundTolerance(60, 80)).toBe(true);
    expect(withinRoundTolerance(60, 95)).toBe(false);
  });
});
