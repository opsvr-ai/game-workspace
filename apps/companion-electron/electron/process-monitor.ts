import { exec } from 'child_process';
import { logger } from './logger';

// ── Types ──

export interface ProcessInfo {
  name: string;      // e.g. "LOL.exe"
  pid: number;
  path?: string;     // full executable path from PowerShell
  memoryMB: number;
}

export interface BlacklistEntry {
  processName: string;
  processPath?: string | null;
}

export interface WhitelistEntry {
  processName: string;
  isSystem: boolean;
}

// ── OS Process Patterns (Windows) ──

const OS_PROCESS_PATTERNS = [
  /^explorer\.exe$/i,
  /^System$/i,
  /^System Idle Process$/i,
  /^services\.exe$/i,
  /^svchost\.exe$/i,
  /^lsass\.exe$/i,
  /^csrss\.exe$/i,
  /^winlogon\.exe$/i,
  /^smss\.exe$/i,
  /^spoolsv\.exe$/i,
  /^wininit\.exe$/i,
  /^dwm\.exe$/i,
  /^fontdrvhost\.exe$/i,
  /^RuntimeBroker\.exe$/i,
  /^ShellExperienceHost\.exe$/i,
  /^SearchIndexer\.exe$/i,
  /^WmiPrvSE\.exe$/i,
  /^sihost\.exe$/i,
  /^taskhostw\.exe$/i,
  /^ctfmon\.exe$/i,
  /^conhost\.exe$/i,
  /^dllhost\.exe$/i,
  /^ApplicationFrameHost\.exe$/i,
  /^TextInputHost\.exe$/i,
  /^SearchApp\.exe$/i,
  /^StartMenuExperienceHost\.exe$/i,
  /^SecurityHealthSystray\.exe$/i,
  /^SecurityHealthService\.exe$/i,
  /^NisSrv\.exe$/i,
  /^MsMpEng\.exe$/i,
  /^MemCompression$/i,
  /^Registry$/i,
  /^Vmmem$/i,
  /^vmcompute\.exe$/i,
  /^Vmwp\.exe$/i,
];

// ── State ──

let localBlacklist: BlacklistEntry[] = [];
let localWhitelist: processName[] = [];
let blacklistVersion = 0;
let reportInterval: ReturnType<typeof setInterval> | null = null;
let recheckInterval: ReturnType<typeof setInterval> | null = null;

type ReportCallback = (processes: ProcessInfo[], totalCount: number) => void;
type KillCallback = (process: ProcessInfo) => void;

let onReportCallback: ReportCallback | null = null;
let onKillCallback: KillCallback | null = null;

// ── Process Collection ──

/** Collect running processes using PowerShell (structured JSON output, fast). */
export function collectProcesses(): Promise<ProcessInfo[]> {
  const startTime = Date.now();
  logger.info('[ProcessCollect] Starting process collection via PowerShell');
  return new Promise((resolve) => {
    const psCmd = `powershell -NoProfile -Command "Get-Process | Select-Object Name,Id,Path,@{N='MemoryMB';E={[math]::Round(\$_.WorkingSet64/1MB,2)}} | ConvertTo-Json"`;
    exec(psCmd, { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        logger.warn('[ProcessCollect] PowerShell failed, falling back to tasklist', { error: error.message });
        exec('tasklist /FO CSV /NH', { timeout: 10000 }, (err2, out2) => {
          if (err2) {
            logger.error('[ProcessCollect] tasklist fallback also failed', { error: err2.message });
            resolve([]);
            return;
          }
          const result = parseTasklist(out2);
          logger.info('[ProcessCollect] Collection complete via tasklist', {
            method: 'tasklist',
            count: result.length,
            elapsed: `${Date.now() - startTime}ms`,
          });
          resolve(result);
        });
        return;
      }
      try {
        const raw = JSON.parse(stdout);
        const list = Array.isArray(raw) ? raw : [raw];
        const result = list
          .filter((p: any) => p && p.Name)
          .map((p: any) => ({
            name: p.Name,
            pid: p.Id,
            path: p.Path || undefined,
            memoryMB: p.MemoryMB || 0,
          }));
        logger.info('[ProcessCollect] Collection complete via PowerShell', {
          method: 'powershell',
          rawCount: list.length,
          validCount: result.length,
          elapsed: `${Date.now() - startTime}ms`,
        });
        resolve(result);
      } catch (e: any) {
        logger.error('[ProcessCollect] Failed to parse PowerShell output', { error: e.message });
        resolve([]);
      }
    });
  });
}

/** Fallback parser for tasklist CSV output. */
function parseTasklist(output: string): ProcessInfo[] {
  const lines = output.split('\n').filter((l) => l.trim());
  const processes: ProcessInfo[] = [];
  for (const line of lines) {
    // Format: "ImageName","PID","SessionName","Session#","MemUsage"
    const match = line.match(/"([^"]+)","(\d+)","[^"]*","\d+","([^"]+)"/);
    if (match) {
      processes.push({
        name: match[1],
        pid: parseInt(match[2], 10),
        memoryMB: parseMemToMB(match[3]),
      });
    }
  }
  return processes;
}

