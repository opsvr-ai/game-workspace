import http from './client';

export interface BattleScreenshot {
  id: string;
  companionId: string;
  customerId?: string | null;
  images: string[];
  imageStatuses?: string[] | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  note?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  reviewedBy?: { username?: string; displayName?: string | null } | null;
  companion?: { user?: { username?: string; displayName?: string | null; avatar?: string | null } };
  customer?: { customerCode?: string; wechatId?: string };
}

export const battleScreenshotsApi = {
  upload: (files: File[], customerId?: string) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    if (customerId) form.append('customerId', customerId);
    return http.post('/battle-screenshots', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  mine: () => http.get('/battle-screenshots/mine'),
  list: (status?: string) => http.get('/battle-screenshots', { params: { status } }),
  review: (id: string, action: 'approve' | 'reject', note?: string) =>
    http.post(`/battle-screenshots/${id}/review`, { action, note }),
  reviewImage: (id: string, index: number, action: 'approve' | 'reject', note?: string) =>
    http.post(`/battle-screenshots/${id}/images/${index}/review`, { action, note }),
  downloadUrl: (id: string) => `/api/battle-screenshots/${id}/download`,
};
