import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const STORE_PATH = path.join(app.getPath('userData'), 'config.json');
const BACKUP_PATH = `${STORE_PATH}.bak`;
const TEMP_PATH = `${STORE_PATH}.tmp`;

function parseStoreFile(file: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readStore(): Record<string, any> {
  const main = parseStoreFile(STORE_PATH);
  if (main) return main;
  // 更新/关机时进程被强杀可能留下写了一半的 config.json。
  // 主文件坏了就回退到上一次成功写入的备份，恢复 token，避免下次打开变登录页。
  const backup = parseStoreFile(BACKUP_PATH);
  if (backup) {
    try { fs.copyFileSync(BACKUP_PATH, STORE_PATH); } catch {}
    return backup;
  }
  return {};
}

function writeStore(data: Record<string, any>): void {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    const body = JSON.stringify(data, null, 2);

    // 先写临时文件并 fsync，再原子替换；绝不直接覆盖主文件。
    const fd = fs.openSync(TEMP_PATH, 'w');
    try {
      fs.writeFileSync(fd, body, 'utf-8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    // 只有当前主文件本身是合法 JSON 才备份，避免把坏文件备份成“好文件”。
    if (parseStoreFile(STORE_PATH)) {
      try { fs.copyFileSync(STORE_PATH, BACKUP_PATH); } catch {}
    }
    try {
      fs.renameSync(TEMP_PATH, STORE_PATH);
    } catch {
      // 少数 Windows 文件句柄场景 rename 会失败：退化为覆盖写，但仍保留 .bak。
      fs.copyFileSync(TEMP_PATH, STORE_PATH);
      try { fs.unlinkSync(TEMP_PATH); } catch {}
    }
  } catch { /* ignore */ }
}

const defaults: Record<string, any> = {
  serverUrl: 'http://1.117.229.36:3001',
  username: '',
  token: '',
  companionId: '',
  companionName: '',
};

export const store = {
  get(key: string): any {
    const data = readStore();
    return data[key] !== undefined ? data[key] : defaults[key];
  },
  set(key: string, value: any): void {
    const data = readStore();
    data[key] = value;
    writeStore(data);
  },
  getAll(): Record<string, any> {
    return { ...defaults, ...readStore() };
  },
};
