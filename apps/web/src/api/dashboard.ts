import http from './client';

export const dashboardApi = {
  get: (studioId?: string) => http.get('/dashboard', { params: studioId ? { studioId } : {} }),
  trend: (days?: number) => http.get('/dashboard/trend', { params: { days } }),
  companions: () => http.get('/dashboard/companions'),
  dailyPerformance: (date?: string) =>
    http.get('/dashboard/performance/daily', { params: { date } }),
  monthlyPerformance: (month?: string) =>
    http.get('/dashboard/performance/monthly', { params: { month } }),
  getRevenueOverview: () => http.get('/dashboard/revenue-overview'),
  getCompanionRevenueDetail: (id: string) => http.get(`/dashboard/companion-revenue/${id}`),
};
