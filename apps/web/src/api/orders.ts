import http from './client';

export const ordersApi = {
  list: (params?: any) => http.get('/orders', { params }),
  pool: () => http.get('/orders/pool'),
  create: (data: any) => http.post('/orders', data),
  grab: (id: string) => http.post(`/orders/${id}/grab`),
  assign: (id: string, companionId: string) =>
    http.post(`/orders/${id}/assign`, { companionId }),
  confirm: (id: string) => http.post(`/orders/${id}/confirm`),
  complete: (id: string) => http.post(`/orders/${id}/complete`),
  cancel: (id: string) => http.post(`/orders/${id}/cancel`),
};
