// craftsman-ignore: TS001,TS003
import http from './client';

export const ordersApi = {
  urgent: () => http.get('/orders/urgent'),
  pendingStart: () => http.get('/orders/pending-start'),
  markCsContact: (id: string, status: string, evidenceUrl?: string, extra?: { workWechatId?: string; workWechatName?: string; addResult?: string }) =>
    http.put(`/orders/${id}/cs-contact`, { status, evidenceUrl, ...extra }),
  redispatch: (id: string, poolScope?: string) => http.post(`/orders/${id}/redispatch`, { poolScope }),
  markPoolHandled: (id: string) => http.post(`/orders/${id}/pool-handled`),
  csFollowup: () => http.get('/orders/cs-followup'),
  csConverted: () => http.get('/orders/cs-converted'),
  escalatedPool: (params?: { month?: string; csUserId?: string }) =>
    http.get('/orders/escalated-pool', { params }),
  listMoneyFlows: (id: string) => http.get(`/orders/${id}/money-flows`),
  addMoneyFlow: (id: string, data: { direction: string; amount: number; counterpart: string; counterpartId?: string; note?: string }) =>
    http.post(`/orders/${id}/money-flows`, data),
  checkCsAnomaly: (id: string) => http.post(`/orders/${id}/check-cs-anomaly`),
  csWechatBalances: () => http.get('/orders/cs-wechat-balances'),
  clearCsWechatBalance: (workWechatId: string, note?: string) =>
    http.post(`/orders/cs-wechat-balances/${workWechatId}/clear`, { note }),
  csWechatBalanceSummary: () => http.get('/orders/cs-wechat-balances/summary'),
  csWechatFlow: () => http.get('/orders/cs-wechat-flow'),
  list: (params?: any) => http.get('/orders', { params }),
  getOrder: (id: string) => http.get(`/orders/${id}`),
  pool: () => http.get('/orders/pool'),
  poolStatus: () => http.get('/orders/pool/status'),
  create: (data: any) => http.post('/orders', data),
  updateOrder: (id: string, data: any) => http.put(`/orders/${id}`, data),
  grab: (id: string) => http.post(`/orders/${id}/grab`),
  updateContact: (id: string, data: any) => http.put(`/orders/${id}/contact`, data),
  assign: (id: string, companionId: string) =>
    http.post(`/orders/${id}/assign`, { companionId }),
  confirm: (id: string) => http.post(`/orders/${id}/confirm`),
  complete: (id: string) => http.post(`/orders/${id}/complete`),
  refund: (id: string, reason: string) => http.post(`/orders/${id}/refund`, { reason }),
  deposit: (id: string) => http.post(`/orders/${id}/deposit`),
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
  /** 「线上→线下流转」的单：放给本店线下陪玩（老板 2026-10-01） */
  releaseToOffline: (id: string) => http.post(`/orders/${id}/release-to-offline`),
  /** 线上 / 桥接单的结果反馈：成功 / 不成功（不成功要带原因） */
  recordOutcome: (id: string, data: { outcome: 'SUCCESS' | 'FAILED'; reason?: string; note?: string }) =>
    http.post(`/orders/${id}/outcome`, data),
  /** 「催一下」：线上 / 桥接单一直没反馈结果时，催接单工作室给个说法（老板 2026-09-30） */
  chaseFeedback: (id: string) => http.post(`/orders/${id}/chase-feedback`),
  getSessions: (id: string) => http.get(`/orders/${id}/sessions`),
  addSession: (id: string, data: any) => http.post(`/orders/${id}/sessions`, data),
  acceptPartnerInvite: (sessionId: string) => http.post(`/sessions/${sessionId}/partner-accept`),
  rejectPartnerInvite: (sessionId: string) => http.post(`/sessions/${sessionId}/partner-reject`),
  broadcastPartnerInvite: (sessionId: string) => http.post(`/sessions/${sessionId}/partner-broadcast`),
  /**
   * 转让订单（老板 2026-10-03：要对方同意才过得来）。
   * 这里只是「发出申请」，被转让方在陪玩端点「同意」之后才真正换手。
   */
  requestTransfer: (id: string, data: { toCompanionId: string; reason?: string }) =>
    http.post(`/orders/${id}/transfer`, data),
  /** 我这个陪玩名下待处理的转让申请：incoming（要我同意）/ outgoing（我发起的，能撤回） */
  myTransferRequests: () => http.get('/orders/transfer-requests/mine'),
  acceptTransfer: (requestId: string) => http.post(`/orders/transfer-requests/${requestId}/accept`),
  rejectTransfer: (requestId: string, reason?: string) =>
    http.post(`/orders/transfer-requests/${requestId}/reject`, { reason }),
  cancelTransfer: (requestId: string) => http.post(`/orders/transfer-requests/${requestId}/cancel`),
  startSession: (sessionId: string, claims?: { claimedMode?: string; claimedPrice?: number; duration?: number; transferScreenshotUrl?: string; useDeposit?: boolean }) =>
    http.put(`/sessions/${sessionId}/start`, claims || {}),
  pauseSession: (sessionId: string) => http.put(`/sessions/${sessionId}/pause`),
  resumeSession: (sessionId: string) => http.put(`/sessions/${sessionId}/resume`),
  endSession: (sessionId: string) => http.put(`/sessions/${sessionId}/end`),
  finishSession: (sessionId: string, data?: { transferTotalYuan?: number }) =>
    http.put(`/sessions/${sessionId}/finish`, data || {}),
  uploadShot: (sessionId: string, form: FormData) =>
    http.post(`/sessions/${sessionId}/screenshots`, form),
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
  /** 补单申请：scope=pending 待审 / due 到期要核查客户后来通过没（老板 2026-10-04） */
  listSupplements: (scope?: 'pending' | 'due' | 'all') =>
    http.get('/orders/supplements', { params: scope ? { scope } : {} }),
  supplementSummary: () => http.get('/orders/supplements/summary'),
  decideSupplement: (id: string, decision: 'APPROVE' | 'REJECT', note?: string) =>
    http.post(`/orders/supplements/${id}/decide`, { decision, note }),
  reviewSupplement: (id: string, result: 'ACCEPTED' | 'STILL_NOT') =>
    http.post(`/orders/supplements/${id}/review`, { result }),
};
