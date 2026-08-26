// craftsman-ignore: TS001
import { app } from 'electron';
import { getServerUrl } from './config';
import { store } from './store';
import { logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { startUpdateSpin, stopUpdateSpin, updateTrayTooltip } from './tray';

// 更新信号：陪玩端（普通权限）写入，SystemHelper 服务（系统权限）轮询并执行下载解压。
function signalUpdate(downloadUrl: string, localPath?: string): void {
  const dir = 'C:\\ProgramData\\chunlv';
  const file = path.join(dir, 'update.json');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ url: downloadUrl, ...(localPath ? { localPath } : {}) }),
      'utf-8',
    );
    logger.info('Update signal written', { file });
  } catch (err: any) {
    logger.warn('Failed to write update signal', { error: err?.message || err });
  }
}

// 更新进度不再弹窗，改为更新托盘提示文字（配合托盘图标转圈）
function setUpdateProgress(percent: number): void {
  updateTrayTooltip(`陪玩管理 · 正在更新 ${percent}%`);
}

function downloadZipWithProgress(
  url: string,
  dest: string,
  onProgress: (p: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https')
      ? (require('https') as typeof import('https'))
      : (require('http') as typeof import('http'));
    const req = protocol.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`下载失败: HTTP ${res.statusCode}`));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) onProgress(Math.min(100, Math.round((received / total) * 100)));
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      file.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(300_000, () => {
      req.destroy();
      reject(new Error('下载超时'));
    });
  });
}

async function performUpdate(downloadUrl: string): Promise<void> {
  const localDir = 'C:\\ProgramData\\chunlv';
  const localZip = path.join(localDir, 'update.zip');
  startUpdateSpin();
  try {
    fs.mkdirSync(localDir, { recursive: true });
    await downloadZipWithProgress(downloadUrl, localZip, setUpdateProgress);
    setUpdateProgress(100);
    signalUpdate(downloadUrl, localZip);
    logger.info('Update downloaded, handing off to SystemHelper', { localZip });
  } catch (err: any) {
    logger.error('Download failed, fallback to SystemHelper download', { error: err?.message });
    signalUpdate(downloadUrl);
  }
  stopUpdateSpin();
  updateTrayTooltip('陪玩管理');
  // 交给 SystemHelper 解压重启
  setTimeout(() => { app.exit(0); }, 800);
}

/**
 * Compare two dot-separated version strings numerically.
 * Handles long segments like 1.0.20260810 (release-date style).
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * Check server for latest version, compare with local version.
 * If newer version available, download and install.
 */
export async function checkForUpdates(): Promise<void> {
  if (updateCheckRunning) return;
  updateCheckRunning = true;
  try {
    // 开机自动检查时随机错峰，避免所有客户端同时拉版本和安装包。
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 120_000)));
    const serverUrl = getServerUrl();
    const localVersion = app.getVersion();

    logger.info('Checking for updates', { localVersion, serverUrl });

    const res = await fetch(`${serverUrl}/api/agent/version`);
    const json = await res.json() as any;

    if (json?.code !== 200 || !json?.data) {
      logger.warn('Version check failed: invalid response', json);
      return;
    }

    const { version: latestVersion, downloadUrl } = json.data;

    // Only update when the server version is strictly NEWER than local.
    // A plain !== here caused an endless update loop whenever the server
    // config held an older version string (e.g. 1.0.0 vs 1.0.20260810):
    // every launch downloaded the installer, which killed the app, which
    // the watchdog then relaunched — forever.
    if (compareVersions(latestVersion, localVersion) <= 0) {
      logger.info('Already up-to-date', { local: localVersion, latest: latestVersion });
      return;
    }

    logger.info('New version available', {
      current: localVersion,
      latest: latestVersion,
    });

    const fullDownloadUrl = downloadUrl.startsWith('http')
      ? downloadUrl
      : `${serverUrl}${downloadUrl}`;

    await performUpdate(fullDownloadUrl);
  } catch (err: any) {
    logger.warn('Update check failed (non-fatal)', { error: err.message });
  } finally {
    updateCheckRunning = false;
  }
}

/**
 * Download installer exe and run silent install, then quit + relaunch.
 */
export async function downloadAndInstall(downloadUrl: string): Promise<void> {
  return downloadAndInstallWithRedirects(downloadUrl, 0);
}

