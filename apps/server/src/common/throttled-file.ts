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
 * **2026-10-17 起改成「总额度」，多路同时下载分摊同一份**：
 * 以前每路各自 700KB/s —— 平时只有一台在下，看着没问题；可一旦同时有 4 台在拉，
 * 那就是 4×700KB/s，办公室那条网照样被占满（老板报「192.168.0.133 打开软件一直在加载」，
 * 服务端日志里那 28 分钟正好有 3～5 路同时在下 92MB 的包，单路要 3～12 分钟）。
 * 现在 SUM(每一路) ≤ UPDATE_DOWNLOAD_KBPS：机器再多也不会把这条网吃干，
 * 业务请求始终留得住带宽。
 *
 * 总额度用 UPDATE_DOWNLOAD_KBPS 调（默认 300KB/s；一路独占时一个 92MB 的包约 5 分钟）。
 */
export const UPDATE_DOWNLOAD_BYTES_PER_SEC = Math.max(
  100 * 1024,
  Number(process.env.UPDATE_DOWNLOAD_KBPS || 300) * 1024,
);

// 正在下发的更新流共享一份状态：agent 那边「要不要把名额让给排队的人」也要看它
// （有人在真下载的时候绝不能把名额挪走 —— 否则两路并行，又变回抢带宽）。
export const throttledDownloadState = { active: 0 };

/** 现在有几路更新包在下。 */
export function activeThrottledDownloads(): number {
  return throttledDownloadState.active;
}

/**
 * 分摊到每一路的速率：总额度按当前路数均分。
 *
 * 只留 16KB/s 的「别彻底停住」下限 —— 不做更高的下限：
 * 那种下限会让路数一多就突破总额度（4 路 ×100KB/s = 400KB/s > 300KB/s 的总额度），
 * 等于把「共享额度」又变回「每路一份」，正是这次要修的问题。
 */
export function perStreamBytesPerSec(active: number = throttledDownloadState.active): number {
  const streams = Math.max(1, active);
  return Math.max(16 * 1024, Math.floor(UPDATE_DOWNLOAD_BYTES_PER_SEC / streams));
}

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

  // 先登记这一路：后面每一轮的额度都按「当前路数」重新算，
  // 所以新来的一路会立刻把在下的那几路一起降速，总额度始终不超。
  throttledDownloadState.active += 1;

  let aborted = false;
  res.on('close', () => {
    aborted = true;
  });

  const started = Date.now();
  const chunkSize = 64 * 1024;
  const fd = fs.openSync(filePath, 'r');
  let sent = 0;
  try {
    while (sent < total && !aborted) {
      // 匀速：按已用时间算「最多允许发出去多少字节」，超了就等一下再发。
      // 一开始先给 1 秒额度，避免开头干等（客户端那边有超时保护）。
      // 速率是「共享总额度 ÷ 当前路数」，不是每路一份（见文件头）。
      const allowed = ((Date.now() - started + 1000) / 1000) * perStreamBytesPerSec();
      if (sent >= allowed) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      // 每块单独分配，绝不能复用同一个 buffer：
      // res.write 返回 false（背压）时，这一块是「按引用」挂进发送队列的，
      // 复用同一个 buffer 会让还在队列里没发出去的上一块被下一次 readSync 覆盖，
      // 结果就是「字节数一个不差、内容全是烂的」—— 客户端下完解压报 invalid data、
      // 装出半新半旧的客户端（2026-09-23 定位：同一台机器下两次，md5 各不相同）。
      const want = Math.min(chunkSize, total - sent);
      const buffer = Buffer.allocUnsafe(want);
      const read = fs.readSync(fd, buffer, 0, want, sent);
      if (read <= 0) break;
      sent += read;
      if (!res.write(read === want ? buffer : buffer.subarray(0, read))) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  } catch (err: any) {
    logger.warn(`Throttled download failed: ${err?.message || err}`);
    return;
  } finally {
    throttledDownloadState.active = Math.max(0, throttledDownloadState.active - 1);
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
    streams: throttledDownloadState.active + 1,
  });
}
