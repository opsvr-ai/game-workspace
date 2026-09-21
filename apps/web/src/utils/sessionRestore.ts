/**
 * 客户端启动后把「主进程里保存的登录态」恢复到网页端。
 *
 * 为什么需要它（老板 2026-09-22「electron 动不动就不自动登录」）：
 * 陪玩端的网页端把 accessToken 存在 sessionStorage 里，而 sessionStorage 是
 * 「本窗口本次运行」的东西 —— 客户端只要重启（崩溃自愈、看门狗拉起、更新、
 * 关机开机），它一定是空的。以前唯一的补救是「记住我」勾起来后保存的账号密码，
 * 可是：① 记住我默认没勾；② 不勾就登录一次，会把之前保存的账号密码**擦掉**。
 * 于是没勾过的人每次重启都得手打一次密码，看起来就是「动不动就不自动登录」。
 *
 * 主进程那边其实一直有一份可用的登录态：config.json 里存着 token 和
 * refreshToken（7 天有效，且看门狗每次换令牌都会写回）。这里把它读回来塞进
 * sessionStorage/localStorage，后面的请求走到 401 时会自动用 refreshToken 换新
 * 令牌 —— 全程不需要密码，也不用打扰正在接单的陪玩。
 *
 * 注意：只有「主动退出账号」（需要管理密码）才会清掉主进程里的令牌，
 * 所以从没登录过 / 已经退出账号的机器，这里读不到东西，仍然会老老实实显示登录页。
 */
export async function restoreClientSession(): Promise<boolean> {
  try {
    const api = (window as any).electronAPI;
    // 浏览器里没有这套 IPC，直接跳过（网页端行为保持不变）。
    if (!api?.storeGet) return false;
    // 本次运行已经有令牌，不用动。
    if (sessionStorage.getItem('accessToken')) return true;

    const [token, refreshToken] = await Promise.all([
      api.storeGet('token'),
      api.storeGet('refreshToken'),
    ]);
    if (!token && !refreshToken) return false;

    if (token) sessionStorage.setItem('accessToken', String(token));
    if (refreshToken) localStorage.setItem('refreshToken', String(refreshToken));
    return true;
  } catch {
    return false;
  }
}
