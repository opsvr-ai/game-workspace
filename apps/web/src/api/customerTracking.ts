import http from './client';

export const customerTrackingApi = {
  status: () => http.get('/customer-tracking/status'),
  registerContact: (data: Record<string, unknown>) => http.post('/customer-tracking/contacts', data),
  tracks: (customerId?: string) => http.get('/customer-tracking/tracks', { params: { customerId } }),
  addTrack: (data: Record<string, unknown>) => http.post('/customer-tracking/tracks', data),
  reminders: () => http.get('/customer-tracking/reminders'),
  deleteRequests: (status?: string) => http.get('/customer-tracking/delete-requests', { params: { status } }),
  submitDeleteRequest: (data: Record<string, unknown>) => http.post('/customer-tracking/delete-requests', data),
  reviewDeleteRequest: (id: string, approve: boolean, rejectReason?: string) =>
    http.post(`/customer-tracking/delete-requests/${id}/review`, { approve, rejectReason }),
  kpi: () => http.get('/customer-tracking/kpi'),
  anomalies: () => http.get('/customer-tracking/anomalies'),
};
