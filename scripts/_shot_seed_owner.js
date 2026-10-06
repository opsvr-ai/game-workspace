/**
 * 截图前注入的一段脚本：让前端以为「已经登录，而且登录的是老板」。
 * 配合 scripts/_shot_ui.mjs 的 --pre= 用：
 *   node scripts/_shot_ui.mjs http://127.0.0.1:8123/cs/dispatch out.png --pre=scripts/_shot_seed_owner.js
 * 只写本地 storage，不发任何请求，也不碰线上。
 */
try {
  sessionStorage.setItem('accessToken', 'mock-access');
  localStorage.setItem('refreshToken', 'mock-refresh');
} catch (e) {
  /* 隐私模式下写不了 storage，那就只能看到登录页 */
}
