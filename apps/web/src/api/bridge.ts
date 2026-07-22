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

export const bridgeApi = {
  propose: (targetStudioId: string) =>
    http.post<{ data: BridgeInfo }>('/bridges/propose', { targetStudioId }),

  respond: (bridgeId: string, accept: boolean) =>
    http.post<{ data: { status: string } }>(`/bridges/${bridgeId}/respond`, { accept }),

  list: () =>
    http.get<{ data: { active: BridgeInfo[]; pending: BridgeInfo[] } }>('/bridges'),

  active: () =>
    http.get<{ data: BridgeInfo[] }>('/bridges/active'),

  remove: (bridgeId: string) =>
    http.delete(`/bridges/${bridgeId}`),
};
