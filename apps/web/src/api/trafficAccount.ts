import http from './client';

export interface TrafficAccountItem {
  id: string;
  studioId: string;
  userId: string;
  type: string;
  code?: string | null;
  trafficLevel?: string | null;
  accountRole?: string | null;
  accountStyle?: string | null;
  nickname: string;
  accountId?: string | null;
  wifi?: string | null;
  wifiRegion?: string | null;
  riskPopped?: string | null;
  riskNote?: string | null;
  banned?: string | null;
  banNote?: string | null;
  phone?: string | null;
  promotionContact?: string | null;
  realName?: string | null;
  realNameAge?: number | null;
  realNameGender?: string | null;
  followers?: number | null;
  registerDate?: string | null;
  banDate?: string | null;
  imageSourceNote?: string | null;
  imageFolder?: string | null;
  otherNote?: string | null;
  extra?: Record<string, any>;
  status: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { username: string; displayName?: string };
}

export interface TrafficNoteItem {
  id: string;
  accountId: string;
  publishDate?: string | null;
  title?: string | null;
  exposure?: number | null;
  views?: number | null;
  clickRate?: number | null;
  interactionRate?: number | null;
  followRatio?: number | null;
  dmRate?: number | null;
  readCompletionRate?: number | null;
  likes?: number | null;
  comments?: number | null;
  favorites?: number | null;
  homeRecommendRatio?: number | null;
  searchRatio?: number | null;
  profileRatio?: number | null;
  searchKeywords?: Array<{ word: string; ratio?: number | null }> | null;
  cityDist?: Array<{ city: string; ratio?: number | null }> | null;
  interests?: Array<{ interest: string; ratio?: number | null }> | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const trafficAccountApi = {
  list: (scope?: string) => http.get('/traffic-accounts', { params: scope ? { scope } : undefined }),
  create: (data: any) =>
    http.post('/traffic-accounts', data),
  update: (id: string, data: any) =>
    http.put(`/traffic-accounts/${id}`, data),
  remove: (id: string) => http.delete(`/traffic-accounts/${id}`),
  listNotes: (accountId: string) => http.get(`/traffic-accounts/${accountId}/notes`),
  createNote: (accountId: string, data: any) => http.post(`/traffic-accounts/${accountId}/notes`, data),
  updateNote: (noteId: string, data: any) => http.put(`/traffic-accounts/note/${noteId}`, data),
  removeNote: (noteId: string) => http.delete(`/traffic-accounts/note/${noteId}`),
  analyzeNotes: (accountId: string) => http.post(`/traffic-accounts/${accountId}/notes/analyze`),
  recognizeNote: (imageBase64: string, mimeType?: string) =>
    http.post('/traffic-accounts/note/recognize', { imageBase64, mimeType }),
  savePlayGuide: (content: string) => http.post('/traffic-accounts/play-guide', { content }),
};
