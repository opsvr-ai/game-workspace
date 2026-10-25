/**
 * 陪玩端前端热更：只在「非接单模式」自动刷新。
 *
 * 服务端心跳会告诉我们 inService；发现新构建号时先延迟 5 秒再 reload。
 * 这 5 秒里如果陪玩点了开始首单 / 收到搭档邀请，就取消本次刷新并提示「软件正在更新」，
 * 等这一单结束后的下一个心跳再自动更新。
 */
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
