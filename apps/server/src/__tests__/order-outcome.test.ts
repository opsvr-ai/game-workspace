// craftsman-ignore: TS001,TS003
import { describe, it, expect } from 'vitest';
import {
  orderChannelOf,
  outcomeOf,
  offlineVisibleAt,
  visibleToOwnOffline,
  normalizePoolScope,
  orderUnits,
  orderGrossYuan,
  isDoubleCompanion,
  outsideViewerVisible,
} from '../common/order-outcome';

/**
 * 老板 2026-09-29 定的「成功 / 不成功 / 待反馈」口径 + 「这张单先给谁」。
 *
 * 原话：「并不是订单派出去了，被抢走了就计算了，被线下抢走的好说，点开始首单就可以
 * 判定这个客户真消费没；线上不好判定，需要接单者给我反馈，比如派给桥接俱乐部一个订单，
 * 对方对陪玩不满意，那么这单就不成功。」
 *
 * 这份文件是**唯一口径**：提成、看板、桥接达标都调它，所以这里把边界钉死。
 */
const STUDIO = 'studio-self';

const ownCompanion = { studioId: STUDIO, studio: { id: STUDIO, type: 'DIRECT' } };
const bridgeCompanion = { studioId: 'studio-other', studio: { id: 'studio-other', type: 'DIRECT' } };
const onlineCompanion = { studioId: 'studio-club', studio: { id: 'studio-club', type: 'RENTAL' } };

describe('订单渠道：线下 / 桥接 / 线上', () => {
  it('本店陪玩接的 = 线下', () => {
    expect(orderChannelOf({ companion: ownCompanion }, STUDIO)).toBe('offline');
  });
  it('别的直营店陪玩接的 = 桥接', () => {
    expect(orderChannelOf({ companion: bridgeCompanion }, STUDIO)).toBe('bridge');
  });
  it('线上俱乐部（租赁店）陪玩接的 = 线上', () => {
    expect(orderChannelOf({ companion: onlineCompanion }, STUDIO)).toBe('online');
  });
});

describe('线下单：点了「开始首单」才算成功', () => {
  it('有会话 startedAt → 成功、算钱', () => {
    const d = outcomeOf(
      { status: 'CONFIRMED', companion: ownCompanion, sessions: [{ startedAt: new Date() }] },
      STUDIO,
    );
    expect(d).toMatchObject({ channel: 'offline', state: 'SUCCESS', counted: true });
  });

  it('已完成的单（历史口径）→ 成功、算钱', () => {
    const d = outcomeOf({ status: 'DONE', companion: ownCompanion, sessions: [] }, STUDIO);
    expect(d).toMatchObject({ state: 'SUCCESS', counted: true });
  });

  it('抢到了但还没点开始首单 → 不算成功、也不算不成功', () => {
    const d = outcomeOf({ status: 'GRABBED', companion: ownCompanion, sessions: [{}] }, STUDIO);
    expect(d).toMatchObject({ state: 'NONE', counted: false });
  });

  it('退款 / 取消的线下单 → 不算，哪怕开过服务', () => {
    const refunded = outcomeOf(
      { status: 'DONE', refundedAt: new Date(), companion: ownCompanion, sessions: [{ startedAt: new Date() }] },
      STUDIO,
    );
    expect(refunded).toMatchObject({ state: 'NONE', counted: false });
    const cancelled = outcomeOf({ status: 'CANCELLED', companion: ownCompanion }, STUDIO);
    expect(cancelled.counted).toBe(false);
  });

  // 老板 2026-10-07：「成功 / 不成功 / 待反馈 的数量都不对把？」
  // 线上实测：10-06 有一张线下单（GRABBED、没开始首单）陪玩报了「不成功 · 听出变声器不打了」，
  // 看板却写着「不成功 0 单、成功率 100%」—— 就是下面这条口径把这种单吞成了「还没开始首单」。
  it('没点开始首单、但接单陪玩报了不成功（带原因）→ 判不成功、不计提成', () => {
    const d = outcomeOf(
      {
        status: 'GRABBED',
        companion: ownCompanion,
        sessions: [],
        outcome: 'FAILED',
        outcomeReason: '听出变声器不打了',
      },
      STUDIO,
    );
    expect(d).toMatchObject({ channel: 'offline', state: 'FAILED', counted: false });
    expect(d.reason).toContain('听出变声器不打了');
  });

  it('没报结果的线下单还是「还没开始首单」，不会被算成不成功', () => {
    const d = outcomeOf({ status: 'GRABBED', companion: ownCompanion, sessions: [] }, STUDIO);
    expect(d).toMatchObject({ state: 'NONE', counted: false });
  });

  it('已经点过开始首单的线下单，就算报表里带了不成功也不改判（提成口径一致、别少发钱）', () => {
    const d = outcomeOf(
      {
        status: 'CONFIRMED',
        companion: ownCompanion,
        sessions: [{ startedAt: new Date() }],
        outcome: 'FAILED',
      },
      STUDIO,
    );
    expect(d).toMatchObject({ state: 'SUCCESS', counted: true });
  });
});

