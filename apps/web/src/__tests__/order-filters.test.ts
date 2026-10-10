/**
 * 「订单管理」筛选栏 —— 每一个标签都能筛（老板 2026-10-11：
 * 「让系统里的每一个标签都能筛选，一步到位 免得天天让你改」）。
 *
 * 这里只测那份唯一的清单（constants/orderFilters.ts）：每个维度都能挑出对应的一行、
 * 多个维度是「都满足才留下」；再钉住「维度名单」，防止以后加标签时漏掉某一类。
 */
import { describe, it, expect } from 'vitest';
import {
  ORDER_FILTER_DIMENSIONS,
  applyOrderTagFilters,
  buildOrderFilterDimensions,
} from '../constants/orderFilters';

const makeOrder = (over: any = {}) => ({
  id: 'o1',
  orderCode: 'A1',
  type: 'NEW',
  status: 'GRABBED',
  dispatchType: 'DIRECT',
  serviceType: 'PLAY_WITH',
  contactStatus: 'added',
  outcome: null,
  customFields: { deltaMission: '机密', deltaCount: '双', urgency: 'later', customerSource: '小红书' },
  supplementRequests: [],
  transfers: [],
  ...over,
});

const all = buildOrderFilterDimensions([]);
const run = (orders: any[], values: Record<string, string>) => applyOrderTagFilters(orders, values, all);

describe('订单管理筛选栏：每一个标签都能筛', () => {
  it('订单类型：首单 / 续单 / 复购 / 打赏各筛各的（顺手钉住「续单」不是「续费」）', () => {
    const orders = [makeOrder({ type: 'NEW' }), makeOrder({ type: 'RENEW' }), makeOrder({ type: 'REPURCHASE' }), makeOrder({ type: 'TIP' })];
    expect(run(orders, { type: 'RENEW' }).map((o) => o.type)).toEqual(['RENEW']);
    const dim = all.find((d) => d.key === 'type')!;
    expect(dim.options.map((o) => o.label)).toEqual(['首单', '续单', '复购', '打赏']);
  });

  it('派单方式 / 服务类型 / 任务类型 / 单双陪 / 打单时间 / 客户来源 都能筛', () => {
    const row = makeOrder();
    const other = makeOrder({
      id: 'o2',
      dispatchType: 'POOL',
      serviceType: 'ESCORT',
      customFields: { deltaMission: '绝密', deltaCount: '单', urgency: 'now', customerSource: '抖音' },
    });
    const orders = [row, other];
    expect(run(orders, { dispatchType: 'DIRECT' })).toEqual([row]);
    expect(run(orders, { serviceType: 'ESCORT' })).toEqual([other]);
    expect(run(orders, { deltaMission: '绝密' })).toEqual([other]);
    expect(run(orders, { deltaCount: '双' })).toEqual([row]);
    expect(run(orders, { urgency: 'later' })).toEqual([row]);
    expect(run(orders, { customerSource: '抖音' })).toEqual([other]);
  });

  it('服务类型 / 打单时间 没填的按默认值算（陪玩 / 立即打），不会被筛漏', () => {
    const bare = makeOrder({ customFields: {} });
    expect(run([bare], { serviceType: 'PLAY_WITH' })).toEqual([bare]);
    expect(run([bare], { urgency: 'now' })).toEqual([bare]);
  });

  it('添加情况 / 报结果：带「还没记 / 待反馈」两个空值档', () => {
    const added = makeOrder({ contactStatus: 'added' });
    const none = makeOrder({ id: 'o2', contactStatus: null });
    const ok = makeOrder({ id: 'o3', outcome: 'SUCCESS' });
    const pending = makeOrder({ id: 'o4', outcome: null });
    expect(run([added, none], { contactStatus: 'added' })).toEqual([added]);
    expect(run([added, none], { contactStatus: 'NONE' })).toEqual([none]);
    expect(run([ok, pending], { outcome: 'SUCCESS' })).toEqual([ok]);
    expect(run([ok, pending], { outcome: 'NONE' })).toEqual([pending]);
  });

  it('补单申请：有申请 / 待审核 / 已同意 / 已驳回', () => {
    const at = (status: string) => makeOrder({ id: `o-${status}`, supplementRequests: [{ status }] });
    const none = makeOrder({ id: 'o-none' });
    const orders = [none, at('PENDING'), at('APPROVED'), at('REJECTED')];
    expect(run(orders, { supplement: 'ANY' }).map((o) => o.id)).toEqual(['o-PENDING', 'o-APPROVED', 'o-REJECTED']);
    expect(run(orders, { supplement: 'APPROVED' }).map((o) => o.id)).toEqual(['o-APPROVED']);
  });

  it('转让记录 / 无人接 也能筛', () => {
    const transferred = makeOrder({ transfers: [{ id: 't1' }] });
    const plain = makeOrder({ id: 'o2' });
    expect(run([transferred, plain], { transfer: 'YES' })).toEqual([transferred]);
    expect(run([transferred, plain], { transfer: 'NO' })).toEqual([plain]);

    const stuck = makeOrder({ id: 'o3', customFields: { poolExpired: true }, companionId: null, contactStatus: null });
    const taken = makeOrder({ id: 'o4' });
    expect(run([stuck, taken], { stuck: 'YES' })).toEqual([stuck]);
    expect(run([stuck, taken], { stuck: 'NO' })).toEqual([taken]);
  });

  it('多个标签一起选 = 都满足才留下；不选 = 全都要', () => {
    const hit = makeOrder({ dispatchType: 'DIRECT', customFields: { deltaCount: '双' } });
    const miss = makeOrder({ id: 'o2', dispatchType: 'POOL', customFields: { deltaCount: '双' } });
    expect(run([hit, miss], { dispatchType: 'DIRECT', deltaCount: '双' })).toEqual([hit]);
    expect(run([hit, miss], {})).toEqual([hit, miss]);
  });

  it('清单钉死：订单表里每一种标签都有一个维度（以后加标签漏了这里会红）', () => {
    expect(ORDER_FILTER_DIMENSIONS.map((d) => d.key)).toEqual([
      'type',
      'dispatchType',
      'serviceType',
      'deltaMission',
      'deltaCount',
      'urgency',
      'contactStatus',
      'outcome',
      'supplement',
      'transfer',
      'stuck',
    ]);
    expect(buildOrderFilterDimensions([]).map((d) => d.key)).toContain('customerSource');
  });
});
