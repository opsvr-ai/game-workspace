// electron/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("electronAPI", {
  pwSubmit: (pass) => import_electron.ipcRenderer.send("pw:submit", pass),
  promptLogoutPassword: () => import_electron.ipcRenderer.invoke("auth:promptLogoutPassword"),
  storeGet: (key) => import_electron.ipcRenderer.invoke("store:get", key),
  storeSet: (key, value) => import_electron.ipcRenderer.invoke("store:set", key, value),
  getSavedCredentials: () => import_electron.ipcRenderer.invoke("credentials:get"),
  saveCredentials: (creds) => import_electron.ipcRenderer.invoke("credentials:save", creds),
  clearSavedCredentials: () => import_electron.ipcRenderer.invoke("credentials:clear"),
  logout: () => import_electron.ipcRenderer.invoke("auth:logout"),
  setAppPassword: (oldPassword, newPassword) => import_electron.ipcRenderer.invoke("app:set-password", oldPassword, newPassword),
  sessionWatch: (sessionId) => import_electron.ipcRenderer.send("session:watch", sessionId),
  sessionWatchStop: () => import_electron.ipcRenderer.invoke("session:watch-stop"),
  sessionPause: () => import_electron.ipcRenderer.send("session:pause"),
  sessionResume: () => import_electron.ipcRenderer.send("session:resume"),
  unlockScreen: (pass) => import_electron.ipcRenderer.invoke("screen:unlock", pass),
  getServerUrl: () => import_electron.ipcRenderer.invoke("config:getServerUrl"),
  getAppVersion: () => import_electron.ipcRenderer.invoke("app:getVersion"),
  openFolder: (path) => import_electron.ipcRenderer.invoke("folder:open", path),
  testWatchdog: () => import_electron.ipcRenderer.invoke("watchdog:test"),
  collectProcesses: (token) => import_electron.ipcRenderer.invoke("processes:collect", token),
  onStatusChanged: (status) => import_electron.ipcRenderer.send("companion:status", status),
  setRole: (role) => import_electron.ipcRenderer.send("auth:setRole", role),
  setCurrentUser: (userId, username) => import_electron.ipcRenderer.send("auth:setCurrentUser", userId, username),
  setStudioName: (name) => import_electron.ipcRenderer.send("auth:setStudioName", name),
  notify: (title, body) => import_electron.ipcRenderer.send("notify", title, body),
  /** 新单横幅：鼠标移到卡片上时告诉主进程「这块可点」（其余时候保持鼠标穿透，不挡玩游戏）。 */
  orderBannerHover: (over) => import_electron.ipcRenderer.send("order-banner:hover", !!over),
  /** 点横幅：跳到抢单池并把这一单标出来。 */
  orderBannerClick: (orderId) => import_electron.ipcRenderer.send("order-banner:click", String(orderId || "")),
  /** 主进程叫界面「去抢单池看这单」的回调（返回取消订阅函数）。 */
  onOrderPoolFocus: (cb) => {
    const handler = (_e, payload) => cb(payload || {});
    import_electron.ipcRenderer.on("order-pool-focus", handler);
    return () => import_electron.ipcRenderer.removeListener("order-pool-focus", handler);
  },
  /** 点横幅上的「动作」（搭档邀请 / 转让 / 会话等）：主进程会把界面拉到最前并回执。 */
  bannerAction: (action, payload) => import_electron.ipcRenderer.send("banner:action", String(action || ""), payload ?? null),
  /** 主进程回执「用户点了横幅上的动作」（返回取消订阅函数）。 */
  onBannerAction: (cb) => {
    const handler = (_e, data) => cb(data || {});
    import_electron.ipcRenderer.on("banner-action", handler);
    return () => import_electron.ipcRenderer.removeListener("banner-action", handler);
  },
  /** 群聊广播 / 各类提醒：弹一个 Windows 置顶小窗（可带点击动作），到时自动消失。 */
  broadcastPopup: (payload) => import_electron.ipcRenderer.invoke("broadcast:popup", payload)
});
