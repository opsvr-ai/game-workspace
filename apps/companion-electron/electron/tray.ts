import { Tray, Menu, nativeImage, app } from 'electron';
import fs from 'fs';
import path from 'path';

import {
  normalizeShellRole,
  trayMenuTemplate,
  trayTooltip,
  type ShellRole,
} from './role-policy';

let tray: Tray | null = null;
let onShowCallback: (() => void) | null = null;
let onStatusChange: ((status: string) => void) | null = null;
let onQuitCallback: (() => void) | null = null;
/** 当前托盘按哪个角色画菜单：只有 COMPANION 出现「切换状态」。 */
let currentRole: ShellRole = 'UNKNOWN';
/** 托盘提示里带的工作室名（网页 setStudioName 写进来的）。 */
let currentStudioName = '';
/** 重新加载页面的回调由 main.ts 注入（掉线兜底，从客服端外壳移植）。 */
let onReloadCallback: (() => void) | null = null;
let spinTimer: ReturnType<typeof setInterval> | null = null;
let spinIndex = 0;

interface TrayOptions {
  onShow: () => void;
  onStatusChange?: (status: string) => void;
  onQuit: () => void;
  /** 初始角色：启动时先用上次登录 / UNKNOWN 起，避免未登录机器按陪玩画菜单。 */
  role?: ShellRole | string;
  /** 初始工作室名（store 里上一次的），让重启后标题不丢品牌。 */
  studioName?: string;
}

export function createTray(opts: TrayOptions): Tray | null {
  onShowCallback = opts.onShow;
  onStatusChange = opts.onStatusChange || null;
  onQuitCallback = opts.onQuit;
  currentRole = normalizeShellRole(opts.role);
  currentStudioName = String(opts.studioName || '');

  const icon = createTrayIcon();
  // 托盘建不出来（图标读不到、系统托盘不可用等）时返回 null：
  // 调用方必须据此放弃「关窗口=隐藏」，否则窗口一关就再也叫不回来了。
  let created: Tray;
  try {
    created = new Tray(icon);
  } catch (err) {
    console.warn('Tray creation failed:', err instanceof Error ? err.message : err);
    tray = null;
    return null;
  }
  tray = created;

  created.setToolTip(trayTooltip(currentRole, currentStudioName, app.getVersion()));
  created.setContextMenu(buildMenu(currentRole));

  created.on('double-click', () => {
    onShowCallback?.();
  });
  created.on('click', () => {
    onShowCallback?.();
  });

  return created;
}

/** 注入「重新加载页面」的回调（掉线兜底页旁边的手动重试入口，来自客服端外壳）。 */
export function setTrayReloadHandler(handler: (() => void) | null): void {
  onReloadCallback = handler;
  if (tray) tray.setContextMenu(buildMenu(currentRole));
}

function buildMenu(role: ShellRole): Menu {
  const template = trayMenuTemplate(role, {
    onShow: () => onShowCallback?.(),
    onStatusChange: onStatusChange ? (status: string) => onStatusChange?.(status) : undefined,
    onReload: onReloadCallback ? () => onReloadCallback?.() : undefined,
    onQuit: () => onQuitCallback?.(),
  });
  // role-policy 里那份菜单结构就是按 MenuItemConstructorOptions 的形状写的，
  // 这里只是为了不把 electron 类型引到纯函数文件里才做一次断言。
  return Menu.buildFromTemplate(template as unknown as Electron.MenuItemConstructorOptions[]);
}

/**
 * 角色变了 / 工作室名变了：统一刷新托盘提示 + 菜单。
 *
 * 这是「一个安装包按登录角色自适应」的托盘落点：
 * 客服账号登进来时「切换状态」子菜单会消失，陪玩登进来时再出现。
 */
export function updateTrayRole(role: ShellRole | string, studioName?: string): void {
  currentRole = normalizeShellRole(role);
  if (studioName !== undefined) currentStudioName = String(studioName || '');
  const tip = trayTooltip(currentRole, currentStudioName, app.getVersion());
  tray?.setToolTip(tip);
  if (tray) tray.setContextMenu(buildMenu(currentRole));
}

