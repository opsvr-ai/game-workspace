import http from './client';

export const billingApi = {
  list: (params?: { status?: string }) =>
    http.get('/transactions', { params }),
  approve: (id: string) => http.put(`/transactions/${id}/approve`),
  reject: (id: string) => http.put(`/transactions/${id}/reject`),
};
