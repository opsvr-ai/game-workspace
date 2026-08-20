// craftsman-ignore: TS001,TS003
// 工作记录截图：服务期间截图仅存本地（不占网络），服务结束后批量上传
import { desktopCapturer, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { store } from './store';
import { getServerUrl } from './config';

let sessionId: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let capturing = false;
let flushing = false;
let paused = false;

// 暂停期间加密截图间隔（分钟）：验证陪玩是否真的在等，而不是偷偷打单
const PAUSE_INTERVAL_MINUTES = 2;

const DEFAULT_CAPTURE_CONFIG = {
  intervalMinMinutes: 12,
  intervalMaxMinutes: 18,
  firstDelayMinMinutes: 1,
  firstDelayMaxMinutes: 3,
  blackJpegKb: 15,
};
let captureConfig = { ...DEFAULT_CAPTURE_CONFIG };

function localDir(sid: string): string {
  return path.join(app.getPath('userData'), 'captures', sid);
}

function log(msg: string) {
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'captures', 'capture.log'),
      `${new Date().toISOString().slice(11, 23)} ${msg}\n`,
    );
  } catch {}
}

/** JPEG 近全黑检测（压缩后极小视为黑屏） */
function isBlack(jpeg: Buffer): boolean {
  return jpeg.length < captureConfig.blackJpegKb * 1024;
}

function fmtName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.jpg`;
}

async function takeShot(): Promise<void> {
  if (!sessionId || capturing || flushing) return;
  capturing = true;
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 },
    });
    const primary = sources[0];
    if (!primary || !primary.thumbnail) {
      log('no screen source');
      return;
    }
    const jpeg = primary.thumbnail.toJPEG(60);
    const black = isBlack(jpeg);
    // 本地保存：文件名 = 实际截图时间；黑屏加 _black 后缀
    const dir = localDir(sessionId);
    fs.mkdirSync(dir, { recursive: true });
    const name = fmtName(new Date()).replace('.jpg', black ? '_black.jpg' : '.jpg');
    fs.writeFileSync(path.join(dir, name), jpeg);
    log(`saved ${name} size=${jpeg.length} black=${black}`);
  } catch (err: any) {
    log('shot error: ' + (err.message || err));
  } finally {
    capturing = false;
    scheduleNext();
  }
}

async function fetchCaptureConfig(): Promise<void> {
  try {
    const token = store.get('token') as string;
    if (!token) return;
    const keys = 'capture.interval_min_minutes,capture.interval_max_minutes,capture.first_delay_min_minutes,capture.first_delay_max_minutes,capture.black_jpeg_kb';
    const res = await fetch(`${getServerUrl()}/api/config?keys=${encodeURIComponent(keys)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const json: any = await res.json();
    const d = json?.data || {};
    const num = (v: any, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
    captureConfig = {
      intervalMinMinutes: num(d['capture.interval_min_minutes'], DEFAULT_CAPTURE_CONFIG.intervalMinMinutes),
      intervalMaxMinutes: num(d['capture.interval_max_minutes'], DEFAULT_CAPTURE_CONFIG.intervalMaxMinutes),
      firstDelayMinMinutes: num(d['capture.first_delay_min_minutes'], DEFAULT_CAPTURE_CONFIG.firstDelayMinMinutes),
      firstDelayMaxMinutes: num(d['capture.first_delay_max_minutes'], DEFAULT_CAPTURE_CONFIG.firstDelayMaxMinutes),
      blackJpegKb: num(d['capture.black_jpeg_kb'], DEFAULT_CAPTURE_CONFIG.blackJpegKb),
    };
  } catch {
    // keep local defaults
  }
}

function scheduleNext(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!sessionId) return;
  const min = paused ? PAUSE_INTERVAL_MINUTES : captureConfig.intervalMinMinutes;
  const max = paused ? PAUSE_INTERVAL_MINUTES + 1 : captureConfig.intervalMaxMinutes;
  const delay = (min + Math.random() * (max - min)) * 60 * 1000;
  timer = setTimeout(takeShot, delay);
}

