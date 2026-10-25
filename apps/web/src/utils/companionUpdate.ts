/**
 * 陪玩端前端热更：只在「非接单模式」自动刷新。
 *
 * 服务端心跳会告诉我们 inService；发现新构建号时先延迟 5 秒再 reload。
 * 这 5 秒里如果陪玩点了开始首单 / 收到搭档邀请，就取消本次刷新并提示「软件正在更新」，
 * 等这一单结束后的下一个心跳再自动更新。
 */
import { message } from './feedback';

let timer: ReturnType<typeof setTimeout> | null = null;
let scheduledBuild = '';

export function scheduleCompanionUpdate(buildId: string): void {
  if (!buildId || scheduledBuild === buildId || timer) return;
  scheduledBuild = buildId;
  timer = setTimeout(() => {
    timer = null;
    scheduledBuild = '';
    try {
      localStorage.setItem('webBuildId', buildId);
      localStorage.setItem('webBuildReloadAt', String(Date.now()));
    } catch {
      /* ignore */
    }
    window.location.reload();
  }, 5000);
}

export function isCompanionUpdateScheduled(): boolean {
  return !!timer;
}

export function cancelCompanionUpdateForService(): boolean {
  if (!timer) return false;
  clearTimeout(timer);
  timer = null;
  scheduledBuild = '';
  return true;
}

/**
 * 更新倒计时期间，所有「进入接单模式」的按钮统一拦住：
 * 开始首单 / 续单 / 复购 / 接受搭档邀请 / 代打任务 / 抢单 / 继续服务 等。
 * 不靠每个页面各写一遍，避免漏掉某个入口。
 */
const SERVICE_ACTION_RE = /开始首单|开始服务|续单|复购|接受邀请|接受代打|同意邀请|抢单|立即接单|继续服务/;

export function installCompanionUpdateClickGuard(): () => void {
  if (typeof document === 'undefined') return () => {};
  const handler = (event: Event) => {
    if (!isCompanionUpdateScheduled()) return;
    const target = event.target as HTMLElement | null;
    const el = target?.closest?.('button, [role="button"], a') as HTMLElement | null;
    const text = `${el?.innerText || el?.textContent || ''} ${target?.innerText || target?.textContent || ''}`;
    if (!SERVICE_ACTION_RE.test(text)) return;
    event.preventDefault();
    event.stopPropagation();
    message.warning('软件正在更新，请稍等');
  };
  document.addEventListener('click', handler, true);
  return () => document.removeEventListener('click', handler, true);
}