const MAX_REDIRECTS = 5;
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;
let updateCheckRunning = false;

function runInstaller(installerPath: string): Promise<void> {
  const installDir = path.dirname(app.getPath('exe'));
  return new Promise<void>((resolve, reject) => {
    execFile(
      installerPath,
      ['/S', `/D=${installDir}`],
      { timeout: 120_000 },
      (err) => {
        if (err) {
          logger.error('Installer failed', { error: err.message });
          reject(new Error(`Installer failed: ${err.message}`));
          return;
        }
        resolve();
      },
    );
  });
}

async function downloadAndInstallWithRedirects(
  downloadUrl: string,
  redirectCount: number,
): Promise<void> {
  const tmpDir = path.join(app.getPath('temp'), 'chunlv-update');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const installerPath = path.join(tmpDir, 'ChunlvAgent-Setup.exe');
  const token = store.get('token') as string;

  // 每次更新都重新下载，避免复用上一次可能错误的安装包（例如旧的 AllInOne 修复工具），
  // 导致反复弹出「Install complete」并重启的死循环。
  try { fs.unlinkSync(installerPath); } catch { /* ignore */ }

  logger.info('Downloading update', { url: downloadUrl, dest: installerPath });

  // Download using Node.js http for stream support
  const http = require('http') as typeof import('http');
  const https = require('https') as typeof import('https');
  const protocol = downloadUrl.startsWith('https') ? https : http;

  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(installerPath);
    const req = protocol.get(
      downloadUrl,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      (response: any) => {
        // Handle redirect
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlinkSync(installerPath);
          if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error(`Too many redirects: ${downloadUrl}`));
            return;
          }
          const nextUrl = new URL(response.headers.location, downloadUrl).toString();
          downloadAndInstallWithRedirects(nextUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(installerPath);
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        if (totalSize > MAX_DOWNLOAD_BYTES) {
          file.close();
          fs.unlinkSync(installerPath);
          response.destroy();
          reject(new Error(`Download too large: ${totalSize} bytes`));
          return;
        }
        response.pipe(file);

        file.on('finish', () => {
          file.close();
          const actualSize = fs.statSync(installerPath).size;
          if (actualSize <= 0) {
            fs.unlinkSync(installerPath);
            reject(new Error('Downloaded file is empty'));
          } else if (actualSize > MAX_DOWNLOAD_BYTES) {
            fs.unlinkSync(installerPath);
            reject(new Error(`Downloaded file exceeds limit: ${actualSize} bytes`));
          } else if (totalSize > 0 && actualSize !== totalSize) {
            fs.unlinkSync(installerPath);
            reject(new Error(`Download incomplete: expected ${totalSize}, got ${actualSize}`));
          } else {
            logger.info('Download complete', { size: actualSize });
            resolve();
          }
        });
      },
    );

    req.on('error', (err: Error) => {
      file.close();
      if (fs.existsSync(installerPath)) fs.unlinkSync(installerPath);
      reject(err);
    });

    req.setTimeout(300_000, () => {
      req.destroy();
      file.close();
      if (fs.existsSync(installerPath)) fs.unlinkSync(installerPath);
      reject(new Error('Download timed out'));
    });
  });

  // Run silent install
  logger.info('Running silent install', { installerPath });
  await runInstaller(installerPath);

  logger.info('Install complete, restarting...');

  // Cleanup and restart
  try { fs.unlinkSync(installerPath); } catch { /* ignore */ }
  app.relaunch();
  app.exit(0);
}

/**
 * Triggered by WebSocket pc:command { command: 'update' }.
 * Same as startup check but skips version comparison (server already decided).
 */
export async function handleUpdateCommand(downloadUrl?: string): Promise<void> {
  try {
    const serverUrl = getServerUrl();
    const url = downloadUrl
      ? downloadUrl.startsWith('http')
        ? downloadUrl
        : `${serverUrl}${downloadUrl}`
      : `${serverUrl}/api/agent/download/latest`;
    // 远程推送时错峰 0-60 秒，避免几十台电脑同时下载安装包把局域网打满。
    const staggerMs = Math.floor(Math.random() * 60_000);
    await new Promise((resolve) => setTimeout(resolve, staggerMs));
    logger.info('Update command received, downloading...', { url });
    await performUpdate(url);
  } catch (err: any) {
    logger.error('Update command failed', { error: err.message });
  }
}
