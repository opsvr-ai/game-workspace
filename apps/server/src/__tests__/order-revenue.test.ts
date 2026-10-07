// craftsman-ignore: TS001,TS003
import { describe, it, expect } from 'vitest';
import { companionMonthRevenueParts, companionOrderRevenue } from '../common/order-revenue';

// ---------------------------------------------------------------------------
// 陪玩业绩口径（老板 2026-10-07 定稿「口径 A：谁的钱算谁的」）：
//   主陪 = amount（他自己那份「主陪金额」）- 分给其他人的 splits
//   搭档 = coAmount（他自己那份）
//   只出现在 splits 里的跨工作室陪玩 = 他的 split 金额
// 关键回归点：派单时「主陪金额 / 搭档金额」填的本来就是各自那一份，
// 绝不能把搭档的 coAmount 从主陪身上再扣一遍（线上 703 单：主陪 105 / 搭档 150）。
// ---------------------------------------------------------------------------
describe('companionOrderRevenue：口径 A（谁的钱算谁的）', () => {
  it('双陪单：主陪只拿自己的「主陪金额」，不再被扣搭档那份（线上 703 单回归）', () => {
    const order = { amount: 105, coAmount: 150, companionId: 'tong', coCompanionId: 'zhou', customFields: {} };
    expect(companionOrderRevenue(order, 'tong')).toBe(105); // 旧算法会算成 105 - 150 = -45
    expect(companionOrderRevenue(order, 'zhou')).toBe(150);
  });

  it('单陪单：主陪拿全额', () => {
    const order = { amount: 80, coAmount: null, companionId: 'A', coCompanionId: null, customFields: {} };
    expect(companionOrderRevenue(order, 'A')).toBe(80);
  });

  it('splits 里分给别人的钱：主陪要扣掉，被分的人拿到自己的那份', () => {
    const order = {
      amount: 100,
      coAmount: null,
      companionId: 'A',
      coCompanionId: null,
      customFields: { splits: [{ companionId: 'C', amount: 10 }] },
    };
    expect(companionOrderRevenue(order, 'A')).toBe(90);
    expect(companionOrderRevenue(order, 'C')).toBe(10);
  });

  it('双陪 + 搭档又分给别人：主陪不扣搭档，只扣分给第三方的', () => {
    const order = {
      amount: 100,
      coAmount: 40,
      companionId: 'A',
      coCompanionId: 'B',
      customFields: { splits: [{ companionId: 'C', amount: 10 }] },
    };
    expect(companionOrderRevenue(order, 'A')).toBe(90);
    expect(companionOrderRevenue(order, 'B')).toBe(40);
    expect(companionOrderRevenue(order, 'C')).toBe(10);
  });

  it('金额缺失 / 空值都按 0 处理，不返回 NaN', () => {
    const order = { amount: undefined as any, coAmount: undefined as any, companionId: 'A', coCompanionId: 'B', customFields: {} };
    expect(companionOrderRevenue(order, 'A')).toBe(0);
    expect(companionOrderRevenue(order, 'B')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 本月流水拆分（老板 2026-10-08 再确认「只算自己那份」）：
//   陪玩端首页那个大号「本月流水」只能是他自己的钱 —— 他当主陪拿主陪金额、
//   他当搭档拿搭档金额（那是发给他本人的那一份）；**搭档（别人）那份永远不进他的数**。
// ---------------------------------------------------------------------------
describe('companionMonthRevenueParts：本月流水只算自己那份', () => {
  it('双陪单：主陪与搭档各拿各的，两边 total 里都没有对方的钱（线上 703 单回归）', () => {
    const order = { amount: 105, coAmount: 150, companionId: 'tong', coCompanionId: 'zhou', customFields: {} };
    expect(companionMonthRevenueParts([order], 'tong')).toEqual({ total: 105, primary: 105, co: 0, split: 0 });
    expect(companionMonthRevenueParts([order], 'zhou')).toEqual({ total: 150, primary: 0, co: 150, split: 0 });
  });

  it('同一人既当主陪又当搭档：两块相加 = total，互不串号', () => {
    const orders = [
      { amount: 100, coAmount: 40, companionId: 'A', coCompanionId: 'B', customFields: {} },
      { amount: 80, coAmount: 70, companionId: 'B', coCompanionId: 'A', customFields: {} },
    ];
    expect(companionMonthRevenueParts(orders, 'A')).toEqual({ total: 170, primary: 100, co: 70, split: 0 });
    expect(companionMonthRevenueParts(orders, 'B')).toEqual({ total: 120, primary: 80, co: 40, split: 0 });
  });

  it('跨工作室分成：他不在主陪/搭档位上，也照样拿到分给他的那份（split）', () => {
    const orders = [
      { amount: 100, coAmount: null, companionId: 'A', coCompanionId: null, customFields: { splits: [{ companionId: 'C', amount: 10 }] } },
    ];
    expect(companionMonthRevenueParts(orders, 'A')).toEqual({ total: 90, primary: 90, co: 0, split: 0 });
    expect(companionMonthRevenueParts(orders, 'C')).toEqual({ total: 10, primary: 0, co: 0, split: 10 });
  });

  it('拆完的 total 与逐单 companionOrderRevenue 求和完全一致（缓存不会漂）', () => {
    const orders = [
      { amount: 105, coAmount: 150, companionId: 'A', coCompanionId: 'B', customFields: {} },
      { amount: 60, coAmount: null, companionId: 'C', coCompanionId: 'A', customFields: {} },
      { amount: 200, coAmount: 30, companionId: 'D', coCompanionId: 'E', customFields: { splits: [{ companionId: 'A', amount: 25 }] } },
    ];
    for (const id of ['A', 'B', 'C', 'D', 'E']) {
      const sum = orders.reduce((s, o) => s + companionOrderRevenue(o, id), 0);
      expect(companionMonthRevenueParts(orders, id).total).toBe(sum);
    }
  });

  it('跟他无关的单：一分钱都不进（total = 0）', () => {
    const orders = [{ amount: 100, coAmount: 50, companionId: 'A', coCompanionId: 'B', customFields: {} }];
    expect(companionMonthRevenueParts(orders, 'X')).toEqual({ total: 0, primary: 0, co: 0, split: 0 });
    expect(companionMonthRevenueParts([], 'A')).toEqual({ total: 0, primary: 0, co: 0, split: 0 });
  });
});
