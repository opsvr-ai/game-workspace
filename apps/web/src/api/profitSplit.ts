import http from './client';

export const profitSplitApi = {
  get: (mode: string) => http.get('/profit-split', { params: { mode } }),
  save: (data: any) => http.post('/profit-split', data),
};
