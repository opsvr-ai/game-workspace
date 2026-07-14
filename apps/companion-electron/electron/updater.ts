import { app } from 'electron';
import { getServerUrl } from './config';
import { store } from './store';
import { logger } from './logger';
import { httpRequest } from './http';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

/**
 * Check server for latest version, compare with local version.
 * If newer version available, download and install.
 */
export async function checkForUpdates(): Promise<void> {
  try {
    const serverUrl = getServerUrl();
    const localVersion = app.getVersion();

    logger.info('Checking for updates', { localVersion, serverUrl });

    const res = await httpRequest({
      method: 'GET',
      url: `${serverUrl}/api/agent/version`,
    });

    if (res.data?.code !== 200 || !res.data?.data) {
      logger.warn('Version check failed: invalid response', res.data);
      return;
    }

    const { version: latestVersion, downloadUrl } = res.data.data;

    if (latestVersion === localVersion) {
      logger.info('Already up-to-date', { version: localVersion });
      return;
    }

    logger.info('New version available', {
      current: localVersion,
      latest: latestVersion,
    });

    const fullDownloadUrl = downloadUrl.startsWith('http')
      ? downloadUrl
      : `${serverUrl}${downloadUrl}`;

    await downloadAndInstall(fullDownloadUrl);
  } catch (err: any) {
    logger.warn('Update check failed (non-fatal)', { error: err.message });
  }
}

/**
 * Download installer exe and run silent install, then quit + relaunch.
 */
export async function downloadAndInstall(downloadUrl: string): Promise<void> {
  const tmpDir = path.join(app.getPath('temp'), 'chunlv-update');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const installerPath = path.join(tmpDir, 'ChunlvAgent-Setup.exe');
  const token = store.get('token') as string;

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
          downloadAndInstall(response.headers.location).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(installerPath);
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        response.pipe(file);

        file.on('finish', () => {
          file.close();
          const actualSize = fs.statSync(installerPath).size;
          if (totalSize > 0 && actualSize !== totalSize) {
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
  const installDir = path.dirname(app.getPath('exe'));

  await new Promise<void>((resolve, reject) => {
    execFile(
      installerPath,
      ['/S', `/D=${installDir}`],
      { timeout: 120_000 },
      (err) => {
        if (err) {
          // NSIS /S can return non-zero even on success; log and proceed
          logger.warn('Installer exited with error', { error: err.message });
        }
        resolve();
      },
    );
  });

  logger.info('Install complete, restarting...');

  // Cleanup and restart
  try { fs.unlinkSync(installerPath); } catch { /* ignore */ }
  app.relaunch();
  app.quit();
}

/**
 * Triggered by WebSocket pc:command { command: 'update' }.
 * Same as startup check but skips version comparison (server already decided).
 */
export async function handleUpdateCommand(downloadUrl?: string): Promise<void> {
  try {
    const serverUrl = getServerUrl();
    const url = downloadUrl || `${serverUrl}/api/agent/download/latest`;
    logger.info('Update command received, downloading...', { url });
    await downloadAndInstall(url);
  } catch (err: any) {
    logger.error('Update command failed', { error: err.message });
  }
}
