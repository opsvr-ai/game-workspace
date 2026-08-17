import http from './client';

export interface ManagedPcItem {
  id: string;
  ip: string;
  loginAccount: string;
  label?: string | null;
  enabled: boolean;
  online?: boolean;
  createdAt: string;
  updatedAt: string;
}

export const managedPcApi = {
  list: () => http.get('/managed-pcs'),
  create: (data: { ip: string; loginAccount: string; label?: string }) => http.post('/managed-pcs', data),
  update: (id: string, data: Partial<{ ip: string; loginAccount: string; label?: string; enabled: boolean }>) =>
    http.put(`/managed-pcs/${id}`, data),
  remove: (id: string) => http.delete(`/managed-pcs/${id}`),
  power: (id: string, action: 'wake' | 'shutdown' | 'restart' | 'sleep' | 'hibernate') =>
    http.post(`/managed-pcs/${id}/power`, { action }),
};
