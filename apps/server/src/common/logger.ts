import * as fs from 'fs';
import * as path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO  = 1,
  WARN  = 2,
  ERROR = 3,
}

const LOG_DIR = path.join(process.cwd(), 'logs');
const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]:  'INFO',
  [LogLevel.WARN]:  'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

// Default DEBUG, override via env LOG_LEVEL=info|warn|error
const raw = (process.env.LOG_LEVEL || '').toUpperCase();
const CURRENT_LEVEL: LogLevel =
  raw === 'INFO'  ? LogLevel.INFO  :
  raw === 'WARN'  ? LogLevel.WARN  :
  raw === 'ERROR' ? LogLevel.ERROR :
  LogLevel.DEBUG;

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFile(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `server-${date}.log`);
}

function write(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
  if (level < CURRENT_LEVEL) return;
  ensureLogDir();
  const ts = new Date().toISOString();
  const label = LEVEL_LABELS[level];
  const extraStr = extra ? ' ' + JSON.stringify(extra) : '';
  const line = `[${ts}] [${label}] ${message}${extraStr}\n`;
  fs.appendFile(getLogFile(), line, () => {});
  // Also console for dev
  (level >= LogLevel.WARN ? process.stderr : process.stdout).write(line);
}

export const logger = {
  debug(msg: string, extra?: Record<string, unknown>) { write(LogLevel.DEBUG, msg, extra); },
  info(msg: string, extra?: Record<string, unknown>)  { write(LogLevel.INFO,  msg, extra); },
  warn(msg: string, extra?: Record<string, unknown>)  { write(LogLevel.WARN,  msg, extra); },
  error(msg: string, extra?: Record<string, unknown>) { write(LogLevel.ERROR, msg, extra); },
};
