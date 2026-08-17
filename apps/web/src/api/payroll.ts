import http from './client';

export const payrollApi = {
  configs: () => http.get('/payroll/configs'),
  saveConfig: (data: any) => http.post('/payroll/configs', data),
  staff: () => http.get('/payroll/staff'),
  attendance: (data: { userId: string; date: string; status: string }) => http.post('/payroll/attendance', data),
  generate: (month: string) => http.post('/payroll/generate', { month }),
  records: (month: string) => http.get('/payroll/records', { params: { month } }),
};
