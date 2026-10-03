import http from './client';

export const customersApi = {
  list: (params?: any) => http.get('/customers', { params }),
  getById: (id: string) => http.get(`/customers/${id}`),
  create: (data: any) => http.post('/customers', data),
  update: (id: string, data: any) => http.put(`/customers/${id}`, data),
  delete: (id: string) => http.delete(`/customers/${id}`),
  reassign: (id: string, companionId: string) =>
    http.put(`/customers/${id}/reassign`, { companionId }),
  getProfile: (id: string) => http.get(`/customers/${id}/profile`),
  updateProfile: (id: string, data: any) => http.put(`/customers/${id}/profile`, data),
  getType: (id: string) => http.get(`/customers/${id}/type`),
  getFollowUps: (id: string) => http.get(`/customers/${id}/follow-ups`),
  /** 重复客户档案（同一个微信号建了多条）——老板 2026-09-29 */
  duplicates: () => http.get('/customers/duplicates'),
  /** 把 sourceId 这条并进 targetId（保留 targetId） */
  mergeCustomers: (id: string, targetId: string) =>
    http.post(`/customers/${id}/merge-into`, { targetId }),
  addFollowUp: (id: string, data: any) => http.post(`/customers/${id}/follow-ups`, data),
  getOrders: (id: string) => http.get(`/customers/${id}/orders`),
  listDeposits: (id: string) => http.get(`/customers/${id}/deposits`),
  createDeposit: (id: string, data: { amount: number; screenshotUrl?: string; note?: string }) =>
    http.post(`/customers/${id}/deposits`, data),
  trafficPool: (platform?: string) => http.get('/customers/traffic/pool', { params: { platform } }),
  trafficStats: () => http.get('/customers/traffic/stats'),
  /** 客户画像（老板 2026-10-04）：这个客户在哪些工作微信 / 陪玩上消费了多少、打机密还是绝密、
   *  打了多久、维护多久，并给出「下次该派给谁」的建议。 */
  profileAnalytics: (id: string) => http.get(`/customers/${id}/profile-analytics`),
  /** 客户看板：所有客户 + 消费 / 时长 / 此刻在不在打（老板 2026-10-03） */
  board: (params?: { sort?: string; companionId?: string }) =>
    http.get('/customers/board', { params }),
};
