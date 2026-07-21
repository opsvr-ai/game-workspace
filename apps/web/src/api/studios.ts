import http from './client';

export const studiosApi = {
  list: () => http.get('/studios'),
  create: (
    name: string,
    type: string,
    managerUsername: string,
    managerPassword: string,
    managerDisplayName?: string,
    splitMode?: string,
  ) => http.post('/studios', {
    name, type, managerUsername, managerPassword, managerDisplayName, splitMode,
  }),
  update: (id: string, name: string, type: string, splitMode?: string) =>
    http.put(`/studios/${id}`, { name, type, splitMode }),
  delete: (id: string) => http.delete(`/studios/${id}`),
};
