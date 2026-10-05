// craftsman-ignore: TS001,TS003
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  pwSubmit: (pass: string) => ipcRenderer.send('pw:submit', pass),
  promptLogoutPassword: () => ipcRenderer.invoke('auth:promptLogoutPassword'),
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  getSavedCredentials: () => ipcRenderer.invoke('credentials:get'),
  saveCredentials: (creds: { username: string; password: string }) =>
    ipcRenderer.invoke('credentials:save', creds),
  clearSavedCredentials: () => ipcRenderer.invoke('credentials:clear'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  setAppPassword: (oldPassword: string, newPassword: string) =>
    ipcRenderer.invoke('app:set-password', oldPassword, newPassword),
  sessionWatch: (sessionId: string) => ipcRenderer.send('session:watch', sessionId),
  sessionWatchStop: () => ipcRenderer.invoke('session:watch-stop'),
  sessionPause: () => ipcRenderer.send('session:pause'),
  sessionResume: () => ipcRenderer.send('session:resume'),
  unlockScreen: (pass: string) => ipcRenderer.invoke('screen:unlock', pass),
  getServerUrl: () => ipcRenderer.invoke('config:getServerUrl'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  /** 打开/聚焦一个「独立的聊天窗口」（一个联系人一个系统窗口，能最小化到任务栏 —— 老板 2026-10-05）。 */
  openChatWindow: (payload: {
    conversationId: string;
    userId?: string;
    name?: string;
    avatar?: string;
    role?: string;
    orderInfo?: string | null;
  }) => ipcRenderer.invoke('chat:open-window', payload),
  openFolder: (path: string) => ipcRenderer.invoke('folder:open', path),
  testWatchdog: () => ipcRenderer.invoke('watchdog:test'),
  collectProcesses: (token: string) => ipcRenderer.invoke('processes:collect', token),
  onStatusChanged: (status: string) => ipcRenderer.send('companion:status', status),
  setRole: (role: string) => ipcRenderer.send('auth:setRole', role),
  setCurrentUser: (userId: string, username: string) => ipcRenderer.send('auth:setCurrentUser', userId, username),
  setStudioName: (name: string) => ipcRenderer.send('auth:setStudioName', name),
  notify: (title: string, body: string) => ipcRenderer.send('notify', title, body),
  /** 新单横幅：鼠标移到卡片上时告诉主进程「这块可点」（其余时候保持鼠标穿透，不挡玩游戏）。 */
  orderBannerHover: (over: boolean) => ipcRenderer.send('order-banner:hover', !!over),
  /** 点横幅：跳到抢单池并把这一单标出来。 */
  orderBannerClick: (orderId: string) => ipcRenderer.send('order-banner:click', String(orderId || '')),
  /** 主进程叫界面「去抢单池看这单」的回调（返回取消订阅函数）。 */
  onOrderPoolFocus: (cb: (payload: { orderId?: string }) => void) => {
    const handler = (_e: unknown, payload: { orderId?: string }) => cb(payload || {});
    ipcRenderer.on('order-pool-focus', handler as any);
    return () => ipcRenderer.removeListener('order-pool-focus', handler as any);
  },
  /** 点横幅上的「动作」（搭档邀请 / 转让 / 会话等）：主进程会把界面拉到最前并回执。 */
  bannerAction: (action: string, payload?: unknown) =>
    ipcRenderer.send('banner:action', String(action || ''), payload ?? null),
  /** 主进程回执「用户点了横幅上的动作」（返回取消订阅函数）。 */
  onBannerAction: (cb: (data: { action?: string; payload?: any }) => void) => {
    const handler = (_e: unknown, data: { action?: string; payload?: any }) => cb(data || {});
    ipcRenderer.on('banner-action', handler as any);
    return () => ipcRenderer.removeListener('banner-action', handler as any);
  },
  /** 群聊广播 / 各类提醒：弹一个 Windows 置顶小窗（可带点击动作），到时自动消失。 */
  broadcastPopup: (payload: {
    title?: string;
    body?: string;
    icon?: string;
    seconds?: number;
    hint?: string;
    orderId?: string;
    action?: string;
    actionPayload?: unknown;
  }) => ipcRenderer.invoke('broadcast:popup', payload),
});
