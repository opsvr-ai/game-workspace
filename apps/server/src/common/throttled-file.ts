// craftsman-ignore: TS001,TS003
import * as fs from 'fs';
import type { Response } from 'express';
import { logger } from './logger';

/**
 * 限速下发文件（目前只用于陪玩端更新包）。
 *
 * 更新包 128MB，不限速就是全速下发：办公室十几台机器共用一条网，
 * 一台下载就把这条网占满，别人的接口请求直接超时 —— 陪玩看到的是「接口报错 / 掉线」，
 * 实测更新期间确实出现 /companions/me/workbench、/companions/me/wallet 25 秒超时。
 * 所以这里按固定速率匀速发，给正常业务留出带宽。
 *
 * 速率用 UPDATE_DOWNLOAD_KBPS 调（默认 700KB/s，一个包约 3 分钟）。
 */
export const UPDATE_DOWNLOAD_BYTES_PER_SEC = Math.max(
  100 * 1024,
  Number(process.env.UPDATE_DOWNLOAD_KBPS || 700) * 1024,
);

export async function streamFileThrottled(
  filePath: string,
  filename: string,
  res: Response,
): Promise<void> {
  const total = fs.statSync(filePath).size;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(total));
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  let aborted = false;
  res.on('close', () => {
    aborted = true;
  });

  const started = Date.now();
  const chunkSize = 64 * 1024;
  const buffer = Buffer.alloc(chunkSize);
  const fd = fs.openSync(filePath, 'r');
  let sent = 0;
  try {
    while (sent < total && !aborted) {
      // 匀速：按已用时间算「最多允许发出去多少字节」，超了就等一下再发。
      // 一开始先给 1 秒额度，避免开头干等（客户端那边有超时保护）。
      const allowed = ((Date.now() - started + 1000) / 1000) * UPDATE_DOWNLOAD_BYTES_PER_SEC;
      if (sent >= allowed) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      const read = fs.readSync(fd, buffer, 0, Math.min(chunkSize, total - sent), sent);
      if (read <= 0) break;
      sent += read;
      if (!res.write(buffer.subarray(0, read))) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  } catch (err: any) {
    logger.warn(`Throttled download failed: ${err?.message || err}`);
    return;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
  }
  if (!aborted && !res.writableEnded) res.end();
  logger.info('Update package delivered', {
    filename,
    bytes: sent,
    seconds: Math.round((Date.now() - started) / 1000),
  });
}
