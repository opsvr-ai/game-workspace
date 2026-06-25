import http from './client';

export const employeesApi = {
  list: (studioId: string) => http.get('/employees', { params: { studioId } }),
  create: (data: { username: string; password: string; role: string; studioId: string }) =>
    http.post('/employees', data),
  resetPassword: (id: string, password: string) =>
    http.put(`/employees/${id}/password`, { password }),
  delete: (id: string) => http.delete(`/employees/${id}`),
};
