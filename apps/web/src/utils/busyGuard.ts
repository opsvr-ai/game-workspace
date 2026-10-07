/**
 * 「现在有还没提交的内容」的登记处（老板 2026-10-08）。
 *
 * 老板报的问题：「发布订单或者聊天的时候 软件经常会刷新一下 然后好不容易输入的东西就全没了」。
 * 查到的两条根因都不在业务代码里（见 docs/USER_MANUAL.md 附录 / CHANGELOG）：
 *   ① 陪玩端主进程每 5 分钟问一次 `/api/agent/frontend-version`，**只要版本号变了就无条件
 *      `webContents.reload()`** —— 我们每发一次网页版号它就变一次（一天好几次），正在打字也照刷；
 *   ② 系统休眠唤醒后主进程还会再 `reload()` 一次（原意是防白屏）。
 * 网页拦不住主进程主动发起的 reload，但 Electron 有个默认行为帮得上忙：**页面挂了 beforeunload
 * 且 Chromium 认为该拦时，主进程的 reload 会被取消**（实测 Electron 30：有过用户交互的页面会被拦下，
 * 刚打开、没碰过的页面按 Chromium 规则忽略 —— 那种页面本来也没有可丢的输入）。
 * 所以这里做两件事：
 *   ① 谁有还没提交的内容就在这里登记：**组件挂载时登记、卸载时撤销**（不落 localStorage，
 *      免得一条陈旧草稿把刷新永久拦住）；
 *   ② `installUnloadGuard()` 给 AppLayout 挂一个 beforeunload：有人在写东西就拦下这次刷新，
 *      并提示一句「提交完 / 清空后才会更新」—— 页面还在，所以这句提示用户看得见。
 */
import { message } from './feedback';

/** id → 是否正在写。id 建议用「草稿键」，一眼能看出是谁在拦。 */
const busy = new Map<string, boolean>();

export function setBusy(id: string, isBusy: boolean): void {
  if (!id) return;
  if (isBusy) busy.set(id, true);
  else busy.delete(id);
}

export function clearBusy(id: string): void {
  busy.delete(id);
}

/** 现在有没有人正在写还没提交的东西。 */
export function isAnyBusy(): boolean {
  for (const value of busy.values()) {
    if (value) return true;
  }
  return false;
}

/** 谁在拦（排查用 / 测试用）。 */
export function busyIds(): string[] {
  return [...busy.keys()];
}

/** 测试用：清空登记。 */
export function resetBusyForTest(): void {
  busy.clear();
}

export const UNSAVED_NOTICE =
  '有还没提交的内容，这次自动更新先给你拦住了 —— 提交（或清空）之后才会更新到新版。';

/**
 * 把「现在有没有人在写」挂到 window 上，让**客户端主进程**能问（老板 2026-10-08）。
 *
 * 主进程够不着网页的模块，只能用 webContents.executeJavaScript 问 window 上的东西；
 * 它问的那个名字写死在 apps/companion-electron/electron/reload-policy.ts 的 PAGE_BUSY_PROBE 里，
 * 两边各改一边就等于没改 —— 所以那边有单测读这个文件、比对名字。
 *
 * 注意：这只是**给主进程看的**。真正的「拦住这次刷新」还是下面那个 beforeunload
 * （Chromium 认为页面有用户交互时，Electron 会因此取消主进程发起的 reload）。
 */
export function exposeBusyGuard(): void {
  try {
    (window as any).__chunlvBusyGuard = { isBusy: isAnyBusy, ids: busyIds };
  } catch {
    // 非浏览器环境（单测 / 服务端渲染）忽略：这个方法只是给客户端外壳用的。
  }
}

/**
 * 挂一个 beforeunload 守卫：有人在写东西就拦下这次刷新 / 换页。
 * 返回解绑函数（AppLayout 卸载时调用）。
 */
export function installUnloadGuard(): () => void {
  // 顺手把查询口挂上：主进程每次想 reload 之前会先问这里（见上面的说明）。
  exposeBusyGuard();
  let lastNoticeAt = 0;
  const handler = (e: BeforeUnloadEvent) => {
    if (!isAnyBusy()) return;
    // 这两行就是「拦住」本身：Electron 默认会因此取消这次 reload（浏览器里则是弹确认框）。
    e.preventDefault();
    e.returnValue = UNSAVED_NOTICE;
    // 页面没被卸载，所以这句提示看得见。主进程 5 分钟才问一次版本，再节流 30 秒足够。
    const now = Date.now();
    if (now - lastNoticeAt > 30_000) {
      lastNoticeAt = now;
      message.warning(UNSAVED_NOTICE);
    }
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}
