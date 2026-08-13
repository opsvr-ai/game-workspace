// craftsman-ignore: TS001,TS003
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
  renew: (id: string) => http.post(`/orders/${id}/renew`),
  getSessions: (id: string) => http.get(`/orders/${id}/sessions`),
  addSession: (id: string, data: any) => http.post(`/orders/${id}/sessions`, data),
  startSession: (sessionId: string, claims?: { claimedMode?: string; claimedPrice?: number; transferScreenshotUrl?: string }) =>
    http.put(`/sessions/${sessionId}/start`, claims || {}),
  pauseSession: (sessionId: string) => http.put(`/sessions/${sessionId}/pause`),
  resumeSession: (sessionId: string) => http.put(`/sessions/${sessionId}/resume`),
  endSession: (sessionId: string) => http.put(`/sessions/${sessionId}/end`),
  finishSession: (sessionId: string) => http.put(`/sessions/${sessionId}/finish`),
  uploadShot: (sessionId: string, form: FormData) =>
    http.post(`/sessions/${sessionId}/screenshots`, form, { headers: { 'Content-Type': 'multipart/form-data' } }),
  updatePayment: (orderId: string, data: {
    paymentAccountId?: string;
    companionFeeStatus?: string;
    companionFeeMethod?: string;
    companionFeeAccount?: string;
    companionFeeAmount?: number;
  }) => http.put(`/orders/${orderId}/payment`, data),
};
