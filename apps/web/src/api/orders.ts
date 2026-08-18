// craftsman-ignore: TS001,TS003
import http from './client';

export const ordersApi = {
  urgent: () => http.get('/orders/urgent'),
  markCsContact: (id: string, status: string, evidenceUrl?: string, extra?: { workWechatId?: string; workWechatName?: string; addResult?: string }) =>
    http.put(`/orders/${id}/cs-contact`, { status, evidenceUrl, ...extra }),
  redispatch: (id: string) => http.post(`/orders/${id}/redispatch`),
  markPoolHandled: (id: string) => http.post(`/orders/${id}/pool-handled`),
  csFollowup: () => http.get('/orders/cs-followup'),
  listMoneyFlows: (id: string) => http.get(`/orders/${id}/money-flows`),
  addMoneyFlow: (id: string, data: { direction: string; amount: number; counterpart: string; counterpartId?: string; note?: string }) =>
    http.post(`/orders/${id}/money-flows`, data),
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
  refund: (id: string, reason: string) => http.post(`/orders/${id}/refund`, { reason }),
  deposit: (id: string) => http.post(`/orders/${id}/deposit`),
  completeBilling: (id: string, data: any) => http.post(`/orders/${id}/complete-billing`, data),
  cancel: (id: string, reason?: string) => http.post(`/orders/${id}/cancel`, { reason }),
  acceptAssignment: (id: string) => http.post(`/orders/${id}/accept-assignment`),
  declineAssignment: (id: string) => http.post(`/orders/${id}/decline-assignment`),
  quickGrab: (id: string) => http.post(`/orders/${id}/quick-grab`),
  claim: (id: string, data: {
    workWechatId?: string;
    workWechatName?: string;
    customerPaidTo?: string;
    customerPaymentAccountId?: string;
    customerPaymentAccountName?: string;
  }) => http.post(`/orders/${id}/claim`, data),
  release: (id: string, urgency?: string) => http.post(`/orders/${id}/release`, { urgency }),
  markReady: (id: string) => http.post(`/orders/${id}/mark-ready`),
  acceptPartner: (id: string) => http.post(`/orders/${id}/accept-partner`),
  renew: (id: string) => http.post(`/orders/${id}/renew`),
  getSessions: (id: string) => http.get(`/orders/${id}/sessions`),
  addSession: (id: string, data: any) => http.post(`/orders/${id}/sessions`, data),
  startSession: (sessionId: string, claims?: { claimedMode?: string; claimedPrice?: number; duration?: number; transferScreenshotUrl?: string }) =>
    http.put(`/sessions/${sessionId}/start`, claims || {}),
  pauseSession: (sessionId: string) => http.put(`/sessions/${sessionId}/pause`),
  resumeSession: (sessionId: string) => http.put(`/sessions/${sessionId}/resume`),
  endSession: (sessionId: string) => http.put(`/sessions/${sessionId}/end`),
  finishSession: (sessionId: string, data?: { transferTotalYuan?: number }) =>
    http.put(`/sessions/${sessionId}/finish`, data || {}),
  uploadShot: (sessionId: string, form: FormData) =>
    http.post(`/sessions/${sessionId}/screenshots`, form, { headers: { 'Content-Type': 'multipart/form-data' } }),
  updatePayment: (orderId: string, data: {
    paymentAccountId?: string;
    companionFeeStatus?: string;
    companionFeeMethod?: string;
    companionFeeAccount?: string;
    companionFeeAmount?: number;
    customerPaidTo?: string;
    customerPaymentAccountId?: string;
    customerPaymentAccountName?: string;
  }) => http.put(`/orders/${orderId}/payment`, data),
};
