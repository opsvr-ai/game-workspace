import http from './client';

export const studiosApi = {
  list: () => http.get('/studios'),
  create: (formData: FormData) =>
    http.post('/studios', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  update: (id: string, name: string, type: string, splitMode?: string, address?: string) =>
    http.put(`/studios/${id}`, { name, type, splitMode, address }),
  delete: (id: string) => http.delete(`/studios/${id}`),
};
