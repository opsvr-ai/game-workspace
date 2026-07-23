import http from './client';

export const employeesApi = {
  list: (studioIdOrParams?: string | { studioId?: string; studioType?: string; role?: string }) => {
    const params =
      typeof studioIdOrParams === 'string'
        ? { studioId: studioIdOrParams }
        : studioIdOrParams || {};
    return http.get('/employees', { params });
  },
  create: (data: { username: string; password: string; role: string; studioId: string }) =>
    http.post('/employees', data),
  resetPassword: (id: string, password: string) =>
    http.put(`/employees/${id}/password`, { password }),
  delete: (id: string) => http.delete(`/employees/${id}`),
};
