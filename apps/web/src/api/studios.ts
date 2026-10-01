import http from './client';

export const studiosApi = {
  list: () => http.get('/studios'),
  create: (formData: FormData) =>
    http.post('/studios', formData),
  update: (id: string, name: string, type: string, splitMode?: string, address?: string, displayName?: string, logoUrl?: string) =>
    http.put(`/studios/${id}`, { name, type, splitMode, address, displayName, logoUrl }),
  delete: (id: string) => http.delete(`/studios/${id}`),
  listOnlineClubs: (studioId?: string) =>
    http.get('/studios/online-clubs', { params: studioId ? { studioId } : {} }),
  createOnlineClub: (name: string, displayName?: string, studioId?: string) =>
    http.post('/studios/online-clubs', { name, displayName, studioId }),
  getPaymentAccounts: () => http.get('/payment-accounts'),
  createPaymentAccount: (data: { type: string; accountName: string; accountNumber: string }) =>
    http.post('/payment-accounts', data),
};
