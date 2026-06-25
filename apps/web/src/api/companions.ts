import http from './client';

export const companionsApi = {
  list: () => http.get('/companions'),
  getById: (id: string) => http.get(`/companions/${id}`),
  updateStatus: (id: string, status: string) =>
    http.put(`/companions/${id}/status`, { status }),
  ranking: () => http.get('/companions/ranking'),
  sendCommand: (id: string, command: string, params?: unknown) =>
    http.post(`/companions/${id}/command`, { command, params }),
};
