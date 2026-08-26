import { Tray, Menu, nativeImage } from 'electron';
import path from 'path';

let tray: Tray | null = null;
let onShowCallback: (() => void) | null = null;
let onStatusChange: ((status: string) => void) | null = null;
let onQuitCallback: (() => void) | null = null;
let spinTimer: ReturnType<typeof setInterval> | null = null;
let spinIndex = 0;

interface TrayOptions {
  onShow: () => void;
  onStatusChange?: (status: string) => void;
  onQuit: () => void;
}

export function createTray(opts: TrayOptions): Tray {
  onShowCallback = opts.onShow;
  onStatusChange = opts.onStatusChange || null;
  onQuitCallback = opts.onQuit;

  const icon = createTrayIcon();
  tray = new Tray(icon);

  tray.setToolTip('陪玩管理');
  tray.setContextMenu(buildMenu());

  tray.on('double-click', () => {
    onShowCallback?.();
  });
  tray.on('click', () => {
    onShowCallback?.();
  });

  return tray;
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => onShowCallback?.(),
    },
    {
      label: '切换状态',
      submenu: [
        {
          label: '空闲',
          click: () => {
            if (onStatusChange) onStatusChange('AVAILABLE');
          },
        },
        {
          label: '接单',
          click: () => {
            if (onStatusChange) onStatusChange('BUSY');
          },
        },
        {
          label: '娱乐',
          click: () => {
            if (onStatusChange) onStatusChange('ENTERTAINMENT');
          },
        },
        {
          label: '休息',
          click: () => {
            if (onStatusChange) onStatusChange('RESTING');
          },
        },
      ],
    },
    { type: 'separator' },
    { label: '退出', click: () => onQuitCallback?.() },
  ]);
}

export function updateTrayTooltip(text: string): void {
  tray?.setToolTip(text);
}

export function updateTrayMenu(items: Electron.MenuItemConstructorOptions[]): void {
  tray?.setContextMenu(Menu.buildFromTemplate(items));
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
  const iconPath = path.join(__dirname, '../dist/donkey.png');
  try {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    const size = 16;
    const buf = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const px = (y * size + x) * 4;
        const dist = Math.sqrt((x - 8) ** 2 + (y - 8) ** 2);
        if (dist <= 6) {
          buf[px] = 0x8b;
          buf[px + 1] = 0x45;
          buf[px + 2] = 0x13;
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
}
