import http from './client';

export const agentApi = {
  getVersion: () => http.get('/agent/version'),
  getVersionStatus: () => http.get('/agent/version-status'),
  buildAndPush: () => http.post('/agent/build-and-push'),
  pushUpdate: (companionIds: string[]) => http.post('/agent/update/push', { companionIds }),
  pushUpdateStudio: () => http.post('/agent/update/push-studio'),
  getDeployScript: () => http.get('/agent/deploy/script'),
  getRemoteDeployScript: (data: { targetIPs: string[]; adminUser: string; adminPass: string }) =>
    http.post('/agent/deploy/remote-script', data),
};
