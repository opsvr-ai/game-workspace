// craftsman-ignore: TS001,TS003
import { describe, it, expect } from 'vitest';
import { companionOrderRevenue } from '../common/order-revenue';

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
