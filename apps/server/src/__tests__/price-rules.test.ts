import { describe, it, expect } from 'vitest';
import {
  floorPriceYuan,
  auditAmountCents,
  classifyTransferTotal,
  extraCents,
  isBelowPriceFloor,
  isRenewalSegment,
  partnerUnitPriceYuan,
  priceStatsFloor,
  resolvePriceMode,
  PRICE_STATS_FLOOR,
  PRICE_STATS_FLOOR_RENEWAL,
} from '../common/price-rules';

describe('price-rules', () => {
  it('returns first-order floor prices', () => {
    expect(floorPriceYuan('机密', false)).toBe(35);
    expect(floorPriceYuan('绝密', false)).toBe(45);
  });

  it('returns renewal floor prices', () => {
    // 老板 2026-10-04：「机密续单/复购 40-60 之间是正常的」
    expect(floorPriceYuan('机密', true)).toBe(40);
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

  describe('单价底线统计口径（老板 2026-10-04：只统计不拦单；首单 35/45，续单·复购 40/60）', () => {
    it('首单底线就是 机密 35 / 绝密 45', () => {
      expect(PRICE_STATS_FLOOR['机密']).toBe(35);
      expect(PRICE_STATS_FLOOR['绝密']).toBe(45);
      expect(priceStatsFloor('机密')).toBe(35);
      expect(priceStatsFloor('绝密')).toBe(45);
    });

    it('续单 / 复购底线是 机密 40 / 绝密 60（老板：40-60、60-80 才正常）', () => {
      expect(PRICE_STATS_FLOOR_RENEWAL['机密']).toBe(40);
      expect(PRICE_STATS_FLOOR_RENEWAL['绝密']).toBe(60);
      expect(priceStatsFloor('机密', true)).toBe(40);
      expect(priceStatsFloor('绝密', true)).toBe(60);
    });

    it('哪些算「续单 / 复购」：单子类型 RENEW / REPURCHASE，或这张单第 2 段及以后', () => {
      expect(isRenewalSegment('RENEW')).toBe(true);
      expect(isRenewalSegment('REPURCHASE')).toBe(true);
      expect(isRenewalSegment('NEW', 2)).toBe(true);
      expect(isRenewalSegment('NEW', 3)).toBe(true);
      expect(isRenewalSegment('NEW', 1)).toBe(false);
      expect(isRenewalSegment('NEW')).toBe(false);
      expect(isRenewalSegment('NEW', null)).toBe(false);
    });

    it('模式来源：陪玩填的优先，没填就退回客服发单填的（双陪复购那条路 claimedMode 是空的）', () => {
      expect(resolvePriceMode('绝密', { deltaMission: '机密' })).toBe('绝密');
      expect(resolvePriceMode(null, { deltaMission: '机密' })).toBe('机密');
      expect(resolvePriceMode(undefined, { gameMode: '绝密' })).toBe('绝密');
      expect(resolvePriceMode(null, { deltaMission: '机密', gameMode: '绝密' })).toBe('机密');
      expect(resolvePriceMode(null, {})).toBeNull();
      expect(resolvePriceMode(null, null)).toBeNull();
    });

    it('低于底线才算（等于底线不算）', () => {
      expect(isBelowPriceFloor('机密', 34.9)).toBe(true);
      expect(isBelowPriceFloor('机密', 35)).toBe(false);
      expect(isBelowPriceFloor('绝密', 44)).toBe(true);
      expect(isBelowPriceFloor('绝密', 45)).toBe(false);
    });

    it('续单 / 复购按 40 / 60 判：机密 35 也算低价（老板点名的漏报）', () => {
      expect(isBelowPriceFloor('机密', 35, true)).toBe(true);
      expect(isBelowPriceFloor('机密', 39.9, true)).toBe(true);
      expect(isBelowPriceFloor('机密', 40, true)).toBe(false);
      expect(isBelowPriceFloor('绝密', 45, true)).toBe(true);
      expect(isBelowPriceFloor('绝密', 59, true)).toBe(true);
      expect(isBelowPriceFloor('绝密', 60, true)).toBe(false);
    });

    it('正常区间都不算低价（首单 35-45、续单 / 复购 40-60 / 60-80）', () => {
      for (const p of [35, 40, 45]) expect(isBelowPriceFloor('机密', p)).toBe(false);
      for (const p of [40, 50, 60]) expect(isBelowPriceFloor('机密', p, true)).toBe(false);
      for (const p of [60, 70, 80]) expect(isBelowPriceFloor('绝密', p, true)).toBe(false);
    });

    it('副陪单价 = 副陪这段总价 / 时长（没填时长按 1 小时算）', () => {
      expect(partnerUnitPriceYuan(80, 2)).toBe(40);
      expect(partnerUnitPriceYuan(0, 2)).toBe(0); // 主陪给副陪填 0（老板点名的坑）→ 0，会被判低于底线
      expect(partnerUnitPriceYuan(35, 1)).toBe(35);
      expect(partnerUnitPriceYuan(35, null)).toBe(35);
      expect(partnerUnitPriceYuan(35, 0)).toBe(35);
      expect(partnerUnitPriceYuan(null, 2)).toBeNull();
      expect(partnerUnitPriceYuan(undefined, 2)).toBeNull();
      expect(partnerUnitPriceYuan(Number.NaN, 2)).toBeNull();
    });

    it('未知模式 / 没填单价 → 不算，别误报', () => {
      expect(priceStatsFloor('普通')).toBeUndefined();
      expect(priceStatsFloor(null, true)).toBeUndefined();
      expect(isBelowPriceFloor('普通', 10)).toBe(false);
      expect(isBelowPriceFloor(null, 10)).toBe(false);
      expect(isBelowPriceFloor('机密', null)).toBe(false);
      expect(isBelowPriceFloor('机密', undefined)).toBe(false);
      expect(isBelowPriceFloor('机密', Number.NaN)).toBe(false);
    });
  });
});
