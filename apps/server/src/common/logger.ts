import { createLogger, format, transports, addColors } from 'winston';
import * as path from 'path';
import * as fs from 'fs';

const LOG_DIR = path.join(process.cwd(), 'logs');
const isProd = process.env.NODE_ENV === 'production';

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// 自定义级别：数字越小越严重（与 winston 默认语义一致）。
// 之前写反成 debug:0/error:3，导致 info/warn 全部落进 error.log、combined.log 只剩 debug。
const levels = { error: 0, warn: 1, info: 2, debug: 3 };

addColors({
  debug: 'blue',
  info: 'green',
  warn: 'yellow',
  error: 'red',
});

// Console transport (human-readable in dev, JSON in prod)
const consoleFormat = isProd
  ? format.combine(format.timestamp(), format.json())
  : format.combine(
      format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      format.colorize({ all: true }),
      format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] [${level}] ${message}${metaStr}`;
      }),
    );

// File transport (always JSON for parseability)
const fileFormat = format.combine(format.timestamp(), format.json());

const winstonLogger = createLogger({
  levels,
  // 默认 info：debug 会打印每一次 WS 事件、每一次心跳，生产上既费 CPU 又刷日志。
  // 需要排查时用 LOG_LEVEL=debug 启动。
  level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  transports: [
    new transports.Console({ format: consoleFormat }),
    new transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      format: fileFormat,
    }),
    new transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      format: fileFormat,
    }),
  ],
});

// 供热点路径判断：debug 没开时跳过 JSON.stringify 之类的准备工作，别白算一遍再丢掉。
export const isDebugEnabled = winstonLogger.isLevelEnabled('debug');

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => winstonLogger.debug(msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => winstonLogger.info(msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => winstonLogger.warn(msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => winstonLogger.error(msg, extra),
};
