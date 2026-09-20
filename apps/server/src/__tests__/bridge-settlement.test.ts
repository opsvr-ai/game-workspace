import { describe, expect, it, vi } from 'vitest';
import { BridgeService } from '../studios/bridge.service';
import {
  bridgeDirection,
  groupByPeer,
  roundYuan,
  summarizeBridge,
  type BridgeSettlementRow,
} from '../studios/bridge-settlement.util';

const row = (over: Partial<BridgeSettlementRow>): BridgeSettlementRow => ({
  direction: 'INBOUND',
  role: 'PRIMARY',
  orderId: 'o',
  orderCode: 'C1',
  gameName: 'LOL',
  createdAt: '2026-09-10T04:00:00.000Z',
  finishedAt: null,
  customerCode: '1',
  customerWechat: 'wx',
  publisherStudioId: 'A',
  publisherStudioName: '蠢驴电竞',
  companionId: 'c',
  companionName: '小王',
  companionStudioId: 'B',
  companionStudioName: '光耀电竞',
  peerStudioId: 'B',
  peerStudioName: '光耀电竞',
  amount: 100,
  companionPct: 50,
  companionShare: 50,
  studioShare: 50,
  ...over,
});

describe('bridgeDirection：一笔单对「我店」是应付还是应收', () => {
  it('我店发的单 + 对方店陪玩接 = 我应付（INBOUND）', () => {
    expect(bridgeDirection({ myStudioId: 'A', orderStudioId: 'A', companionStudioId: 'B' })).toBe('INBOUND');
  });

  it('对方店发的单 + 我店陪玩接 = 我应收（OUTBOUND）', () => {
    expect(bridgeDirection({ myStudioId: 'A', orderStudioId: 'B', companionStudioId: 'A' })).toBe('OUTBOUND');
  });

  it('本店单 + 本店陪玩 = 正常单，不算桥接', () => {
    expect(bridgeDirection({ myStudioId: 'A', orderStudioId: 'A', companionStudioId: 'A' })).toBeNull();
  });

  it('别家跟别家之间的单，与我店无关', () => {
    expect(bridgeDirection({ myStudioId: 'A', orderStudioId: 'B', companionStudioId: 'C' })).toBeNull();
  });

  it('字段缺失时不算桥接（宁可不报数，也不报错数）', () => {
    expect(bridgeDirection({ myStudioId: 'A', orderStudioId: null, companionStudioId: 'B' })).toBeNull();
    expect(bridgeDirection({ myStudioId: '', orderStudioId: 'A', companionStudioId: 'B' })).toBeNull();
    expect(bridgeDirection({ myStudioId: 'A', orderStudioId: 'A', companionStudioId: undefined })).toBeNull();
  });
});

describe('summarizeBridge：应付 / 应收 / 净额', () => {
  it('应付 = 对方陪我店的单之和，应收 = 我陪对方店的单之和，净额 = 应收 − 应付', () => {
    const totals = summarizeBridge([
      row({ direction: 'INBOUND', companionShare: 500, amount: 1000 }),
      row({ direction: 'INBOUND', companionShare: 150.5, amount: 301 }),
      row({ direction: 'OUTBOUND', companionShare: 400, amount: 800 }),
    ]);
    expect(totals.inboundCount).toBe(2);
    expect(totals.inboundAmount).toBe(1301);
    expect(totals.payable).toBe(650.5);
    expect(totals.outboundCount).toBe(1);
    expect(totals.outboundAmount).toBe(800);
    expect(totals.receivable).toBe(400);
    expect(totals.net).toBe(-250.5);
  });

  it('没有单时全是 0（不显示 NaN）', () => {
    const totals = summarizeBridge([]);
    expect(totals).toEqual({
      inboundCount: 0,
      inboundAmount: 0,
      payable: 0,
      outboundCount: 0,
      outboundAmount: 0,
      receivable: 0,
      net: 0,
    });
  });
});

describe('groupByPeer：一家店一笔账', () => {
  it('按对方工作室分开累加，净额取绝对值大的在前', () => {
    const rows = [
      row({ peerStudioId: 'B', peerStudioName: '光耀', direction: 'INBOUND', companionShare: 100 }),
      row({ peerStudioId: 'B', peerStudioName: '光耀', direction: 'OUTBOUND', companionShare: 30 }),
      row({ peerStudioId: 'C', peerStudioName: '光耀分店', direction: 'OUTBOUND', companionShare: 900 }),
    ];
    const peers = groupByPeer(rows);
    expect(peers.map((p) => p.peerStudioId)).toEqual(['C', 'B']);
    const b = peers.find((p) => p.peerStudioId === 'B')!;
    expect(b.payable).toBe(100);
    expect(b.payableCount).toBe(1);
    expect(b.receivable).toBe(30);
    expect(b.net).toBe(-70);
  });
});

