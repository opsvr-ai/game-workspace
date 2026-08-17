import http from './client';

export const analyticsApi = {
  customers: () => http.get('/analytics/customers'),
  companions: () => http.get('/analytics/companions'),
};
