import { describe, it, expect } from 'vitest';
import { splitRoles, splitAmountYuan, parsePercent } from '../common/order-split';

describe('order-split 一单流水「工作室/店长/客服/陪玩」四个人分（老板 2026-09-21 拍板）', () => {
  it('工作室拿剩下的：陪玩 60 + 客服 5 + 店长 10 → 工作室 25，合计 100%', () => {
    const r = splitRoles({ companion: 60, cs: 5, admin: 10 });
    expect(r).toEqual({ companion: 60, cs: 5, admin: 10, studio: 25 });
    expect(r.companion + r.cs + r.admin + r.studio).toBe(100);
  });

  it('线上俱乐部（没有按比例的客服）：陪玩 80 + 店长 10 → 工作室 10', () => {
    expect(splitRoles({ companion: 80, admin: 10 })).toEqual({ companion: 80, cs: 0, admin: 10, studio: 10 });
  });

  it('谁都没配（陪玩 50、客服 0、店长 0）→ 工作室 50', () => {
    expect(splitRoles({ companion: 50 })).toEqual({ companion: 50, cs: 0, admin: 0, studio: 50 });
  });

  it('加起来超过 100% 直接报错，不允许保存', () => {
    expect(() => splitRoles({ companion: 60, cs: 30, admin: 30 })).toThrow();
    expect(() => splitRoles({ companion: 100, cs: 1 })).toThrow();
    expect(() => splitRoles({ companion: 101 })).toThrow();
  });

  it('刚满 100%（陪玩 70 + 客服 20 + 店长 10）允许，工作室为 0', () => {
    expect(splitRoles({ companion: 70, cs: 20, admin: 10 })).toEqual({ companion: 70, cs: 20, admin: 10, studio: 0 });
  });

  it('金额拆分：1000 元按 60 / 5 / 10 分 → 陪玩 600、客服 50、店长 100、工作室 250', () => {
    const { yuan } = splitAmountYuan(1000, { companion: 60, cs: 5, admin: 10 });
    expect(yuan).toEqual({ total: 1000, companion: 600, cs: 50, admin: 100, studio: 250 });
  });

  it('比例凑满 100% 时四舍五入不留负数、四个人加起来还是这笔钱', () => {
    const { cents } = splitAmountYuan(0.01, { companion: 33.33, cs: 33.33, admin: 33.34 });
    expect(cents.studio).toBeGreaterThanOrEqual(0);
    expect(cents.companion + cents.cs + cents.admin + cents.studio).toBe(cents.total);

    const big = splitAmountYuan(12345.67, { companion: 33.33, cs: 33.33, admin: 33.34 });
    expect(big.cents.studio).toBeGreaterThanOrEqual(0);
    expect(big.cents.companion + big.cents.cs + big.cents.admin + big.cents.studio).toBe(big.cents.total);
  });

  it('金额为 0 / 空值时不出负数', () => {
    expect(splitAmountYuan(0, { companion: 50, admin: 10 }).cents).toEqual({
      total: 0, companion: 0, cs: 0, admin: 0, studio: 0,
    });
  });

  it('parsePercent 只接受 0-100 的数字', () => {
    expect(parsePercent(0, 'x')).toBe(0);
    expect(parsePercent('12.5', 'x')).toBe(12.5);
    expect(() => parsePercent(-1, 'x')).toThrow();
    expect(() => parsePercent('abc', 'x')).toThrow();
    expect(parsePercent(null, 'x')).toBe(0);
    expect(parsePercent(undefined, 'x')).toBe(0);
    expect(() => parsePercent({} as unknown as number, 'x')).toThrow();
  });
});