describe('roundYuan：对账要能一分一分对上', () => {
  it('四舍五入到两位', () => {
    expect(roundYuan(0.1 + 0.2)).toBe(0.3);
    expect(roundYuan(333.333)).toBe(333.33);
    expect(roundYuan(Number.NaN)).toBe(0);
  });
});

// ── 服务层：把当月真单摆出来，验证两向金额 ──
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);

const companion = (id: string, studioId: string, over: Record<string, any> = {}) => ({
  id,
  createdAt: daysAgo(10),
  isSeniorStaff: false,
  revenueShare: 0.5,
  user: { username: id, displayName: id },
  studio: { id: studioId, name: studioId === 'A' ? '蠢驴电竞' : '光耀电竞', splitMode: 'TIERED' },
  ...over,
});

function makeService(opts: {
  orders: any[];
  monthOrders: any[];
  companions: any[];
  systemConfigs?: Array<{ key: string; value: any }>;
}) {
  const prisma: any = {
    studioBridge: {
      findMany: vi.fn(async () => [{ studioAId: 'A', studioBId: 'B', status: 'ACTIVE' }]),
    },
    // 第一次查「我店 + 桥接店的单」，第二次查「这些人的当月全部流水」
    order: {
      findMany: vi.fn(async (args: any) =>
        args?.where?.studioId ? opts.orders : opts.monthOrders,
      ),
    },
    companion: { findMany: vi.fn(async () => opts.companions) },
    systemConfig: { findMany: vi.fn(async () => opts.systemConfigs || []) },
    studioConfig: { findMany: vi.fn(async () => []) },
  };
  return new BridgeService(prisma);
}

