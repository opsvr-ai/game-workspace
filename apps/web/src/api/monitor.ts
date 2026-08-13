// craftsman-ignore: TS001,TS003
import http from './client';

export const monitorApi = {
  workRecords: (companionId: string, date?: string) =>
    http.get(`/companions/${companionId}/work-records`, { params: { date } }),
  reviewQueue: (date?: string) => http.get('/admin/review-queue', { params: { date } }),
  reviewQueueCount: () => http.get('/admin/review-queue-count'),
  markProcessed: (sessionId: string) => http.put(`/admin/review-queue/${sessionId}/processed`),
  uploadTransferScreenshot: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return http.post('/upload/screenshot', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};
