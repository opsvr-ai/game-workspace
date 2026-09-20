import http from './client';

export interface BridgeInfo {
  id: string;
  studioAId: string;
  studioBId: string;
  status: 'PENDING' | 'ACTIVE' | 'REJECTED';
  proposedBy: string;
  createdAt: string;
  acceptedAt: string | null;
  studioA: { id: string; name: string };
  studioB: { id: string; name: string };
  permissions: Array<{ id: string; function: string; acceptedA: boolean; acceptedB: boolean }>;
}

/** 桥接往来对账的一行明细（只统计，不转账） */
export interface BridgeSettlementRow {
  direction: 'INBOUND' | 'OUTBOUND';
  role: 'PRIMARY' | 'CO' | 'SPLIT';
  orderId: string;
  orderCode: string | null;
  gameName: string | null;
  createdAt: string | null;
  finishedAt: string | null;
  customerCode: string | null;
  customerWechat: string | null;
  publisherStudioId: string;
  publisherStudioName: string;
  companionId: string;
  companionName: string;
  companionStudioId: string;
  companionStudioName: string;
  peerStudioId: string;
  peerStudioName: string;
  amount: number;
  companionPct: number;
  companionShare: number;
  studioShare: number;
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

export interface BridgeSettlement {
  month: string;
  range: { start: string; end: string };
  peers: BridgePeerSummary[];
  rows: BridgeSettlementRow[];
  totals: {
    inboundCount: number;
    inboundAmount: number;
    payable: number;
    outboundCount: number;
    outboundAmount: number;
    receivable: number;
    net: number;
  };
}

export const bridgeApi = {
  propose: (targetStudioId: string) =>
    http.post<{ data: BridgeInfo }>('/bridges/propose', { targetStudioId }),

  respond: (bridgeId: string, accept: boolean, functionFilter?: string[]) =>
    http.post<{ data: { status: string } }>(`/bridges/${bridgeId}/respond`, { accept, functionFilter }),

  updatePermissions: (bridgeId: string, functions: string[]) =>
    http.put<{ data: { status: string } }>(`/bridges/${bridgeId}/permissions`, { functions }),

  list: () =>
    http.get<{ data: { active: BridgeInfo[]; pending: BridgeInfo[] } }>('/bridges'),

  active: () =>
    http.get<{ data: BridgeInfo[] }>('/bridges/active'),

  remove: (bridgeId: string) =>
    http.delete(`/bridges/${bridgeId}`),

  /** 桥接往来对账：这个月两家店互相该给多少钱 */
  settlement: (month: string, peerStudioId?: string) =>
    http.get<{ data: BridgeSettlement }>('/bridges/settlement', {
      params: { month, peerStudioId },
    }),
};
