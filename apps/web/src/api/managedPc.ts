import http from './client';

export interface ManagedPcItem {
  id: string;
  ip: string;
  loginAccount: string;
  macAddress?: string | null;
  label?: string | null;
  enabled: boolean;
  online?: boolean;
  lastAction?: string | null;
  lastActionAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const managedPcApi = {
  list: () => http.get('/managed-pcs'),
  create: (data: { ip: string; loginAccount: string; macAddress?: string; label?: string }) => http.post('/managed-pcs', data),
  update: (id: string, data: Partial<{ ip: string; loginAccount: string; macAddress?: string; label?: string; enabled: boolean }>) =>
    http.put(`/managed-pcs/${id}`, data),
  remove: (id: string) => http.delete(`/managed-pcs/${id}`),
  power: (id: string, action: 'wake' | 'shutdown' | 'restart' | 'sleep' | 'hibernate') =>
    http.post(`/managed-pcs/${id}/power`, { action }),
  powerBatch: (ids: string[], action: 'wake' | 'shutdown' | 'restart' | 'sleep' | 'hibernate') =>
    http.post('/managed-pcs/batch-power', { ids, action }),
  syncMac: () => http.post('/managed-pcs/sync-mac'),
};
