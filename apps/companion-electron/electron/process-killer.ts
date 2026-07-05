import { exec } from 'child_process';
import { ProcessInfo } from './process-monitor';
import { logger } from './logger';

// ── Rate Limiting ──

const killHistory: number[] = [];
const MAX_KILLS_PER_10S = 5;
const KILL_WINDOW_MS = 10_000;

function checkRateLimit(processName: string): boolean {
  const now = Date.now();
  while (killHistory.length > 0 && killHistory[0] < now - KILL_WINDOW_MS) {
    killHistory.shift();
  }
  const allowed = killHistory.length < MAX_KILLS_PER_10S;
  if (!allowed) {
    logger.warn('[ProcessKiller] Rate limit reached', {
      processName,
      recentKills: killHistory.length,
      limit: MAX_KILLS_PER_10S,
      windowSec: KILL_WINDOW_MS / 1000,
    });
  }
  return allowed;
}

function recordKill(processName: string, pid: number): void {
  killHistory.push(Date.now());
  logger.info('[ProcessKiller] Kill recorded in rate limiter', {
    processName,
    pid,
    recentKills: killHistory.length,
  });
}

// ── Kill Execution ──

export interface KillResult {
  processName: string;
  pid: number;
  success: boolean;
  resultText: string;
}

export function killProcess(process: ProcessInfo): Promise<KillResult> {
  logger.info('[ProcessKiller] Kill requested', {
    processName: process.name,
    pid: process.pid,
    path: process.path || 'unknown',
    memoryMB: process.memoryMB,
  });

  if (!checkRateLimit(process.name)) {
    return Promise.resolve({
      processName: process.name,
      pid: process.pid,
      success: false,
      resultText: 'Rate limited — too many kills in short period',
    });
  }

  return new Promise((resolve) => {
    recordKill(process.name, process.pid);

    const command = `taskkill /F /PID ${process.pid}`;
    logger.info('[ProcessKiller] Executing taskkill', { command });

    exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
      const result: KillResult = {
        processName: process.name,
        pid: process.pid,
        success: !error,
        resultText: error ? (stderr || error.message) : (stdout || 'OK'),
      };

      if (result.success) {
        logger.info('[ProcessKiller] Kill SUCCESS', {
          processName: result.processName,
          pid: result.pid,
          output: stdout?.trim(),
        });
      } else {
        logger.error('[ProcessKiller] Kill FAILED', {
          processName: result.processName,
          pid: result.pid,
          error: result.resultText,
        });
      }

      resolve(result);
    });
  });
}
