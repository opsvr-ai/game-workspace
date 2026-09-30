import http from './client';

/** 一台客户端机器的台账（服务端 /api/agent/machines 返回）。 */
export interface MachineItem {
  machineId: string;
  /** machine=装了新版客户端的机器（能诊断）；cs-user=客服端还没升级；managed-pc=手工登记的陪玩电脑 */
  source: 'machine' | 'cs-user' | 'managed-pc' | string;
  clientType: 'CS' | 'COMPANION' | 'UNKNOWN' | string;
  hostname: string;
  label: string;
  windowsUser: string;
  loginUser: string;
  loginRole: string;
  ips: string[];
  primaryIp: string;
  mac: string;
  os: string;
  appVersion: string;
  /** 看门狗（SystemHelper）构建号：这台机器「自动更新 + 领远程任务」靠它 */
  watchdogBuild: string;
  remoteReady: boolean;
  remoteAccount: string;
  remotePassword: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  online: boolean;
  diagnosable: boolean;
  pendingTasks: number;
  lastTaskAt: string | null;
  lastTaskStatus: string | null;
}

export interface MachineListResult {
  diagScriptVersion: string;
  /** 云端那份看门狗的构建号：跟某台机器的 watchdogBuild 不一样就说明它停在老版本 */
  watchdogLatestBuild: string;
  total: number;
  onlineCount: number;
  remoteReadyCount: number;
  items: MachineItem[];
}

export interface MachineTask {
  id: string;
  machineId: string;
  machineLabel: string;
  clientType: string;
  type: 'diag' | 'shell' | 'enable-remote' | string;
  command: string;
  reason: string;
  createdBy: string;
  createdAt: string;
  status: 'pending' | 'running' | 'done' | 'failed' | string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  reportFile: string;
  reportPreview: string;
  reportLines: number;
  error: string;
}

export const machineApi = {
  list: () => http.get('/agent/machines'),
  diag: (machineId: string) => http.post(`/agent/machines/${encodeURIComponent(machineId)}/diag`, {}),
  enableRemote: (machineId: string) => http.post(`/agent/machines/${encodeURIComponent(machineId)}/enable-remote`, {}),
  shell: (machineId: string, command: string) =>
    http.post(`/agent/machines/${encodeURIComponent(machineId)}/shell`, { command }),
  tasks: (machineId: string, limit = 30) =>
    http.get(`/agent/machines/${encodeURIComponent(machineId)}/tasks`, { params: { limit } }),
  report: (taskId: string) => http.get(`/agent/machine-tasks/${encodeURIComponent(taskId)}/report`),
};

export const taskTypeLabels: Record<string, string> = {
  diag: '一键诊断',
  shell: '远程指令',
  'enable-remote': '开通远程管理',
};

export const taskStatusLabels: Record<string, { text: string; color: string }> = {
  pending: { text: '排队中', color: 'default' },
  running: { text: '执行中', color: 'processing' },
  done: { text: '已完成', color: 'success' },
  failed: { text: '失败', color: 'error' },
};
