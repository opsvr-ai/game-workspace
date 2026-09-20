import { describe, it, expect } from 'vitest';
import { normalizeShareTiers, parseCompanionPercent } from '../common/percent-split';

describe('percent-split 归一化（老板 2026-09-21：避免超过百分百）', () => {
  it('不传店长 / 客服时，工作室按「100 - 陪玩」算，两栏合计恒为 100%', () => {
    const [t] = normalizeShareTiers([{ min: 0, max: 5999.9, companion: 40, studio: 60 }]);
    expect(t.companion).toBe(40);
    expect(t.studio).toBe(60);
    expect(t.companion! + t.studio!).toBe(100);
  });

  it('客户端把两栏写成 60/60（合计 120%）时，工作室被归一化成 40', () => {
    const [t] = normalizeShareTiers([{ min: 0, max: null, companion: 60, studio: 60 }]);
    expect(t.companion).toBe(60);
    expect(t.studio).toBe(40);
  });

  it('老板填的工作室 55 / 64 / 73 落库时对应的陪玩是 45 / 36 / 27（前端填工作室时自动算好）', () => {
    const tiers = normalizeShareTiers([
      { min: 0, companion: 45 },
      { min: 6000, companion: 36 },
      { min: 10000, companion: 27 },
    ]);
    expect(tiers.map((t) => t.companion)).toEqual([45, 36, 27]);
    expect(tiers.map((t) => t.studio)).toEqual([55, 64, 73]);
  });

  it('保留 min / max / minTenureMonths 等其它字段', () => {
    const [t] = normalizeShareTiers([{ min: 10000, max: null, companion: 70, minTenureMonths: 6 }]);
    expect(t.min).toBe(10000);
    expect(t.max).toBeNull();
    expect(t.minTenureMonths).toBe(6);
    expect(t.studio).toBe(30);
  });

  it('陪玩比例超出 0-100 或不是数字时直接报错，不落库', () => {
    expect(() => normalizeShareTiers([{ companion: 120 }])).toThrow();
    expect(() => normalizeShareTiers([{ companion: -5 }])).toThrow();
    expect(() => normalizeShareTiers([{ companion: 'abc' as unknown as number }])).toThrow();
    expect(() => normalizeShareTiers([{}])).toThrow();
  });

  it('parseCompanionPercent 接受 0 和 100 两个边界', () => {
    expect(parseCompanionPercent(0)).toBe(0);
    expect(parseCompanionPercent(100)).toBe(100);
    expect(parseCompanionPercent('45')).toBe(45);
  });

  it('线上俱乐部的固定比例（80）不受影响，仍是陪玩 80 / 工作室 20', () => {
    const [t] = normalizeShareTiers([{ companion: 80 }]);
    expect(t.companion).toBe(80);
    expect(t.studio).toBe(20);
  });
});

describe('percent-split 四人口径（老板 2026-09-21：流水由 工作室 / 店长 / 客服 / 陪玩 四个人分）', () => {
  it('工作室 = 100 − 陪玩 − 店长 − 客服（店长 / 客服拿的也是工作室那份）', () => {
    const [t] = normalizeShareTiers([{ min: 0, companion: 50 }], 10 + 1);
    expect(t.companion).toBe(50);
    expect(t.studio).toBe(39);
    expect(t.companion + 10 + 1 + t.studio).toBe(100);
  });

  it('线上俱乐部（陪玩 80、店长 5）→ 工作室 15', () => {
    const [t] = normalizeShareTiers([{ companion: 80 }], 5);
    expect(t.companion).toBe(80);
    expect(t.studio).toBe(15);
  });

  it('老板自己填的 studio 会被真实份额覆盖掉（库里存的就是工作室拿到手）', () => {
    const [t] = normalizeShareTiers([{ min: 0, companion: 60, studio: 40 }], 11);
    expect(t.studio).toBe(29);
  });

  it('配错成超过 100% 时算出负数，交给上层四人口径校验报错', () => {
    const [t] = normalizeShareTiers([{ companion: 95 }], 10);
    expect(t.studio).toBe(-5);
  });

  it('deductPercent 传了非数字时按 0 处理，不会算出 NaN', () => {
    const [t] = normalizeShareTiers([{ companion: 60 }], Number('abc'));
    expect(t.studio).toBe(40);
  });
});