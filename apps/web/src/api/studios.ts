import http from './client';

export const studiosApi = {
  list: () => http.get('/studios'),
  create: (name: string) => http.post('/studios', { name }),
  update: (id: string, name: string) => http.put(`/studios/${id}`, { name }),
};
