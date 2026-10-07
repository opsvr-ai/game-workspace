/**
 * 「这次要不要把网页整页重载」的判断（老板 2026-10-08 从 electron/main.ts 抽出来）。
 *
 * 背景：老板报「发布订单或者聊天的时候 软件经常会刷新一下 然后好不容易输入的东西就全没了」。
 * 根因在客户端外壳的两条路：
 *   ① 每 5 分钟问一次 /api/agent/frontend-version，**版号一变就无条件 reload()**（我们一天发好几次版号）；
 *   ② 系统休眠唤醒后再 reload() 一次（原意防白屏）—— 同样不看有没有在写。
 * 网页侧已经能拦住一部分（busyGuard 的 beforeunload 会让 Electron 取消这次 reload），但**主进程并不知情**：
 * 它已经把新版本记进本地了，于是「默认那一次刷」被拦下以后**再也不会重试**，机器就一直停在旧界面。
 *
 * 所以这里把「刷不刷」抽成一个纯函数，主进程拿着它的结论做事：
 *   * 页面在写 → 这一轮不动，而且**版号也别记**（下一个周期再来一次）；
 *   * 窗口没了 / 正在退出 → 没什么可刷的，但版号照记（下次开窗口本来就会重新拉最新页面）；
 *   * 其余情况 → 刷。
 *
 * 为什么单独一个文件：这段逻辑在开发机上没法真跑（要真打字、真休眠唤醒），
 * 抽成纯函数才能在单测里把每种情形都过一遍（见 reload-policy.test.ts）。
 */

/** 什么原因要重载：换前端版号 / 系统休眠唤醒。 */
export type ReloadKind = 'frontend-version' | 'system-resume';

export interface ReloadInput {
  kind: ReloadKind;
  /** 主窗口还在不在（销毁了就没什么可刷） */
  hasWindow: boolean;
  /** 正在退出程序 */
  quitting: boolean;
  /** 页面自报「有还没提交的内容」——登记处见 apps/web/src/utils/busyGuard.ts */
  pageBusy: boolean;
}

export interface ReloadDecision {
  /** 这次刷不刷 */
  reload: boolean;
  /** 因为页面在写而**推后**：调用方这次不要记版号，等下一轮 */
  deferred: boolean;
  reason: 'ok' | 'no-window' | 'quitting' | 'page-busy';
}

export function decidePageReload(input: ReloadInput): ReloadDecision {
  if (!input.hasWindow) return { reload: false, deferred: false, reason: 'no-window' };
  if (input.quitting) return { reload: false, deferred: false, reason: 'quitting' };
  if (input.pageBusy) return { reload: false, deferred: true, reason: 'page-busy' };
  return { reload: true, deferred: false, reason: 'ok' };
}

/**
 * 页面自报忙碌时要跑的那段 JS（主进程够不着网页的模块，只能问 window 上这个口子）。
 * 名字和 apps/web/src/utils/busyGuard.ts 里挂的**必须一致** —— 两边各改一边就是「白改」，
 * 所以这里有单测钉住这个字符串（reload-policy.test.ts）。
 */
export const PAGE_BUSY_PROBE =
  'Boolean(window.__chunlvBusyGuard && window.__chunlvBusyGuard.isBusy && window.__chunlvBusyGuard.isBusy())';