describe('桥接 / 线上单：只有接单方反馈「成功」才算成功', () => {
  it('被抢走了但没反馈 → 待反馈，不计提成', () => {
    const d = outcomeOf({ status: 'DONE', companion: bridgeCompanion }, STUDIO);
    expect(d).toMatchObject({ channel: 'bridge', state: 'PENDING', counted: false });
  });

  it('反馈成功 → 算钱（线上同理）', () => {
    expect(outcomeOf({ status: 'DONE', outcome: 'SUCCESS', companion: bridgeCompanion }, STUDIO)).toMatchObject({
      channel: 'bridge',
      state: 'SUCCESS',
      counted: true,
    });
    expect(outcomeOf({ status: 'CONFIRMED', outcome: 'SUCCESS', companion: onlineCompanion }, STUDIO)).toMatchObject({
      channel: 'online',
      state: 'SUCCESS',
      counted: true,
    });
  });

  it('反馈不成功（客户对陪玩不满意）→ 不算钱，但看得见原因', () => {
    const d = outcomeOf(
      { status: 'DONE', outcome: 'FAILED', outcomeReason: '客户对陪玩不满意', companion: bridgeCompanion },
      STUDIO,
    );
    expect(d).toMatchObject({ state: 'FAILED', counted: false });
  });

  it('反馈成功后又被退款 → 不算钱', () => {
    const d = outcomeOf(
      { status: 'DONE', outcome: 'SUCCESS', refundedAt: new Date(), companion: onlineCompanion },
      STUDIO,
    );
    expect(d.counted).toBe(false);
  });
});

describe('「线上→线下流转」的单：本店线下陪玩什么时候才看得见', () => {
  const created = new Date('2026-09-29T12:00:00Z');

  it('不是「线上→线下流转」→ 一直可见（线下→线上流转本来就是本店线下先看）', () => {
    const order = { poolScope: null, createdAt: created };
    expect(offlineVisibleAt(order, 5)).toBeNull();
    expect(visibleToOwnOffline(order, 5, created.getTime())).toBe(true);
  });

  it('「线上→线下流转」：自动放行时间之前看不见，到点就看得到', () => {
    const order = { poolScope: 'ONLINE_FIRST', createdAt: created };
    const before = created.getTime() + 4 * 60_000;
    const after = created.getTime() + 6 * 60_000;
    expect(visibleToOwnOffline(order, 5, before)).toBe(false);
    expect(visibleToOwnOffline(order, 5, after)).toBe(true);
  });

  it('客服点一下「放给线下」→ 立即可见，不用等自动放行', () => {
    const order = { poolScope: 'ONLINE_FIRST', createdAt: created, releasedToOfflineAt: created };
    expect(visibleToOwnOffline(order, 60, created.getTime())).toBe(true);
  });

  it('配置成 0 分钟 = 立即放给线下', () => {
    const order = { poolScope: 'ONLINE_FIRST', createdAt: created };
    expect(visibleToOwnOffline(order, 0, created.getTime())).toBe(true);
  });

  it('只有 ONLINE_FIRST 会被当成「线上→线下流转」，别的值一律按老口径', () => {
    expect(normalizePoolScope('ONLINE_FIRST')).toBe('ONLINE_FIRST');
    expect(normalizePoolScope('WHATEVER')).toBe('OFFLINE_FIRST');
    expect(normalizePoolScope(undefined)).toBe('OFFLINE_FIRST');
  });
});


