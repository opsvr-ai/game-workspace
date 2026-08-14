import http from './client';

export const financeApi = {
  // ── 价格规则 ──
  priceRules: {
    list: (studioId?: string) => http.get('/finance/price-rules', { params: { studioId } }),
    create: (data: Record<string, unknown>) => http.post('/finance/price-rules', data),
    update: (id: string, data: Record<string, unknown>) => http.patch(`/finance/price-rules/${id}`, data),
    builtinModes: () => http.get('/finance/price-rules/builtin'),
  },

  // ── 月度分成结算（不可变快照）──
  settlement: {
    run: (month: string, studioId?: string) => http.post(`/finance/settlement/${month}`, undefined, { params: { studioId } }),
    list: (month: string, studioId?: string) => http.get(`/finance/settlement/${month}`, { params: { studioId } }),
  },

  // ── 客服/店长提成 ──
  commission: {
    listRules: (studioId?: string) => http.get('/finance/commission/rules', { params: { studioId } }),
    upsertRule: (data: Record<string, unknown>) => http.post('/finance/commission/rules', data),
    calculate: (month: string, studioId?: string) => http.post(`/finance/commission/calculate/${month}`, undefined, { params: { studioId } }),
    list: (month: string, studioId?: string) => http.get(`/finance/commission/${month}`, { params: { studioId } }),
    setLedgerStatus: (id: string, status: string) => http.patch(`/finance/commission/ledgers/${id}/status`, { status }),
  },

  // ── 每日到账对账 ──
  reconciliation: {
    get: (day: string, studioId?: string) => http.get('/finance/reconciliation', { params: { day, studioId } }),
  },

  // ── 客户画像 / 私单风险工作台 ──
  riskQueue: {
    get: (studioId?: string) => http.get('/finance/risk-queue', { params: { studioId } }),
  },
};
