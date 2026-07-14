import http from './client';

export const agentApi = {
  getVersion: () => http.get('/agent/version'),
  getVersionStatus: () => http.get('/agent/version-status'),
  buildAndPush: () => http.post('/agent/build-and-push'),
};