function parseMemToMB(mem: string): number {
  const num = parseFloat(mem.replace(/[^\d.]/g, ''));
  if (mem.toLowerCase().includes('k')) return num / 1024;
  return num;
}

// ── Filtering ──

/** Remove OS-level system processes. */
export function filterOSProcesses(processes: ProcessInfo[]): ProcessInfo[] {
  const before = processes.length;
  const filtered = processes.filter((p) => !OS_PROCESS_PATTERNS.some((pattern) => pattern.test(p.name)));
  logger.debug('[ProcessCollect] OS processes filtered', { before, after: filtered.length, removed: before - filtered.length });
  return filtered;
}

// ── Blacklist Matching ──

/** Find processes that match the blacklist but NOT the whitelist (whitelist priority). */
export function findBlacklisted(
  running: ProcessInfo[],
  blacklist: BlacklistEntry[],
  whitelist: string[],
): ProcessInfo[] {
  const whitelistLower = whitelist.map((w) => w.toLowerCase());
  return running.filter((p) => {
    if (whitelistLower.includes(p.name.toLowerCase())) return false;
    return blacklist.some(
      (b) => p.name.toLowerCase() === b.processName.toLowerCase(),
    );
  });
}

// ── Monitor Lifecycle ──

/** Start periodic process monitoring (5 min report + 30s recheck). */
export function startProcessMonitor(
  onReport: ReportCallback,
  onKill: KillCallback,
): void {
  logger.info('[ProcessMonitor] Starting', { reportInterval: '5min', recheckInterval: '30s' });
  onReportCallback = onReport;
  onKillCallback = onKill;

  // Initial collection
  runReportCycle();

  // Report every 5 minutes
  reportInterval = setInterval(runReportCycle, 5 * 60 * 1000);

  // Re-check against blacklist every 30 seconds
  recheckInterval = setInterval(runBlacklistCheck, 60 * 1000);
}

/** Stop periodic monitoring. */
export function stopProcessMonitor(): void {
  logger.info('[ProcessMonitor] Stopping');
  if (reportInterval) { clearInterval(reportInterval); reportInterval = null; }
  if (recheckInterval) { clearInterval(recheckInterval); recheckInterval = null; }
}

// ── Internal Cycles ──

async function runReportCycle(): Promise<void> {
  const cycleStart = Date.now();
  logger.info('[ProcessMonitor] Report cycle started');
  try {
    const all = await collectProcesses();
    const filtered = filterOSProcesses(all);
    logger.info('[ProcessMonitor] Sending process report to server', {
      totalCount: filtered.length,
      rawCount: all.length,
      blacklistVersion,
      blacklistRules: localBlacklist.length,
      whitelistRules: localWhitelist.length,
    });
    onReportCallback?.(filtered, filtered.length);

    // Also check blacklist after every report
    const hits = findBlacklisted(filtered, localBlacklist, localWhitelist);
    if (hits.length > 0) {
      logger.warn('[ProcessMonitor] Blacklist hits found during report', {
        hitCount: hits.length,
        processes: hits.map((h) => ({ name: h.name, pid: h.pid })),
      });
    }
    for (const hit of hits) {
      onKillCallback?.(hit);
    }
    logger.info('[ProcessMonitor] Report cycle complete', { elapsed: `${Date.now() - cycleStart}ms` });
  } catch (e: any) {
    logger.error('[ProcessMonitor] Report cycle failed', { error: e.message });
  }
}

async function runBlacklistCheck(): Promise<void> {
  if (localBlacklist.length === 0) return;
  logger.debug('[ProcessMonitor] Blacklist re-check started');
  try {
    const all = await collectProcesses();
    const filtered = filterOSProcesses(all);
    const hits = findBlacklisted(filtered, localBlacklist, localWhitelist);
    if (hits.length > 0) {
      logger.warn('[ProcessMonitor] Blacklist hits found during re-check', {
        hitCount: hits.length,
        processes: hits.map((h) => ({ name: h.name, pid: h.pid, path: h.path })),
      });
    }
    for (const hit of hits) {
      onKillCallback?.(hit);
    }
  } catch (e: any) {
    logger.error('[ProcessMonitor] Blacklist re-check failed', { error: e.message });
  }
}

// ── Blacklist Update ──

/** Update local blacklist from server push. Returns true if version is newer. */
export function updateBlacklist(
  blacklist: BlacklistEntry[],
  whitelist: { processName: string }[],
  version: number,
): boolean {
  if (version <= blacklistVersion) {
    logger.debug('[ProcessMonitor] Blacklist update skipped (same or older version)', {
      current: blacklistVersion,
      received: version,
    });
    return false;
  }
  logger.info('[ProcessMonitor] Blacklist updated from server', {
    oldVersion: blacklistVersion,
    newVersion: version,
    blacklistCount: blacklist.length,
    blacklistProcesses: blacklist.map((b) => b.processName),
    whitelistCount: whitelist.length,
    whitelistProcesses: whitelist.map((w) => w.processName),
  });
  localBlacklist = blacklist;
  localWhitelist = whitelist.map((w) => w.processName);
  blacklistVersion = version;

  // Trigger immediate re-check
  runBlacklistCheck();

  return true;
}

export function getBlacklistVersion(): number {
  return blacklistVersion;
}
