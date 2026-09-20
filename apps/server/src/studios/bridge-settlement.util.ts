/**
 * 桥接往来对账的纯计算（老板 2026-09-21 口径）。
 *
 * 桥接 = 双方能互相抢单、人员互通。系统**只统计**：算清楚「谁接了我店的单、我该给
 * 对方店多少钱」和「我店陪玩接了对方店的单、对方店该给我多少钱」，
 * 钱由两个店长在微信上定期互相结 —— 这里不碰任何钱包余额，也不自动转账。
 *
 * 一笔桥接单上有两个角色：
 * - **发单店**（`order.studioId`）：客户是这家的，客户的钱进这家；
 * - **接单店**（陪玩的 `studioId`）：活是这家陪玩干的，陪玩的提成由这家结算、这家发工资。
 *
 * 所以发单店要把「陪玩那一份」还给接单店：
 * - 我是发单店、活是对方店陪玩干的 → **我应付**对方店 = 该陪玩这笔单的业绩 × 他的分成比例；
 * - 我是接单店、陪玩是我家的人、单是对方店的 → **我应收**对方店 = 同一个数；
 * - 剩下的（工作室那份 + 客服与店长那份）留在发单店。
 *
 * 「他的分成比例」按**陪玩自己店**的分成阶梯、并按他当月总流水落档，
 * 与 `billing/settlement.service.ts` 真正发钱时的算法一致 —— 别处再写一份就会对不上账。
 */

export type BridgeDirection = 'INBOUND' | 'OUTBOUND';

/** 接单陪玩在这笔单里的角色 */
export type BridgeRowRole = 'PRIMARY' | 'CO' | 'SPLIT';

export interface BridgeSettlementRow {
  direction: BridgeDirection;
  role: BridgeRowRole;
  orderId: string;
  orderCode: string | null;
  gameName: string | null;
  createdAt: string | null;
  finishedAt: string | null;
  customerCode: string | null;
  customerWechat: string | null;
  /** 发单店（客户是他家的） */
  publisherStudioId: string;
  publisherStudioName: string;
  /** 接单陪玩 */
  companionId: string;
  companionName: string;
  companionStudioId: string;
  companionStudioName: string;
  /** 对账的另一家店：应付 / 应收都是跟它结 */
  peerStudioId: string;
  peerStudioName: string;
  /** 该陪玩在这笔单里的业绩（元） */
  amount: number;
  /** 该陪玩的分成比例（%） */
  companionPct: number;
  /** 应返 / 应收（元）= amount × pct */
  companionShare: number;
  /** 剩下的归发单店（元） */
  studioShare: number;
}

export interface BridgeSettlementTotals {
  /** 对方陪我店的单（我应付） */
  inboundCount: number;
  inboundAmount: number;
  payable: number;
  /** 我陪对方店的单（我应收） */
  outboundCount: number;
  outboundAmount: number;
  receivable: number;
  /** 应收 − 应付：正数 = 对方该给我，负数 = 我该给对方 */
  net: number;
}

export interface BridgePeerSummary {
  peerStudioId: string;
  peerStudioName: string;
  payable: number;
  payableCount: number;
  receivable: number;
  receivableCount: number;
  net: number;
}

/** 金额一律保留两位（对账上必须能一分一分对上）。 */
export function roundYuan(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * 这笔单对「我店」算不算桥接？算的话是我应付还是应收。
 * 本店单 + 本店陪玩 = 正常单，返回 null；与两家都无关的单也返回 null。
 */
export function bridgeDirection(params: {
  myStudioId?: string | null;
  orderStudioId?: string | null;
  companionStudioId?: string | null;
}): BridgeDirection | null {
  const { myStudioId, orderStudioId, companionStudioId } = params;
  if (!myStudioId || !orderStudioId || !companionStudioId) return null;
  if (orderStudioId === companionStudioId) return null;
  if (orderStudioId === myStudioId) return 'INBOUND';
  if (companionStudioId === myStudioId) return 'OUTBOUND';
  return null;
}

export function summarizeBridge(rows: BridgeSettlementRow[]): BridgeSettlementTotals {
  const inbound = rows.filter((r) => r.direction === 'INBOUND');
  const outbound = rows.filter((r) => r.direction === 'OUTBOUND');
  const sumBy = (list: BridgeSettlementRow[], pick: (r: BridgeSettlementRow) => number) =>
    list.reduce((s, r) => s + (Number(pick(r)) || 0), 0);
  const payable = roundYuan(sumBy(inbound, (r) => r.companionShare));
  const receivable = roundYuan(sumBy(outbound, (r) => r.companionShare));
  return {
    inboundCount: inbound.length,
    inboundAmount: roundYuan(sumBy(inbound, (r) => r.amount)),
    payable,
    outboundCount: outbound.length,
    outboundAmount: roundYuan(sumBy(outbound, (r) => r.amount)),
    receivable,
    net: roundYuan(receivable - payable),
  };
}

/** 按「对方工作室」分组：一家店一张小账。 */
export function groupByPeer(rows: BridgeSettlementRow[]): BridgePeerSummary[] {
  const map = new Map<string, BridgePeerSummary>();
  for (const r of rows) {
    if (!map.has(r.peerStudioId)) {
      map.set(r.peerStudioId, {
        peerStudioId: r.peerStudioId,
        peerStudioName: r.peerStudioName,
        payable: 0,
        payableCount: 0,
        receivable: 0,
        receivableCount: 0,
        net: 0,
      });
    }
    const row = map.get(r.peerStudioId)!;
    if (r.direction === 'INBOUND') {
      row.payable += r.companionShare;
      row.payableCount += 1;
    } else {
      row.receivable += r.companionShare;
      row.receivableCount += 1;
    }
  }
  return [...map.values()]
    .map((s) => ({
      ...s,
      payable: roundYuan(s.payable),
      receivable: roundYuan(s.receivable),
      net: roundYuan(s.receivable - s.payable),
    }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

/** 微信对账用的一行文字（店长直接复制粘贴给对方）。 */
export function formatSettlementLine(r: BridgeSettlementRow): string {
  const when = r.finishedAt || r.createdAt || '';
  const day = when ? String(when).slice(0, 10) : '';
  const code = r.orderCode || r.orderId.slice(0, 8);
  const dir = r.direction === 'INBOUND' ? `我付${r.peerStudioName}` : `${r.peerStudioName}付我`;
  return [
    day,
    code,
    r.gameName || '',
    `客户${r.customerWechat || r.customerCode || '-'}`,
    `${r.companionName}(${r.companionStudioName})`,
    `业绩¥${r.amount.toFixed(2)}`,
    `${r.companionPct}%`,
    `应给¥${r.companionShare.toFixed(2)}`,
    dir,
  ]
    .filter(Boolean)
    .join(' | ');
}