export async function startCapture(sid: string): Promise<void> {
  // 先清理定时器但保留旧 session 本地文件（不触发上传，新 session 开始）
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  sessionId = sid;
  paused = false;
  log(`START session=${sid}`);
  // 拉取后台截图配置（失败则用本地默认值）
  await fetchCaptureConfig();
  // 首张延迟（默认 1-3 分钟，刚开局截图无意义）
  const firstDelay = (captureConfig.firstDelayMinMinutes + Math.random() * (captureConfig.firstDelayMaxMinutes - captureConfig.firstDelayMinMinutes)) * 60 * 1000;
  timer = setTimeout(takeShot, firstDelay);
}

/** 点暂停：立即截一张 + 之后按加密间隔继续截，用于核对是否真在等待 */
export function pauseCapture(): void {
  paused = true;
  void takeShot();
}

/** 点继续：恢复正常服务截图间隔 */
export function resumeCapture(): void {
  paused = false;
  scheduleNext();
}

/** 启动时清理 7 天前的残留截图目录（未上传成功的历史文件） */
export function cleanupStaleCaptures(): void {
  try {
    const base = path.join(app.getPath('userData'), 'captures');
    if (!fs.existsSync(base)) return;
    const now = Date.now();
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d);
      const st = fs.statSync(p);
      if (st.isDirectory() && now - st.mtimeMs > 7 * 24 * 3600 * 1000) {
        fs.rmSync(p, { recursive: true, force: true });
        log(`cleaned stale dir ${d}`);
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * 补传所有未上传的截图（断网/被杀进程后，下次联网或开机时调用）。
 * 跳过当前正在服务的 session（避免服务中上传占用网络）。
 */
export async function flushAllPending(): Promise<void> {
  if (flushing) return;
  try {
    const base = path.join(app.getPath('userData'), 'captures');
    if (!fs.existsSync(base)) return;
    for (const d of fs.readdirSync(base)) {
      if (d === sessionId) continue; // 正在服务的 session 不传
      const p = path.join(base, d);
      if (!fs.statSync(p).isDirectory()) continue;
      const files = fs.readdirSync(p).filter((f) => f.endsWith('.jpg'));
      if (files.length === 0) {
        fs.rmSync(p, { recursive: true, force: true }); // 空目录清理
        continue;
      }
      log(`retry flush session=${d} files=${files.length}`);
      await flushUploadFor(d);
    }
  } catch (err: any) {
    log('flushAll error: ' + (err.message || err));
  }
}

/** 停止截图并等待批量上传完成（返回后服务端已收到全部截图） */
export async function stopCaptureAndFlush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const sid = sessionId;
  sessionId = null;
  if (!sid) return;
  log(`STOP session=${sid} — flushing...`);
  await flushUploadFor(sid);
  log('flush done');
}

/** 兼容旧调用（不等待） */
export function stopCapture(): void {
  (async () => {
    await stopCaptureAndFlush();
  })();
}

/** 对指定 session 批量上传本地截图，成功后删除 */
async function flushUploadFor(sid: string): Promise<void> {
  const dir = localDir(sid);
  try {
    const token = store.get('token') as string;
    if (!token) {
      log('flush: no token');
      return;
    }
    const files = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_black)?\.jpg$/.test(f))
          .sort()
      : [];
    log(`flush: ${files.length} files`);

    for (const f of files) {
      const buf = fs.readFileSync(path.join(dir, f));
      const form = new FormData();
      form.append('file', new Blob([buf], { type: 'image/jpeg' }), f);
      // 文件名即实际截图时间 → 提取 captureTime 一并上报
      const ts = f.replace('_black.jpg', '').replace('.jpg', '').replace('_', ' ') + ':00';
      form.append('captureTime', ts);
      form.append('blackScreen', f.includes('_black') ? 'true' : 'false');
      try {
        const res = await fetch(`${getServerUrl()}/api/sessions/${sid}/screenshots`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (res.ok) {
          fs.unlinkSync(path.join(dir, f)); // 上传成功即删除本地
        } else {
          log(`upload ${f} failed status=${res.status}`);
          break; // 网络问题，保留剩余本地文件下次再传
        }
      } catch (err: any) {
        log(`upload ${f} error: ${err.message}`);
        break;
      }
    }
  } catch (err: any) {
    log('flush error: ' + (err.message || err));
  }
}
