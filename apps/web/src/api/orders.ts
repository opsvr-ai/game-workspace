import http from './client';

export const ordersApi = {
  list: (params?: any) => http.get('/orders', { params }),
  pool: () => http.get('/orders/pool'),
  poolStatus: () => http.get('/orders/pool/status'),
  create: (data: any) => http.post('/orders', data),
  grab: (id: string) => http.post(`/orders/${id}/grab`),
  updateContact: (id: string, data: any) => http.put(`/orders/${id}/contact`, data),
  assign: (id: string, companionId: string) =>
    http.post(`/orders/${id}/assign`, { companionId }),
  confirm: (id: string) => http.post(`/orders/${id}/confirm`),
  complete: (id: string) => http.post(`/orders/${id}/complete`),
  completeBilling: (id: string, data: any) => http.post(`/orders/${id}/complete-billing`, data),
  cancel: (id: string) => http.post(`/orders/${id}/cancel`),
  acceptAssignment: (id: string) => http.post(`/orders/${id}/accept-assignment`),
  declineAssignment: (id: string) => http.post(`/orders/${id}/decline-assignment`),
  quickGrab: (id: string) => http.post(`/orders/${id}/quick-grab`),
  markReady: (id: string) => http.post(`/orders/${id}/mark-ready`),
  acceptPartner: (id: string) => http.post(`/orders/${id}/accept-partner`),
};
