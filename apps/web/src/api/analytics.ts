import http from './client';

export const analyticsApi = {
  customers: () => http.get('/analytics/customers'),
  companions: () => http.get('/analytics/companions'),
  cs: () => http.get('/analytics/cs'),
  admins: () => http.get('/analytics/admins'),
};