/** 恢复「正常」托盘提示（更新进度结束后用；会带上当前工作室名）。 */
export function restoreTrayTooltip(): void {
  tray?.setToolTip(trayTooltip(currentRole, currentStudioName, app.getVersion()));
}

export function updateTrayTooltip(text: string): void {
  tray?.setToolTip(text);
}

// 创建一帧「加载中」图标：灰色圆环 + 一个旋转的亮点，模拟转圈圈
function createSpinFrame(step: number, total = 8): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = 8;
  const cy = 8;
  const r = 6;
  const setPx = (x: number, y: number, rr: number, gg: number, bb: number, aa: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const p = (y * size + x) * 4;
    buf[p] = rr;
    buf[p + 1] = gg;
    buf[p + 2] = bb;
    buf[p + 3] = aa;
  };
  // 灰色圆环
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d >= r - 1.4 && d <= r + 1.2) setPx(x, y, 0x88, 0x88, 0x88, 0xff);
    }
  }
  // 旋转亮点
  const angle = (step / total) * Math.PI * 2;
  const px = Math.round(cx + r * Math.cos(angle));
  const py = Math.round(cy + r * Math.sin(angle));
  setPx(px, py, 0x00, 0xd4, 0xff, 0xff);
  setPx(px - 1, py, 0x00, 0xd4, 0xff, 0xff);
  setPx(px + 1, py, 0x00, 0xd4, 0xff, 0xff);
  setPx(px, py - 1, 0x00, 0xd4, 0xff, 0xff);
  setPx(px, py + 1, 0x00, 0xd4, 0xff, 0xff);
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

// 开始托盘图标转圈（更新中）
export function startUpdateSpin(): void {
  if (spinTimer) return;
  spinIndex = 0;
  const total = 8;
  const frames: Electron.NativeImage[] = [];
  for (let i = 0; i < total; i++) frames.push(createSpinFrame(i, total));
  tray?.setImage(frames[0]);
  spinTimer = setInterval(() => {
    spinIndex = (spinIndex + 1) % total;
    tray?.setImage(frames[spinIndex]);
  }, 150);
}

// 停止转圈，恢复原始图标
export function stopUpdateSpin(): void {
  if (spinTimer) {
    clearInterval(spinTimer);
    spinTimer = null;
  }
  tray?.setImage(createTrayIcon());
}

function createTrayIcon() {
  // createFromPath 在文件不存在时不会抛错，只会返回「空图片」，托盘里什么都看不见。
  // 所以这里必须自己 existsSync + isEmpty() 双重判断，否则托盘图标会静默失踪。
  // 托盘图标是「绿色方块 + 白驴」（scripts/_make_tray_icons.py 生成）：老板 2026-10-15 报
  // 右下角两个驴图标长得一模一样、分不清哪个是陪玩哪个是客服 —— 现在陪玩是绿的、客服是蓝的。
  // 统一客户端后图标仍是绿色这套（安装包/资源路径不动），老 donkey.png 留着兜底：
  // 万一新图没打进包，也不至于让托盘变成空白。
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'tray-companion.png') : '',
    path.join(__dirname, '../public/tray-companion.png'),
    path.join(__dirname, '../dist/tray-companion.png'),
    process.resourcesPath ? path.join(process.resourcesPath, 'donkey.png') : '',
    path.join(__dirname, '../dist/donkey.png'),
    path.join(__dirname, '../public/donkey.png'),
    path.join(__dirname, 'donkey.png'),
  ];
  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const img = nativeImage.createFromPath(candidate);
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
    } catch {
      // 换下一个候选路径
    }
  }
  // 最后的兜底：画一个深灰色小圆点，保证右下角一定有个看得见的图标。
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (y * size + x) * 4;
      const dist = Math.sqrt((x - 8) ** 2 + (y - 8) ** 2);
      if (dist <= 6) {
        buf[px] = 0x4b;
        buf[px + 1] = 0x55;
        buf[px + 2] = 0x63;
        buf[px + 3] = 0xff;
      } else {
        buf[px] = 0;
        buf[px + 1] = 0;
        buf[px + 2] = 0;
        buf[px + 3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}
