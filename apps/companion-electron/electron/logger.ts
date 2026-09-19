import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// 陪玩端/看门狗静默启动时 stdout/stderr 可能是已关闭的管道，
// 直接 write 会抛 EPIPE，触发 Electron 主进程原生“Error”弹窗并卡住。
// 这里把管道错误吞掉，避免一个日志写入就拖死整个客户端。
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

export enum LogLevel {
  DEBUG = 0,
  INFO  = 1,
  WARN  = 2,
  ERROR = 3,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]:  'INFO',
  [LogLevel.WARN]:  'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

const raw = (process.env.LOG_LEVEL || '').toUpperCase();
const CURRENT_LEVEL: LogLevel =
  raw === 'INFO'  ? LogLevel.INFO  :
  raw === 'WARN'  ? LogLevel.WARN  :
  raw === 'ERROR' ? LogLevel.ERROR :
  LogLevel.DEBUG;

function getExeDir(): string {
  try { return path.dirname(app.getPath('exe')); } catch {}
  return process.cwd();
}

function getLogDir(): string {
  // Primary: userData/logs (persists across updates)
  try { return path.join(app.getPath('userData'), 'logs'); } catch {}
  try { return path.join(app.getPath('appData'), 'logs'); } catch {}
  try { return path.join(process.cwd(), 'logs'); } catch {}
  return path.join(__dirname, '..', 'logs');
}

function ensureLogDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getLogFile(ext: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(ext, `companion-${date}.log`);
}

function write(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
  if (level < CURRENT_LEVEL) return;
  const ts = new Date().toISOString();
  const label = LEVEL_LABELS[level];
  const extraStr = extra ? ' ' + JSON.stringify(extra) : '';
  const line = `[${ts}] [${label}] ${message}${extraStr}\n`;

  // Write to userData (primary)
  const dir = getLogDir();
  ensureLogDir(dir);
  try { fs.appendFileSync(getLogFile(dir), line); } catch (e: any) { /* ignore */ }

  // Also write to EXE directory for easy access
  try {
    const exeDir = path.join(getExeDir(), 'logs');
    ensureLogDir(exeDir);
    fs.appendFileSync(getLogFile(exeDir), line);
  } catch (e: any) { /* ignore */ }

  try {
    (level >= LogLevel.WARN ? process.stderr : process.stdout).write(line);
  } catch (e: any) {
    // 忽略 EPIPE 等流错误，日志文件已经写成功。
  }
}

export const logger = {
  debug(msg: string, extra?: Record<string, unknown>) { write(LogLevel.DEBUG, msg, extra); },
  info(msg: string, extra?: Record<string, unknown>)  { write(LogLevel.INFO,  msg, extra); },
  warn(msg: string, extra?: Record<string, unknown>)  { write(LogLevel.WARN,  msg, extra); },
  error(msg: string, extra?: Record<string, unknown>) { write(LogLevel.ERROR, msg, extra); },
};
