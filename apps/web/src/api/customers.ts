import http from './client';

export const customersApi = {
  list: (params?: any) => http.get('/customers', { params }),
  getById: (id: string) => http.get(`/customers/${id}`),
  create: (data: any) => http.post('/customers', data),
  update: (id: string, data: any) => http.put(`/customers/${id}`, data),
  delete: (id: string) => http.delete(`/customers/${id}`),
  reassign: (id: string, companionId: string) =>
    http.put(`/customers/${id}/reassign`, { companionId }),
};
