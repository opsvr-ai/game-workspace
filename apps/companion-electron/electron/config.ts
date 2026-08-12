import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(path.dirname(app.getPath('exe')), 'companion-config.json');
const RESOURCE_CONFIG_PATH = path.join(process.resourcesPath || '', 'companion-config.json');

interface AppConfig {
  serverUrl: string;
}

const defaultConfig: AppConfig = {
  serverUrl: process.env.API_URL || 'http://localhost:3001',
};

export function loadConfig(): AppConfig {
  try {
    // Check next to exe first, then resources (electron-builder extraResources)
    for (const p of [CONFIG_PATH, RESOURCE_CONFIG_PATH]) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        return { ...defaultConfig, ...JSON.parse(raw) };
      }
    }
  } catch { /* ignore */ }
  // Write default config if not exists
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
  } catch { /* ignore */ }
  return defaultConfig;
}

export function getServerUrl(): string {
  return loadConfig().serverUrl;
}
