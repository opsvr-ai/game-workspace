// craftsman-ignore: TS001,TS003
import { describe, it, expect } from 'vitest';
import { resolveDepositDeduct } from '../common/deposit-deduct';

// 老板 2026-10-04：「有时候你统计的并不准，以陪玩自己输入的为准吧。」
// 结束服务时从客户存单里扣多少：陪玩填了听陪玩的，没填才用系统计时算的；最多扣到余额为 0。
describe('存单扣款以陪玩填的为准（老板 2026-10-04）', () => {
  it('陪玩填了 → 以他填的为准（跟系统算的不一样也听他的）', () => {
    expect(resolveDepositDeduct({ wanted: 120, autoDeduct: 210, balance: 500 })).toBe(120);
  });

  it('没填 → 用系统按计时算的', () => {
    expect(resolveDepositDeduct({ wanted: undefined, autoDeduct: 210, balance: 500 })).toBe(210);
    expect(resolveDepositDeduct({ wanted: null, autoDeduct: 210, balance: 500 })).toBe(210);
  });

  it('填了个不合法的（负数 / NaN）→ 退回系统算的', () => {
    expect(resolveDepositDeduct({ wanted: -5, autoDeduct: 210, balance: 500 })).toBe(210);
    expect(resolveDepositDeduct({ wanted: NaN, autoDeduct: 210, balance: 500 })).toBe(210);
  });

  it('填 0 → 就是 0（一分不扣），不会被当成没填', () => {
    expect(resolveDepositDeduct({ wanted: 0, autoDeduct: 210, balance: 500 })).toBe(0);
  });

  it('超过存单余额 → 最多扣到余额为 0，不出现负数', () => {
    expect(resolveDepositDeduct({ wanted: 999, autoDeduct: 210, balance: 300 })).toBe(300);
    expect(resolveDepositDeduct({ wanted: undefined, autoDeduct: 210, balance: 300 })).toBe(210);
  });

  it('余额已经是 0 / 负数 → 一分不扣', () => {
    expect(resolveDepositDeduct({ wanted: 120, autoDeduct: 210, balance: 0 })).toBe(0);
    expect(resolveDepositDeduct({ wanted: 120, autoDeduct: 210, balance: -50 })).toBe(0);
  });

  it('金额四舍五入到分', () => {
    expect(resolveDepositDeduct({ wanted: 87.126, autoDeduct: 0, balance: 500 })).toBe(87.13);
    expect(resolveDepositDeduct({ wanted: undefined, autoDeduct: 33.335, balance: 500 })).toBe(33.34);
  });
});