describe('单量：单陪算 1 单、双陪算 2 单（老板 2026-09-29）', () => {
  it('有搭档 = 双陪 = 2 单', () => {
    expect(orderUnits({ coCompanionId: 'c2' })).toBe(2);
  });

  it('客服发单时选了「双陪」但还没配搭档，也算 2 单', () => {
    expect(orderUnits({ coCompanionId: null, customFields: { deltaCount: '双' } })).toBe(2);
    expect(isDoubleCompanion({ coCompanionId: null, customFields: { deltaCount: '双' } })).toBe(true);
  });

  it('单陪 = 1 单', () => {
    expect(orderUnits({ coCompanionId: null, customFields: { deltaCount: '单' } })).toBe(1);
    expect(orderUnits({})).toBe(1);
  });
});

describe('流水：（主陪单价 + 搭档单价）× 时长', () => {
  it('2 小时 x 80 = 160', () => {
    expect(orderGrossYuan({ amount: 80, duration: 2 })).toBe(160);
  });
  it('双陪要把搭档那份一起算上，(60 + 60) x 1 = 120', () => {
    expect(orderGrossYuan({ amount: 60, coAmount: 60, duration: 1 })).toBe(120);
  });
  it('没填时长按 1 小时算', () => {
    expect(orderGrossYuan({ amount: 80 })).toBe(80);
  });
});

describe('别家（桥接 / 线上）什么时候才看得见本店的单', () => {
  const created = new Date('2026-09-29T12:00:00Z');
  const base = {
    bridgeDelayMs: 30_000,
    onlineDelayMs: 180_000,
    offlineFirstBridgeMs: 180_000,
    isRentalViewer: false,
  };

  it('线下→线上流转：本店线下先抢 3 分钟，桥接 30 秒也看不见', () => {
    const order = { poolScope: null, createdAt: created };
    expect(outsideViewerVisible(order, base, created.getTime() + 60_000)).toBe(false);
    expect(outsideViewerVisible(order, base, created.getTime() + 181_000)).toBe(true);
  });

  it('线下→线上流转：线上俱乐部和桥接同一个下限（桥接没人接线上马上能接）', () => {
    const order = { poolScope: 'OFFLINE_FIRST', createdAt: created };
    const rental = { ...base, isRentalViewer: true };
    expect(outsideViewerVisible(order, rental, created.getTime() + 181_000)).toBe(true);
    expect(outsideViewerVisible(order, rental, created.getTime() + 60_000)).toBe(false);
  });

  it('线上→线下流转：桥接工作室 + 线上俱乐部秒看到（对外没有等待时间）', () => {
    const order = { poolScope: 'ONLINE_FIRST', createdAt: created };
    expect(outsideViewerVisible(order, base, created.getTime())).toBe(true);
    const rental = { ...base, isRentalViewer: true };
    expect(outsideViewerVisible(order, rental, created.getTime())).toBe(true);
  });

  it('线上→线下流转：5 分钟内本店线下看不见，到点自动放给线下', () => {
    const order = { poolScope: 'ONLINE_FIRST', createdAt: created };
    expect(visibleToOwnOffline(order, 5, created.getTime() + 4 * 60_000)).toBe(false);
    expect(visibleToOwnOffline(order, 5, created.getTime() + 5 * 60_000)).toBe(true);
  });
});
