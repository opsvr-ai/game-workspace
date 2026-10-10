/**
 * 订单搜索除了搜客户 / 游戏，也要能搜「原因 / 备注」里的人话（老板 2026-10-11）。
 *
 * 老板问：「这些添加失败的 或者 当时不打的客户 陪玩申请补单的，这些单能筛出来么」——
 * 「客户说不打」「当时在忙不打」这些原因是**陪玩 / 客服自己填的文字**，没有固定选项可筛，
 * 所以搜索框必须能搜到它们（`Order.notes` / `outcomeReason` / `customFields.csContactFailReason`
 * / 补单申请里的 reason），否则只能一页页翻。这里把这几个落点钉住。
 */
import { describe, expect, it } from 'vitest';
import { orderMatchesSearch } from './orderPool';

const base = { id: 'o1', gameName: '三角洲', customFields: {} };

describe('订单搜索：备注 / 失败原因 / 报结果原因 / 补单申请原因', () => {
  it('备注里写了「客户说不打」→ 搜「不打」能命中', () => {
    expect(orderMatchesSearch({ ...base, notes: '客户说不打，先留着' }, '不打')).toBe(true);
  });

  it('陪玩报结果填的原因（outcomeReason）也能搜到', () => {
    expect(orderMatchesSearch({ ...base, outcomeReason: '客户当时在忙不打' }, '不打')).toBe(true);
  });

  it('客服记的「添加失败」原因（customFields.csContactFailReason）也能搜到', () => {
    expect(
      orderMatchesSearch({ ...base, customFields: { csContactFailReason: '好友未通过' } }, '好友'),
    ).toBe(true);
  });

  it('补单申请里写的原因也能搜到（管理端 / 陪玩端那一行都带着）', () => {
    const order = {
      ...base,
      supplementRequests: [{ type: 'REFUND', status: 'PENDING', reason: '转钱了最后不打' }],
    };
    expect(orderMatchesSearch(order, '不打')).toBe(true);
  });

  it('跟这张单无关的词还是不命中（别把不该出的单也捞出来）', () => {
    expect(orderMatchesSearch({ ...base, notes: '客户说不打' }, '小红书')).toBe(false);
  });
});
