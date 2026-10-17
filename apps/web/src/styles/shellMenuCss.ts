/**
 * 外壳的三段全局样式（角标脉冲 / 铃铛摇铃 / 侧边栏子菜单透明背景）。
 *
 * 从 layouts/AppLayout.tsx 原样搬出：id、keyframes 名称、CSS 文本逐字保留，
 * 仍然只在**第一次**注入（已有同 id 的 <style> 就跳过），避免热更新重复追加。
 */
export function installShellMenuCss(): void {
  // Badge pulse animation
  if (!document.getElementById('badge-pulse-css')) {
    const s = document.createElement('style');
    s.id = 'badge-pulse-css';
    s.textContent =
      '@keyframes badge-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}.pulse-badge{animation:badge-pulse 0.6s ease-in-out infinite;display:inline-block}';
    document.head.appendChild(s);
  }

  // Bell pulse animation
  if (!document.getElementById('bell-pulse-css')) {
    const s2 = document.createElement('style');
    s2.id = 'bell-pulse-css';
    s2.textContent =
      '@keyframes bell-ring{0%,100%{transform:rotate(0deg)}10%{transform:rotate(8deg)}20%{transform:rotate(-8deg)}30%{transform:rotate(6deg)}40%{transform:rotate(-6deg)}50%{transform:rotate(3deg)}60%{transform:rotate(-3deg)}70%{transform:rotate(0deg)}}.bell-animate{animation:bell-ring 0.8s ease-in-out;display:inline-block}';
    document.head.appendChild(s2);
  }

  // 侧边栏子菜单展开后保持透明，避免出现白色背景
  if (!document.getElementById('menu-sub-bg-css')) {
    const s3 = document.createElement('style');
    s3.id = 'menu-sub-bg-css';
    s3.textContent =
      '.ant-layout-sider .ant-menu, .ant-layout-sider .ant-menu-item, .ant-menu-sub .ant-menu-item, .ant-layout-sider .ant-menu-submenu-title, .ant-layout-sider .ant-menu-item:hover, .ant-layout-sider .ant-menu-item-active, .ant-layout-sider .ant-menu-item-selected, .ant-layout-sider .ant-menu-submenu-selected > .ant-menu-submenu-title, .ant-layout-sider .ant-menu-submenu-title:hover { background: transparent !important; background-color: transparent !important; } ' +
      '.ant-layout-sider .ant-menu-sub, .ant-layout-sider .ant-menu-submenu > .ant-menu, .ant-layout-sider .ant-menu-inline .ant-menu-sub, .ant-menu-dark .ant-menu-sub, .ant-menu-dark .ant-menu-submenu-popup, .ant-menu-dark .ant-menu-submenu > .ant-menu { background: var(--color-bg-sider) !important; background-color: var(--color-bg-sider) !important; }';
    document.head.appendChild(s3);
  }
}
