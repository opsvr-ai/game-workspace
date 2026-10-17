// 角色策略：统一客户端按「登录角色」开关能力（2026-10-17 老板要求只保留一个通用安装包）。
//
// 背景：陪玩端和客服端以前是两个安装包，但加载同一份远端 Web。现在只发一个通用客户端
// （就是本外壳），网页登录 / 会话恢复时会把真实角色通过 `auth:setRole` 告诉主进程。
// 外壳据此决定：要不要开「休息=休眠」、要不要录屏、托盘要不要显示「切换状态」。
//
// 为什么把这些判断单独抽出来：它们错了的后果不是「页面打不开」，而是
//   - 客服机器被改电源设置 / 被录屏 / 被锁屏；
//   - 陪玩机器不再自动休息、服务中不截图。
// 而主进程本身没法在单测里真跑（要 electron + 真机器），所以这里保持**纯函数**，
// 由 role-policy.test.ts 钉住每条判断。
//
// 注意：本文件不许 import electron —— 只有一个目的：能直接跑 vitest。

/** 外壳认识的 4 个真实角色 + 「还不知道」。 */
export type ShellRole = 'COMPANION' | 'CS' | 'ADMIN' | 'OWNER' | 'UNKNOWN';

/** 所有用户可见的地方统一用这个中性品牌（不再叫「陪玩管理」/「客服管理」）。 */
export const SHELL_BRAND = '蠢驴电竞';

const KNOWN_ROLES = ['COMPANION', 'CS', 'ADMIN', 'OWNER'] as const;

/** 托盘菜单的一个节点（结构上兼容 Electron 的 MenuItemConstructorOptions，但不 import electron）。 */
export interface TrayMenuItem {
  label?: string;
  type?: 'separator';
  click?: () => void;
  submenu?: TrayMenuItem[];
}

/** 托盘菜单要的回调。重新加载页面是本次从客服端外壳移植过来的兜底能力。 */
export interface TrayMenuHandlers {
  onShow: () => void;
  onStatusChange?: (status: string) => void;
  onReload?: () => void;
  onQuit: () => void;
}

/**
 * 网页传过来的角色归一化。
 *
 * 老网页 / 没登录 / 传了脏值一律归到 'UNKNOWN'，**不能默认成 COMPANION**：
 * 默认陪玩会让「还没登录的机器」去改电源设置、按陪玩口径开始工作。
 * 大小写和前后空格容错（网页那边是枚举字符串，但历史版本有过小写）。
 */
export function normalizeShellRole(raw: unknown): ShellRole {
  const role = String(raw ?? '').trim().toUpperCase();
  return (KNOWN_ROLES as readonly string[]).includes(role) ? (role as ShellRole) : 'UNKNOWN';
}

/** 是不是陪玩（只有陪玩账号才开陪玩专属能力）。 */
export function isCompanionRole(role: unknown): boolean {
  return normalizeShellRole(role) === 'COMPANION';
}

/** 是不是「员工角色」：客服 / 店长 / 老板。都不是陪玩，但登录状态明确。 */
export function isStaffRole(role: unknown): boolean {
  const r = normalizeShellRole(role);
  return r === 'CS' || r === 'ADMIN' || r === 'OWNER';
}

/** 「休息 = 整机休眠」只对陪玩有意义；客服机器绝不能被改电源设置。 */
export function shouldEnableHibernate(role: unknown): boolean {
  return isCompanionRole(role);
}

/** 工作记录截图只给陪玩开；客服/店长/老板登录时不能录屏。 */
export function shouldStartCapture(role: unknown): boolean {
  return isCompanionRole(role);
}

/** 托盘里的「切换状态」子菜单只给陪玩；对客服是纯噪音。 */
export function shouldShowStatusTray(role: unknown): boolean {
  return isCompanionRole(role);
}

function brandWithVersion(version?: string): string {
  const v = String(version ?? '').trim();
  return v ? `${SHELL_BRAND} v${v}` : SHELL_BRAND;
}

/**
 * 窗口标题：未设置工作室时「蠢驴电竞 v<版本>」，设置后「<工作室> · 蠢驴电竞 v<版本>」。
 *
 * 角色参数目前不参与拼装 —— 四个角色看到的是同一个中性品牌（老板要的是「一个客户端」）。
 * 保留这个参数是为了和调用方/托盘提示保持同一套签名，将来要按角色加后缀时只改这里。
 */
export function shellTitle(_role: unknown, studioName?: string, version?: string): string {
  const studio = String(studioName ?? '').trim();
  return studio ? `${studio} · ${brandWithVersion(version)}` : brandWithVersion(version);
}

/** 托盘悬浮提示：与窗口标题保持同一个中性品牌。 */
export function trayTooltip(role: unknown, studioName?: string, version?: string): string {
  return shellTitle(role, studioName, version);
}

/**
 * 托盘右键菜单。
 *
 * - 「显示主窗口」「退出」所有角色都有；
 * - 「重新加载页面」来自客服端外壳的掉线兜底（传了 onReload 才出现）；
 * - 「切换状态」只给陪玩。客服/店长/老板/未登录都不显示 —— 他们切了这个状态也没人认。
 *   注意：这个子菜单**保持原样可见**（主进程历来没给它注入回调，点了不发请求）；
 *   本次只做「按角色收敛」，不擅自改变陪玩端已有的界面/业务语义。
 */
export function trayMenuTemplate(role: unknown, handlers: TrayMenuHandlers): TrayMenuItem[] {
  const items: TrayMenuItem[] = [{ label: '显示主窗口', click: () => handlers.onShow() }];

  if (handlers.onReload) {
    items.push({ label: '重新加载页面', click: () => handlers.onReload?.() });
  }

  if (shouldShowStatusTray(role)) {
    const change = (status: string) => handlers.onStatusChange?.(status);
    items.push({
      label: '切换状态',
      submenu: [
        { label: '空闲', click: () => change('AVAILABLE') },
        { label: '接单', click: () => change('BUSY') },
        { label: '娱乐', click: () => change('ENTERTAINMENT') },
        { label: '休息', click: () => change('RESTING') },
      ],
    });
  }

  items.push({ type: 'separator', label: '' }, { label: '退出', click: () => handlers.onQuit() });
  return items;
}
