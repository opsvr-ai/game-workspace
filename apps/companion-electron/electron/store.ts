import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const STORE_PATH = path.join(app.getPath('userData'), 'config.json');

function readStore(): Record<string, any> {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

function writeStore(data: Record<string, any>): void {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

const defaults: Record<string, any> = {
  serverUrl: 'http://localhost:3001',
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
