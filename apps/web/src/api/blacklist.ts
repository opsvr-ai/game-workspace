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
    http.post('/processes/blacklist/push', data),

  // ── 按人特批（本店开关之外，单独给某个人开 / 关）──
  // enabled 传 true / false = 单独开 / 单独关；传 null = 恢复「跟随本店」。
  // studioId 只有老板用得上（老板没挂工作室）；店长 / 客服不传，后端按本店算。
  getCompanionSwitches: (studioId?: string) =>
    http.get('/processes/blacklist/companion-switches', { params: studioId ? { studioId } : {} }),
  setCompanionSwitch: (companionId: string, enabled: boolean | null, studioId?: string) =>
    http.put('/processes/blacklist/companion-switches', {
      companionId,
      enabled,
      ...(studioId ? { studioId } : {}),
    }),

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

  // ── 待禁用进程名单 ──
  listPendingDisable: () => http.get('/processes/pending-disable'),
  addPendingDisable: (data: { processName: string; displayName?: string }) =>
    http.post('/processes/pending-disable', data),
  removePendingDisable: (id: string) =>
    http.delete(`/processes/pending-disable/${id}`),
};
