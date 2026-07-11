import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';

let tray: Tray | null = null;
let onShowCallback: (() => void) | null = null;
let onQuitCallback: (() => void) | null = null;
let onStatusChange: ((status: string) => void) | null = null;

interface TrayOptions {
  onShow: () => void;
  onQuit: () => void;
  onStatusChange?: (status: string) => void;
}

export function createTray(opts: TrayOptions): Tray {
  onShowCallback = opts.onShow;
  onQuitCallback = opts.onQuit;
  onStatusChange = opts.onStatusChange || null;

  // Create a simple 16x16 tray icon programmatically
  const icon = createTrayIcon();
  tray = new Tray(icon);

  tray.setToolTip('蠢驴电竞陪玩');
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
        { label: '空闲', click: () => { if (onStatusChange) onStatusChange('AVAILABLE'); } },
        { label: '接单', click: () => { if (onStatusChange) onStatusChange('BUSY'); } },
        { label: '娱乐', click: () => { if (onStatusChange) onStatusChange('ENTERTAINMENT'); } },
        { label: '休息', click: () => { if (onStatusChange) onStatusChange('RESTING'); } },
      ],
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => onQuitCallback?.(),
    },
  ]);
}

export function updateTrayTooltip(text: string): void {
  tray?.setToolTip(text);
}

export function updateTrayMenu(items: Electron.MenuItemConstructorOptions[]): void {
  tray?.setContextMenu(Menu.buildFromTemplate(items));
}

function createTrayIcon() {
  const iconPath = path.join(__dirname, '../dist/donkey.png');
  try {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    // Fallback: simple colored circle
    const size = 16;
    const buf = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const px = (y * size + x) * 4;
        const dist = Math.sqrt((x - 8) ** 2 + (y - 8) ** 2);
        if (dist <= 6) { buf[px] = 0x8B; buf[px+1] = 0x45; buf[px+2] = 0x13; buf[px+3] = 0xFF; }
        else { buf[px] = 0; buf[px+1] = 0; buf[px+2] = 0; buf[px+3] = 0; }
      }
    }
    return nativeImage.createFromBuffer(buf, { width: size, height: size });
  }
}
