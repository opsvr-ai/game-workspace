import http from './client';

export const companionsApi = {
  listWorkWechats: () => http.get('/companions/work-wechats'),
  list: (params?: any) => http.get('/companions', { params }),
  listPersonnel: (params?: any) => http.get('/personnel', { params }),
  getById: (id: string) => http.get(`/companions/${id}`),
  updateStatus: (id: string, status: string) =>
    http.put(`/companions/${id}/status`, { status }),
  ranking: () => http.get('/companions/ranking'),
  sendCommand: (id: string, command: string, params?: unknown) =>
    http.post(`/companions/${id}/command`, { command, params }),
  kick: (id: string) => http.post(`/companions/${id}/kick`),
  workbench: () => http.get('/companions/me/workbench'),
  todaySessions: (params?: { day?: string }) =>
    http.get('/companions/me/today-sessions', { params }),
  reportableSessions: (params?: { day?: string; unreported?: string }) =>
    http.get('/companions/me/reportable-sessions', { params }),
  dormantCustomers: () => http.get('/companions/me/dormant-customers'),
  notifyPrefs: () => http.get('/companions/me/notify-prefs'),
  setNotifyPrefs: (data: { notifyWhileBusy?: boolean }) =>
    http.put('/companions/me/notify-prefs', data),
  wallet: () => http.get('/companions/me/wallet'),
  requestWithdraw: (amount: number) => http.post('/companions/me/withdraw', { amount }),
  resign: (id: string) => http.post(`/companions/${id}/resign`),
  updateFinance: (id: string, data: { todayRevenue?: number; totalRevenue?: number; totalWithdrawn?: number; pendingWithdraw?: number; deposit?: number; note?: string }) => http.put(`/companions/${id}/finance`, data),
  setSeniorStaff: (id: string, isSeniorStaff: boolean) => http.put(`/companions/${id}/senior-staff`, { isSeniorStaff }),
  requestProofNoCustomer: (note: string) => http.post('/companions/me/proof-no-customer', { note }),
  // Status blacklist
  getStatusBlacklist: (status: string) =>
    http.get('/companions/status-blacklist', { params: { status } }),
  listStatusBlacklists: () => http.get('/companions/status-blacklists'),
  addStatusBlacklist: (data: { status: string; processName: string; displayName?: string }) =>
    http.post('/companions/status-blacklist', data),
  removeStatusBlacklist: (entryId: string) =>
    http.delete(`/companions/status-blacklist/${entryId}`),
};
