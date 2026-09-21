import http from './client';

export const financeApi = {
  // ── 价格规则 ──
  priceRules: {
    list: (studioId?: string) => http.get('/finance/price-rules', { params: { studioId } }),
    create: (data: Record<string, unknown>) => http.post('/finance/price-rules', data),
    update: (id: string, data: Record<string, unknown>) => http.patch(`/finance/price-rules/${id}`, data),
    builtinModes: () => http.get('/finance/price-rules/builtin'),
  },

  // ── 客服/店长提成 ──
  commission: {
    listRules: (studioId?: string) => http.get('/finance/commission/rules', { params: { studioId } }),
    upsertRule: (data: Record<string, unknown>) => http.post('/finance/commission/rules', data),
    calculate: (month: string, studioId?: string) => http.post(`/finance/commission/calculate/${month}`, undefined, { params: { studioId } }),
    list: (month: string, studioId?: string) => http.get(`/finance/commission/${month}`, { params: { studioId } }),
    setLedgerStatus: (id: string, status: string) => http.patch(`/finance/commission/ledgers/${id}/status`, { status }),
    today: () => http.get('/finance/commission/today'),
    saveBridgeRule: (data: { bridgeTarget: number; missCommissionRate: number; missSalaryRate: number }) =>
      http.put('/finance/commission/bridge-rule', data),
  },

  // ── 每日到账对账 ──
  reconciliation: {
    get: (day: string, studioId?: string) => http.get('/finance/reconciliation', { params: { day, studioId } }),
  },

  // ── 线上+桥接日历汇总 ──
  bridgeOnlineDaily: (month: string, studioId?: string) =>
    http.get('/finance/bridge-online-daily', { params: { month, studioId } }),

  profitDaily: (month: string, studioId?: string) =>
    http.get('/finance/profit-daily', { params: { month, studioId } }),

  // ── 桥接返还台账 ──
  bridgeReturns: {
    list: (month: string) => http.get('/finance/bridge-returns', { params: { month } }),
    create: (data: { amount: number; date?: string; note?: string }) =>
      http.post('/finance/bridge-returns', data),
    remove: (id: string) => http.delete(`/finance/bridge-returns/${id}`),
  },

  // ── 每月固定支出项（房租/水电/网络/电话/其他）──
  expenseItems: {
    list: () => http.get('/finance/expense-items'),
    save: (items: Array<{ id?: string; name?: string; amount?: number }>) =>
      http.put('/finance/expense-items', { items }),
  },

  // ── 客户画像 / 私单风险工作台 ──
  riskQueue: {
    get: (studioId?: string) => http.get('/finance/risk-queue', { params: { studioId } }),
  },
};
