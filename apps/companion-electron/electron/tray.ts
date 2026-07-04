import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';

let tray: Tray | null = null;
let onShowCallback: (() => void) | null = null;
let onQuitCallback: (() => void) | null = null;

interface TrayOptions {
  onShow: () => void;
  onQuit: () => void;
}

export function createTray(opts: TrayOptions): Tray {
  onShowCallback = opts.onShow;
  onQuitCallback = opts.onQuit;

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
  // Create a simple colored square icon using raw bitmap
  // 16x16 RGBA pixels - green circle on dark background
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (y * size + x) * 4;
      const cx = 8, cy = 8, r = 6;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

      if (dist <= r) {
        // Green circle
        buf[px] = 0x00;     // R
        buf[px + 1] = 0xE6; // G
        buf[px + 2] = 0x76; // B
        buf[px + 3] = 0xFF; // A
      } else if (dist <= r + 1) {
        // Anti-alias edge
        const alpha = Math.max(0, Math.min(255, (r + 1 - dist) * 255));
        buf[px] = 0x00;
        buf[px + 1] = 0xE6;
        buf[px + 2] = 0x76;
        buf[px + 3] = alpha;
      } else {
        // Transparent
        buf[px] = 0;
        buf[px + 1] = 0;
        buf[px + 2] = 0;
        buf[px + 3] = 0;
      }
    }
  }

  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}
