import http from './client';

export const ordersApi = {
  list: (params?: any) => http.get('/orders', { params }),
  pool: () => http.get('/orders/pool'),
  poolStatus: () => http.get('/orders/pool/status'),
  create: (data: any) => http.post('/orders', data),
  grab: (id: string) => http.post(`/orders/${id}/grab`),
  assign: (id: string, companionId: string) =>
    http.post(`/orders/${id}/assign`, { companionId }),
  confirm: (id: string) => http.post(`/orders/${id}/confirm`),
  complete: (id: string) => http.post(`/orders/${id}/complete`),
  completeBilling: (id: string, data: any) => http.post(`/orders/${id}/complete-billing`, data),
  cancel: (id: string) => http.post(`/orders/${id}/cancel`),
  acceptAssignment: (id: string) => http.post(`/orders/${id}/accept-assignment`),
  declineAssignment: (id: string) => http.post(`/orders/${id}/decline-assignment`),
};
