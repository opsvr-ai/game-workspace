import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(path.dirname(app.getPath('exe')), 'companion-config.json');

interface AppConfig {
  serverUrl: string;
}

const defaultConfig: AppConfig = {
  serverUrl: process.env.API_URL || 'http://192.168.0.106:3001',
};

export function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return { ...defaultConfig, ...JSON.parse(raw) };
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
