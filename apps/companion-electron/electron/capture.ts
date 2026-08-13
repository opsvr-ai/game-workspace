// craftsman-ignore: TS001,TS003
// 工作记录截图：服务期间每 12-18 分钟随机截屏并上传
import { desktopCapturer } from 'electron';
import path from 'path';
import { store } from './store';
import { getServerUrl } from './config';

let sessionId: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let capturing = false;
let pendingQueue: Array<{ jpeg: Buffer; captureTime: string; blackScreen: boolean }> = [];

function log(msg: string) {
  try {
    const fs = require('fs') as typeof import('fs');
    fs.appendFileSync(path.join(require('os').tmpdir(), 'chunlv-capture.log'),
      `${new Date().toISOString().slice(11,23)} ${msg}\n`);
  } catch {}
}

/** 计算 JPEG 亮度均值，判断是否近全黑 */
function isBlack(jpeg: Buffer): boolean {
  // JPEG 解码较重，简化：取压缩后文件大小 < 15KB 视为大概率黑屏
  return jpeg.length < 15 * 1024;
}

function fmtTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function uploadShot(jpeg: Buffer, captureTime: string, blackScreen: boolean): Promise<boolean> {
  try {
    const token = store.get('token') as string;
    if (!token) return false;
    const form = new FormData();
    form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'shot.jpg');
    form.append('captureTime', captureTime);
    form.append('blackScreen', String(blackScreen));
    const res = await fetch(`${getServerUrl()}/api/sessions/${sessionId}/screenshots`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function takeShot(): Promise<void> {
  if (!sessionId || capturing) return;
  capturing = true;
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
    const primary = sources[0];
    if (!primary || !primary.thumbnail) {
      log('no screen source');
      return;
    }
    const jpeg = primary.thumbnail.toJPEG(60);
    const captureTime = fmtTime(new Date());
    const black = isBlack(jpeg);
    log(`shot size=${jpeg.length} black=${black}`);

    // 上传当前 + 补传队列
    const queue = [...pendingQueue, { jpeg, captureTime, blackScreen: black }];
    pendingQueue = [];
    for (const item of queue) {
      const ok = await uploadShot(item.jpeg, item.captureTime, item.blackScreen);
      if (!ok) {
        pendingQueue.push(item);
        log(`upload failed (queue ${pendingQueue.length})`);
        break;
      }
    }
    if (pendingQueue.length > 3) pendingQueue = pendingQueue.slice(-3);
  } catch (err: any) {
    log('shot error: ' + (err.message || err));
  } finally {
    capturing = false;
    scheduleNext();
  }
}

function scheduleNext(): void {
  if (!sessionId) return;
  // 12-18 分钟随机
  const delay = (12 + Math.random() * 6) * 60 * 1000;
  timer = setTimeout(takeShot, delay);
}

export function startCapture(sid: string): void {
  stopCapture();
  sessionId = sid;
  log(`START session=${sid}`);
  // 首张延迟 1-3 分钟（避免刚开局截图无意义）
  timer = setTimeout(takeShot, (60 + Math.random() * 120) * 1000);
}

export function stopCapture(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  sessionId = null;
  pendingQueue = [];
  log('STOP');
}
