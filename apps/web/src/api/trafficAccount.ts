import http from './client';

export interface TrafficAccountItem {
  id: string;
  studioId: string;
  userId: string;
  type: string;
  code?: string | null;
  trafficLevel?: string | null;
  accountStyle?: string | null;
  nickname: string;
  accountId?: string | null;
  wifi?: string | null;
  wifiRegion?: string | null;
  riskPopped?: string | null;
  riskNote?: string | null;
  banned?: string | null;
  banNote?: string | null;
  phone?: string | null;
  promotionContact?: string | null;
  realName?: string | null;
  registerDate?: string | null;
  banDate?: string | null;
  imageSourceNote?: string | null;
  imageFolder?: string | null;
  otherNote?: string | null;
  extra?: Record<string, any>;
  status: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { username: string; displayName?: string };
}

export const trafficAccountApi = {
  list: (scope?: string) => http.get('/traffic-accounts', { params: scope ? { scope } : undefined }),
  create: (data: any) =>
    http.post('/traffic-accounts', data),
  update: (id: string, data: any) =>
    http.put(`/traffic-accounts/${id}`, data),
  remove: (id: string) => http.delete(`/traffic-accounts/${id}`),
};
