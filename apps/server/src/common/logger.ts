import { createLogger, format, transports, addColors } from 'winston';
import * as path from 'path';
import * as fs from 'fs';

const LOG_DIR = path.join(process.cwd(), 'logs');
const isProd = process.env.NODE_ENV === 'production';

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Custom log levels
const levels = { debug: 0, info: 1, warn: 2, error: 3 };

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
  level: (process.env.LOG_LEVEL || 'debug').toLowerCase(),
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

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => winstonLogger.debug(msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => winstonLogger.info(msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => winstonLogger.warn(msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => winstonLogger.error(msg, extra),
};