describe('settlementStats：桥接往来对账', () => {
  it('对方陪我店的单算我应付、我陪对方店的单算我应收，本店单不算', async () => {
    const service = makeService({
      orders: [
        // 我店（A）发的单，被对方店（B）陪玩 cB1 抢走 → 我应付 1000×50% = 500
        {
          id: 'o1', orderCode: 'P001', gameName: 'LOL', amount: 1000, coAmount: null,
          companionId: 'cB1', coCompanionId: null, customFields: {},
          studioId: 'A', createdAt: daysAgo(3),
          studio: { id: 'A', name: '蠢驴电竞' }, customer: { customerCode: '1', wechatId: 'wx1' },
          sessions: [{ endedAt: daysAgo(3) }],
        },
        // 对方店（B）发的单，被我店陪玩 cA1 抢走 → 我应收 800×50% = 400
        {
          id: 'o2', orderCode: 'P002', gameName: '王者', amount: 800, coAmount: null,
          companionId: 'cA1', coCompanionId: null, customFields: {},
          studioId: 'B', createdAt: daysAgo(2),
          studio: { id: 'B', name: '光耀电竞' }, customer: { customerCode: '2', wechatId: 'wx2' },
          sessions: [{ endedAt: daysAgo(2) }],
        },
        // 我店发的单，本店主陪 + 对方店搭档（coAmount 300）→ 对方搭档那份算我应付 150
        {
          id: 'o3', orderCode: 'P003', gameName: 'CF', amount: 1000, coAmount: 300,
          companionId: 'cA2', coCompanionId: 'cB2', customFields: {},
          studioId: 'A', createdAt: daysAgo(1),
          studio: { id: 'A', name: '蠢驴电竞' }, customer: { customerCode: '3', wechatId: 'wx3' },
          sessions: [{ endedAt: daysAgo(1) }],
        },
        // 我店发的单，本店主陪 + 对方店陪玩只参与分成（splits 200）→ 我应付 100
        {
          id: 'o4', orderCode: 'P004', gameName: 'CS', amount: 900, coAmount: null,
          companionId: 'cA3', coCompanionId: null,
          customFields: { splits: [{ companionId: 'cB3', amount: 200 }] },
          studioId: 'A', createdAt: daysAgo(1),
          studio: { id: 'A', name: '蠢驴电竞' }, customer: { customerCode: '4', wechatId: 'wx4' },
          sessions: [{ endedAt: daysAgo(1) }],
        },
        // 我店纯自己单：不算桥接
        {
          id: 'o5', orderCode: 'P005', gameName: 'DNF', amount: 500, coAmount: null,
          companionId: 'cA4', coCompanionId: null, customFields: {},
          studioId: 'A', createdAt: daysAgo(1),
          studio: { id: 'A', name: '蠢驴电竞' }, customer: { customerCode: '5', wechatId: 'wx5' },
          sessions: [{ endedAt: daysAgo(1) }],
        },
      ],
      monthOrders: [
        { amount: 1000, coAmount: null, companionId: 'cB1', coCompanionId: null, customFields: {} },
        { amount: 800, coAmount: null, companionId: 'cA1', coCompanionId: null, customFields: {} },
        { amount: 1000, coAmount: 300, companionId: 'cA2', coCompanionId: 'cB2', customFields: {} },
        { amount: 900, coAmount: null, companionId: 'cA3', coCompanionId: null, customFields: {} },
        { amount: 500, coAmount: null, companionId: 'cA4', coCompanionId: null, customFields: {} },
      ],
      companions: [
        companion('cB1', 'B'), companion('cB2', 'B'), companion('cB3', 'B'),
        companion('cA1', 'A'), companion('cA2', 'A'), companion('cA3', 'A'), companion('cA4', 'A'),
      ],
    });

    const res: any = await service.settlementStats('A', '2026-09');

    // 明细：只有跨店那 4 笔里的「对方店陪玩」才进表
    expect(res.rows).toHaveLength(4);
    const byOrder = (id: string, companionId: string) =>
      res.rows.find((r: any) => r.orderId === id && r.companionId === companionId);

    const r1 = byOrder('o1', 'cB1');
    expect(r1.direction).toBe('INBOUND');
    expect(r1.amount).toBe(1000);
    expect(r1.companionPct).toBe(50);
    expect(r1.companionShare).toBe(500);
    expect(r1.studioShare).toBe(500);
    expect(r1.peerStudioId).toBe('B');

    const r2 = byOrder('o2', 'cA1');
    expect(r2.direction).toBe('OUTBOUND');
    expect(r2.amount).toBe(800);
    expect(r2.companionShare).toBe(400);
    expect(r2.peerStudioId).toBe('B');

    // 搭档：只按 coAmount 那段算，不能把整单都算给对方店
    const r3 = byOrder('o3', 'cB2');
    expect(r3.role).toBe('CO');
    expect(r3.amount).toBe(300);
    expect(r3.companionShare).toBe(150);
    // 本店主陪不产生桥接行
    expect(byOrder('o3', 'cA2')).toBeUndefined();

    // 只参与分成的人也算，金额按 split 那段
    const r4 = byOrder('o4', 'cB3');
    expect(r4.role).toBe('SPLIT');
    expect(r4.amount).toBe(200);
    expect(r4.companionShare).toBe(100);

    // 本店自己的单完全不进表
    expect(byOrder('o5', 'cA4')).toBeUndefined();

    expect(res.totals.payable).toBe(750); // 500 + 150 + 100
    expect(res.totals.receivable).toBe(400);
    expect(res.totals.net).toBe(-350);
    expect(res.peers).toHaveLength(1);
    expect(res.peers[0].peerStudioId).toBe('B');
    expect(res.peers[0].payable).toBe(750);
  });

  it('分成比例用陪玩自己店的阶梯；没满 6 个月工龄落不到最高档', async () => {
    const fresh = companion('cB1', 'B', { createdAt: daysAgo(3) });
    const service = makeService({
      orders: [
        {
          id: 'o1', orderCode: 'P001', gameName: 'LOL', amount: 12000, coAmount: null,
          companionId: 'cB1', coCompanionId: null, customFields: {},
          studioId: 'A', createdAt: daysAgo(1),
          studio: { id: 'A', name: '蠢驴电竞' }, customer: { customerCode: '1', wechatId: 'wx1' },
          sessions: [],
        },
      ],
      monthOrders: [
        { amount: 12000, coAmount: null, companionId: 'cB1', coCompanionId: null, customFields: {} },
      ],
      companions: [fresh],
    });
    const res: any = await service.settlementStats('A', '2026-09');
    // 12000 本该是最高档 70%，但工龄不满 6 个月 → 回落 60%（与发工资的口径一致）
    expect(res.rows[0].companionPct).toBe(60);
    expect(res.rows[0].companionShare).toBe(7200);
  });

  it('老员工勾选豁免后能拿到最高档', async () => {
    const senior = companion('cB1', 'B', { createdAt: daysAgo(3), isSeniorStaff: true });
    const service = makeService({
      orders: [
        {
          id: 'o1', orderCode: 'P001', gameName: 'LOL', amount: 12000, coAmount: null,
          companionId: 'cB1', coCompanionId: null, customFields: {},
          studioId: 'A', createdAt: daysAgo(1),
          studio: { id: 'A', name: '蠢驴电竞' }, customer: { customerCode: '1', wechatId: 'wx1' },
          sessions: [],
        },
      ],
      monthOrders: [
        { amount: 12000, coAmount: null, companionId: 'cB1', coCompanionId: null, customFields: {} },
      ],
      companions: [senior],
    });
    const res: any = await service.settlementStats('A', '2026-09');
    expect(res.rows[0].companionPct).toBe(70);
  });

  it('店长自己填了本店阶梯就按本店的算', async () => {
    const service = makeService({
      orders: [
        {
          id: 'o1', orderCode: 'P001', gameName: 'LOL', amount: 1000, coAmount: null,
          companionId: 'cB1', coCompanionId: null, customFields: {},
          studioId: 'A', createdAt: daysAgo(1),
          studio: { id: 'A', name: '蠢驴电竞' }, customer: { customerCode: '1', wechatId: 'wx1' },
          sessions: [],
        },
      ],
      monthOrders: [
        { amount: 1000, coAmount: null, companionId: 'cB1', coCompanionId: null, customFields: {} },
      ],
      companions: [companion('cB1', 'B')],
      systemConfigs: [
        { key: 'revenue.share_tiers', value: [{ min: 0, max: null, studio: 30, companion: 70 }] },
      ],
    });
    const res: any = await service.settlementStats('A', '2026-09');
    expect(res.rows[0].companionPct).toBe(70);
    expect(res.rows[0].companionShare).toBe(700);
  });

  it('没有桥接店时直接返回空账，不去查单', async () => {
    const prisma: any = {
      studioBridge: { findMany: vi.fn(async () => []) },
      order: { findMany: vi.fn(async () => []) },
      companion: { findMany: vi.fn(async () => []) },
      systemConfig: { findMany: vi.fn(async () => []) },
      studioConfig: { findMany: vi.fn(async () => []) },
    };
    const service = new BridgeService(prisma);
    const res: any = await service.settlementStats('A', '2026-09');
    expect(res.rows).toEqual([]);
    expect(res.totals.payable).toBe(0);
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('桥接已经断开，以前的往来账仍然查得到（不能靠断桥接赖旧账）', async () => {
    const prisma: any = {
      // 断开后查询不带 status 过滤，所以这里返回的是「历史上桥接过」这一条
      studioBridge: {
        findMany: vi.fn(async () => [{ studioAId: 'A', studioBId: 'B', status: 'REJECTED' }]),
      },
      order: {
        findMany: vi.fn(async (args: any) =>
          args?.where?.studioId
            ? [
                {
                  id: 'o1', orderCode: 'P001', gameName: 'LOL', amount: 1000, coAmount: null,
                  companionId: 'cB1', coCompanionId: null, customFields: {},
                  studioId: 'A', createdAt: daysAgo(40),
                  studio: { id: 'A', name: '蠢驴电竞' },
                  customer: { customerCode: '1', wechatId: 'wx1' },
                  sessions: [],
                },
              ]
            : [{ amount: 1000, coAmount: null, companionId: 'cB1', coCompanionId: null, customFields: {} }],
        ),
      },
      companion: { findMany: vi.fn(async () => [companion('cB1', 'B')]) },
      systemConfig: { findMany: vi.fn(async () => []) },
      studioConfig: { findMany: vi.fn(async () => []) },
    };
    const res: any = await new BridgeService(prisma).settlementStats('A', '2026-07');
    expect(res.rows).toHaveLength(1);
    expect(res.totals.payable).toBe(500);
  });

  it('指定对方工作室时只看这一家', async () => {
    const service = makeService({
      orders: [],
      monthOrders: [],
      companions: [],
    });
    const res: any = await service.settlementStats('A', '2026-09', 'B');
    expect(res.rows).toEqual([]);
  });
});
