// craftsman-ignore: TS001,TS003
import http from './client';

export const ordersApi = {
  urgent: () => http.get('/orders/urgent'),
  pendingStart: () => http.get('/orders/pending-start'),
  markCsContact: (
    id: string,
    status: string,
    evidenceUrl?: string,
    extra?: { workWechatId?: string; workWechatName?: string; addResult?: string; failReason?: string; note?: string },
  ) => http.put(`/orders/${id}/cs-contact`, { status, evidenceUrl, ...extra }),
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
  /** 线上 / 桥接单的结果反馈：成功 / 不成功（老板 2026-10-06：接单方自己报，不成功必须带截图） */
  recordOutcome: (id: string, data: { outcome: 'SUCCESS' | 'FAILED'; reason?: string; note?: string; evidence?: string[] }) =>
    http.post(`/orders/${id}/outcome`, data),
  /** 发单客服确认「已跟接单方核对、双方无异议」——失败单先过这一步，才轮到店长拍板（老板 2026-10-06） */
  confirmOutcomeWithCs: (id: string, data: { note?: string }) =>
    http.post(`/orders/${id}/cs-confirm`, data),
  /** 店长 / 老板「打回重写」：接单方说明乱写 / 截图不对 → 退回让他重填再报（老板 2026-10-06） */
  rejectOutcome: (id: string, data: { note: string }) =>
    http.post(`/orders/${id}/review-reject`, data),
  /** 成交核对：店长 / 老板拍板这张「不成功」到底是谁的问题（谁的问题找谁） */
  reviewOutcome: (id: string, data: { responsibility: 'COMPANION' | 'CS' | 'CUSTOMER' | 'NONE'; note: string }) =>
    http.post(`/orders/${id}/review`, data),
  /** 成交核对清单：waiting 待拍板失败单 / recheck 抢了没结果（7 天内）/ archived 历史记录 / decided 已拍板 */
  orderReviews: (scope: 'waiting' | 'recheck' | 'archived' | 'decided') =>
    http.get('/orders/reviews', { params: { scope } }),
  /** 成交核对条数（菜单红点 / 每天提醒） */
  orderReviewSummary: () => http.get('/orders/reviews/summary'),
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
  finishSession: (sessionId: string, data?: { transferTotalYuan?: number; depositDeductYuan?: number }) =>
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
  /**
   * 管理端补单（老板 2026-10-08）：订单管理里那颗「补单」按钮。
   * 这张单上如果有陪玩提交的补单申请，这一下就是「核对 + 同意」—— 原因可以不写（用他写的那段）。
   * （原来的 `POST /orders/:id/refund`「直接退款」已按老板要求整条删除。）
   */
  supplementOrder: (id: string, reason?: string) =>
    http.post(`/orders/${id}/supplement`, { reason: reason || undefined }),
  /** 陪玩发起「退单」：写清原因 + 截图，进「补单审核」同一个入口（老板 2026-10-08） */
  requestRefund: (id: string, reason: string, evidenceUrl?: string) =>
    http.post(`/orders/${id}/refund-request`, { reason, evidenceUrl }),
  listSupplements: (scope?: 'pending' | 'due' | 'records' | 'all') =>
    http.get('/orders/supplements', { params: scope ? { scope } : {} }),
  supplementSummary: () => http.get('/orders/supplements/summary'),
  /** decision: APPROVE 同意 / REJECT 驳回 / CS_PASS 客服核对「无异议」转店长（退单专用） */
  decideSupplement: (id: string, decision: 'APPROVE' | 'REJECT' | 'CS_PASS', note?: string) =>
    http.post(`/orders/supplements/${id}/decide`, { decision, note }),
  reviewSupplement: (id: string, result: 'ACCEPTED' | 'STILL_NOT') =>
    http.post(`/orders/supplements/${id}/review`, { result }),
};
