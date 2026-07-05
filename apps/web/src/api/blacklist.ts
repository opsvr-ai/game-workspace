import http from './client';

export const blacklistApi = {
  // ── Blacklist CRUD ──
  list: (params?: { page?: number; pageSize?: number }) =>
    http.get('/processes/blacklist', { params }),
  add: (data: { processName: string; processPath?: string }) =>
    http.post('/processes/blacklist', data),
  update: (id: string, data: { isActive?: boolean; processPath?: string }) =>
    http.put(`/processes/blacklist/${id}`, data),
  remove: (id: string) =>
    http.delete(`/processes/blacklist/${id}`),
  push: (data: { companionIds?: string[]; targetAll?: boolean }) =>
    http.post('/blacklist/push', data),

  // ── Companion Overrides ──
  getOverrides: (companionId: string) =>
    http.get(`/processes/blacklist/companions/${companionId}/overrides`),
  addOverride: (companionId: string, data: { processName: string; processPath?: string }) =>
    http.post(`/processes/blacklist/companions/${companionId}/overrides`, data),
  removeOverride: (companionId: string, overrideId: string) =>
    http.delete(`/processes/blacklist/companions/${companionId}/overrides/${overrideId}`),

  // ── Whitelist ──
  getWhitelist: () =>
    http.get('/processes/whitelist'),
  addWhitelist: (data: { processName: string; processPath?: string }) =>
    http.post('/processes/whitelist', data),
  removeWhitelist: (id: string) =>
    http.delete(`/processes/whitelist/${id}`),

  // ── Reports & Logs ──
  getReports: (params?: { companionId?: string; limit?: number }) =>
    http.get('/processes/reports', { params }),
  getLatestReport: (companionId: string) =>
    http.get(`/processes/reports/${companionId}`),
  getUniqueNames: (companionId: string) => http.get('/processes/unique-names', { params: { companionId } }),
  getKillLogs: (params?: { companionId?: string; page?: number; pageSize?: number }) =>
    http.get('/processes/kill-logs', { params }),
};
