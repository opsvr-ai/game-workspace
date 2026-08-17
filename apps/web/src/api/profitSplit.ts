import http from './client';

export const profitSplitApi = {
  get: () => http.get('/profit-split'),
  save: (data: any) => http.post('/profit-split', data),
};
