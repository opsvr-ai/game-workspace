import http from './client';

export const companionsApi = {
  listWorkWechats: () => http.get('/companions/work-wechats'),
  list: () => http.get('/companions'),
  getById: (id: string) => http.get(`/companions/${id}`),
  updateStatus: (id: string, status: string) =>
    http.put(`/companions/${id}/status`, { status }),
  ranking: () => http.get('/companions/ranking'),
  sendCommand: (id: string, command: string, params?: unknown) =>
    http.post(`/companions/${id}/command`, { command, params }),
  kick: (id: string) => http.post(`/companions/${id}/kick`),
  workbench: () => http.get('/companions/me/workbench'),
  wallet: () => http.get('/companions/me/wallet'),
  requestWithdraw: (amount: number) => http.post('/companions/me/withdraw', { amount }),
  resign: (id: string) => http.post(`/companions/${id}/resign`),
  updateFinance: (id: string, data: { todayRevenue?: number; totalRevenue?: number; totalWithdrawn?: number; pendingWithdraw?: number; deposit?: number; note?: string }) => http.put(`/companions/${id}/finance`, data),
  requestProofNoCustomer: (note: string) => http.post('/companions/me/proof-no-customer', { note }),
  // Status blacklist
  getStatusBlacklist: (companionId: string, status: string) =>
    http.get(`/companions/${companionId}/status-blacklist`, { params: { status } }),
  addStatusBlacklist: (companionId: string, data: { status: string; processName: string }) =>
    http.post(`/companions/${companionId}/status-blacklist`, data),
  removeStatusBlacklist: (companionId: string, entryId: string) =>
    http.delete(`/companions/${companionId}/status-blacklist/${entryId}`),
};
