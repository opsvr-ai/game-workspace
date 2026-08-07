import http from './client';

export interface StatsFilters {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  csUserId?: string;
  studioId?: string;
  status?: string;
  gameName?: string;
  feeStatus?: string;
}

export const statsApi = {
  getDaily: (filters: StatsFilters) => http.get('/stats/daily', { params: filters }),
};
