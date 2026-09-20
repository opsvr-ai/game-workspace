// craftsman-ignore: TS001,TS003
import { describe, it, expect } from 'vitest';
import {
  computeEntertainmentFee,
  isEntertainmentFree,
} from '../common/entertainment-fee';

// 娱乐费在老板的系统里只有一个算法（看板 / 工作台 / 搭档结算 / 余额预警共用），
// 这里的用例就是那个算法的说明书。
describe('娱乐费唯一口径', () => {
  it('当日流水达到免单线 → 免费', () => {
    expect(
      computeEntertainmentFee({ minutes: 120, todayRevenue: 300, hourlyRate: 60, freeThreshold: 300 }),
    ).toBe(0);
  });

  it('没到免单线 → 按小时费率折算到分钟', () => {
    expect(
      computeEntertainmentFee({ minutes: 30, todayRevenue: 0, hourlyRate: 60, freeThreshold: 300 }),
    ).toBe(30);
  });

  it('费率为 0（老板线上现在填的就是 0）→ 全免', () => {
    expect(
      computeEntertainmentFee({ minutes: 120, todayRevenue: 0, hourlyRate: 0, freeThreshold: 0 }),
    ).toBe(0);
  });

  it('免单线填 0 表示不设免单线', () => {
    expect(
      computeEntertainmentFee({ minutes: 10, todayRevenue: 99999, hourlyRate: 60, freeThreshold: 0 }),
    ).toBe(10);
  });

  it('金额四舍五入到角', () => {
    // 7 分钟 × ¥50/小时 = ¥5.8333… → ¥5.8
    expect(
      computeEntertainmentFee({ minutes: 7, todayRevenue: 0, hourlyRate: 50, freeThreshold: 0 }),
    ).toBe(5.8);
  });

  it('异常输入不炸（负数分钟 / NaN）', () => {
    expect(computeEntertainmentFee({ minutes: -5, todayRevenue: 0, hourlyRate: 60, freeThreshold: 0 })).toBe(0);
    expect(computeEntertainmentFee({ minutes: NaN, todayRevenue: 0, hourlyRate: 60, freeThreshold: 0 })).toBe(0);
  });

  it('isEntertainmentFree 与扣费口径一致', () => {
    expect(isEntertainmentFree(300, 300)).toBe(true);
    expect(isEntertainmentFree(299, 300)).toBe(false);
    expect(isEntertainmentFree(99999, 0)).toBe(false);
  });
});
