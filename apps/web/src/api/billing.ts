import http from './client';

export const billingApi = {
  getOverview: (companionId?: string, month?: string) => http.get('/billing/overview', { params: { companionId, month } }),
  list: (params?: { status?: string }) =>
    http.get('/transactions', { params }),
  approve: (id: string) => http.put(`/transactions/${id}/approve`),
  reject: (id: string) => http.put(`/transactions/${id}/reject`),
  batchApprove: (ids: string[]) =>
    http.put('/transactions/batch', { ids, action: 'approve' }),
  batchReject: (ids: string[]) =>
    http.put('/transactions/batch', { ids, action: 'reject' }),
  profitLoss: (secondToken: string) =>
    http.get('/revenue/stats', {
      headers: { 'x-second-token': secondToken },
    }),
  expenses: (secondToken: string) =>
    http.get('/expenses', {
      headers: { 'x-second-token': secondToken },
    }),
  walletTransactions: (params?: { status?: string }) =>
    http.get('/wallet-transactions', { params }),
  reviewWalletTransaction: (id: string, status: string) =>
    http.put(`/wallet-transactions/${id}/review`, { status }),
  runSettlement: (month: string) =>
    http.post('/monthly-settlement', { month }),
  getSettlement: (month?: string) =>
    http.get('/monthly-settlement', { params: { month } }),
};
