import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(path.dirname(app.getPath('exe')), 'companion-config.json');
const RESOURCE_CONFIG_PATH = path.join(process.resourcesPath || '', 'companion-config.json');

// 云服务器是唯一权威地址。历史旧配置可能指向 localhost 或旧内网 192.168.0.106，
// 统一归位到云服务器，避免加载不到前端导致登录页白屏。
const CLOUD_URL = 'http://1.117.229.36:3001';

interface AppConfig {
  serverUrl: string;
}

const defaultConfig: AppConfig = {
  serverUrl: process.env.API_URL || CLOUD_URL,
};

// 过滤历史坏地址：空值 / localhost / 127.0.0.1 / 旧内网 192.168.0.106。
function normalizeServerUrl(url?: string): string {
  const u = (url || '').trim().replace(/\/+$/, '');
  if (!u || /localhost|127\.0\.0\.1|192\.168\.0\.106/i.test(u)) return CLOUD_URL;
  return u;
}

export function loadConfig(): AppConfig {
  // 优先读 exe 旁边的用户配置（允许覆盖），再读打包进 resources 的官方配置。
  for (const p of [CONFIG_PATH, RESOURCE_CONFIG_PATH]) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, 'utf-8');
      const cfg = JSON.parse(raw);
      return { serverUrl: normalizeServerUrl(cfg?.serverUrl) };
    } catch {
      // 配置损坏则跳过，继续读下一处或回落到默认云服务器地址
    }
  }
  return defaultConfig;
}

export function getServerUrl(): string {
  return normalizeServerUrl(loadConfig().serverUrl);
}
