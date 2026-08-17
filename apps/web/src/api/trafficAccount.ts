import http from './client';

export interface TrafficAccountItem {
  id: string;
  studioId: string;
  userId: string;
  type: string;
  nickname: string;
  accountId?: string | null;
  status: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { username: string; displayName?: string };
}

export const trafficAccountApi = {
  list: () => http.get('/traffic-accounts'),
  create: (data: { type: string; nickname: string; accountId?: string; notes?: string; userId?: string }) =>
    http.post('/traffic-accounts', data),
  update: (id: string, data: Partial<{ type: string; nickname: string; accountId?: string; status?: string; notes?: string }>) =>
    http.put(`/traffic-accounts/${id}`, data),
  remove: (id: string) => http.delete(`/traffic-accounts/${id}`),
};
