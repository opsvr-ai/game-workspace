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
  // 离职 / 复职：陪玩、客服、店长通用（账号停用，历史记录保留）
  resign: (id: string) => http.post(`/employees/${id}/resign`),
  restore: (id: string) => http.post(`/employees/${id}/restore`),
  delete: (id: string) => http.delete(`/employees/${id}`),
};
