// craftsman-ignore: TS001
import { app } from 'electron';
import { getServerUrl } from './config';
import { store } from './store';
import { logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { startUpdateSpin, stopUpdateSpin, updateTrayTooltip } from './tray';

// 更新信号：陪玩端（普通权限）写入，SystemHelper 服务（系统权限）轮询并执行下载解压。
// 看门狗把「装上就把客户端搞坏、已经回滚掉」的版本写进 blocked-versions.json。
// 客户端也得认这份名单，否则回滚到旧版之后每 30 分钟又把同一个坏版本下回来。
function blockedVersions(): Record<string, string> {
  try {
    const raw = fs.readFileSync('C:\\ProgramData\\chunlv\\blocked-versions.json', 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isVersionBlocked(version: string): boolean {
  if (!version) return false;
  return Object.prototype.hasOwnProperty.call(blockedVersions(), version);
}
// 「这一版我已经下好、交给看门狗了」——记在本地，防止同一个 123MB 的包被反复下一遍。
// 2026-10-01 线上实况：一批机器的安装目录改不了名（Access is denied），看门狗只能把新版
// 并排装到旁边的「-v<版本>」目录；只要哪一步没让新版本真正跑起来，客户端每次重启都会再下
// 一遍 123MB，几台机器一天能刷出几十 GB，还把全网唯一的更新名额占死，别的机器永远「名额被占」。
// 所以：同一个版本下过一次、30 分钟内本机版本还没变，就先不再下（等版本变了或过了 30 分钟再试）。
const SAME_VERSION_RETRY_MS = 30 * 60 * 1000;

function sameVersionTriedRecently(version: string): boolean {
  if (!version) return false;
  if (app.getVersion() === version) return false;
  const tried = (store.get('updateAttemptVersion') as string) || '';
  if (tried !== version) return false;
  const at = Number(store.get('updateAttemptAt') || 0);
  return Date.now() - at < SAME_VERSION_RETRY_MS;
}

function rememberUpdateAttempt(version: string): void {
  if (!version) return;
  store.set('updateAttemptVersion', version);
  store.set('updateAttemptAt', Date.now());
  store.set('updateAttemptFrom', app.getVersion());
}

/** 目标版本已经真的装上了 → 清掉「重试中」的记录，下一版不受影响。 */
function clearUpdateAttemptIfApplied(): void {
  const tried = (store.get('updateAttemptVersion') as string) || '';
  if (tried && tried === app.getVersion()) {
    store.set('updateAttemptVersion', '');
    store.set('updateAttemptAt', 0);
    store.set('updateAttemptFrom', '');
  }
  // 本机已经是「备着的那一版」了（装上了 / 手动换成别的了）→ 备货标记没用了。
  const staged = readStagedUpdate();
  if (staged && staged.version === app.getVersion()) clearStagedUpdate();
}

// ── 「先下好，等空闲再装」───────────────────────────────────────────────
// 老板 2026-10-03：王甲振那台一直是老版本 1.0.20261007（所以他点邀请横幅不跳转），
// 根因是以前连「下载」都要等陪玩空闲 —— 一单打十几个小时，这机器就永远轮不到更新。
// 下载本身不打断任何东西，所以改成接单中也先把包下好、写一个备货标记；
// 真正会打断接单的只有最后那次「退出让看门狗换文件重启」，那一步才等空闲。
// 备货包留在这儿，下一轮、甚至下次开机都能直接用，不用再下 123MB。
const STAGED_UPDATE_FILE = 'C:\\ProgramData\\chunlv\\staged-update.json';

function readStagedUpdate(): { version: string; localPath: string } | null {
  try {
    const raw = fs.readFileSync(STAGED_UPDATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as any;
    if (parsed && typeof parsed.version === 'string' && parsed.version) {
      return { version: parsed.version, localPath: typeof parsed.localPath === 'string' ? parsed.localPath : '' };
    }
  } catch {
    /* 没备货 / 文件坏了都当没有 */
  }
  return null;
}

function clearStagedUpdate(): void {
  try {
    fs.rmSync(STAGED_UPDATE_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

function stageUpdate(version: string, localPath: string): void {
  if (!version || !localPath) return;
  try {
    fs.writeFileSync(STAGED_UPDATE_FILE, JSON.stringify({ version, localPath }), 'utf-8');
  } catch (err: any) {
    logger.warn('Failed to write staged update marker', { error: err?.message || err });
  }
}

/** 这一版是不是已经备好货了（标记在 + 包还在 + 不像半个文件）。 */
function stagedPackageReady(version: string, fallbackZip: string): boolean {
  if (!version) return false;
  const staged = readStagedUpdate();
  if (!staged || staged.version !== version) return false;
  const zip = staged.localPath || fallbackZip;
  try {
    const st = fs.statSync(zip);
    return st.isFile() && st.size > 1_000_000;
  } catch {
    return false;
  }
}

// 本机看门狗「守谁」：装机时写下的身份（陪玩端 install --client=companion、客服端 --client=cs）。
// 没写 = 很老的机器，看门狗默认守陪玩端（跟看门狗里 readClientKind 的默认一致）。
// 身份写着 cs 时**绝不能**把更新信号写下去：update.json 是两端共用的，看门狗会把这份陪玩端的包
// 解压进客服端的安装目录 —— 那边就废了（客服端也补了同一道判断，两边各挡一道）。
function watchdogWatchesCompanion(): boolean {
  try {
    const kind = fs
      .readFileSync('C:\\ProgramData\\chunlv\\watchdog-client.txt', 'utf-8')
      .trim()
      .toLowerCase();
    return kind !== 'cs';
  } catch {
    return true;
  }
}

// version：告诉看门狗这次装的是哪一版 —— 装完等不到这一版自报健康，它就整目录回滚并拉黑它。
// kind：这份信号是哪一端写的（老看门狗不看这个字段，会忽略未知字段）。
function signalUpdate(downloadUrl: string, localPath?: string, version?: string): void {
  const dir = 'C:\\ProgramData\\chunlv';
  const file = path.join(dir, 'update.json');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        url: downloadUrl,
        ...(localPath ? { localPath } : {}),
        ...(version ? { version } : {}),
        kind: 'companion',
      }),
      'utf-8',
    );
    logger.info('Update signal written', { file });
  } catch (err: any) {
    logger.warn('Failed to write update signal', { error: err?.message || err });
  }
}

/**
 * 只给单测用的出口（electron/updater.test.ts）。
 *
 * 为什么不直接 export 这些函数：它们都是「决定要不要动用户这台机器」的判断，
 * 不想让别的地方顺手当成 API 用 —— 主进程里它们只在本文件内部被调用。
 * 单测盯的就是这几个：跨端信号（别把陪玩端换成客服端）、拉黑版本、同一个包别反复下、
 * 备货包还能不能用、版本号怎么比。
 */
export const __test__ = {
  watchdogWatchesCompanion,
  signalUpdate,
  isVersionBlocked,
  sameVersionTriedRecently,
  stagedPackageReady,
  compareVersions,
};

// 更新进度不再弹窗，改为更新托盘提示文字（配合托盘图标转圈）
function setUpdateProgress(percent: number): void {
  updateTrayTooltip(`陪玩管理 · 正在更新 ${percent}%`);
}

function downloadZipWithProgress(
  url: string,
  dest: string,
  onProgress: (p: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https')
      ? (require('https') as typeof import('https'))
      : (require('http') as typeof import('http'));
    const req = protocol.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`下载失败: HTTP ${res.statusCode}`));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) onProgress(Math.min(100, Math.round((received / total) * 100)));
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      file.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(1_800_000, () => {
      req.destroy();
      reject(new Error('下载超时'));
    });
  });
}

async function acquireUpdateSlot(serverUrl: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl}/api/agent/update/acquire`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as any;
    return json?.data?.granted === true;
  } catch {
    return false;
  }
}

async function releaseUpdateSlot(serverUrl: string, token: string): Promise<void> {
  if (!token) return;
  try {
    await fetch(`${serverUrl}/api/agent/update/release`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* ignore */
  }
}

/** 名额被人占着时的重试节奏：宁可在这儿多问几轮，也别像以前那样一句 busy 就整轮放弃。 */
const UPDATE_SLOT_RETRY_MIN_MS = 15_000;
const UPDATE_SLOT_RETRY_JITTER_MS = 15_000;
/** 一轮最多为名额等这么久（等不到就交给下一次检查，别把机器的更新卡死在这儿）。 */
const UPDATE_SLOT_WAIT_MAX_MS = 30 * 60 * 1000;

/**
 * 申请更新名额，拿不到就带抖动重试。
 *
 * 老板 2026-10-03 报「徐泽宁的客户端一直不自动升级，秦伟杰早就升了」：
 * 那台机器的日志里就是一句「Update slot busy, skip this round and retry later」——
 * 全网只有一个下载名额（怕多台同时下载把办公室那条网占满、别人接口像掉线），
 * 被叫到号的机器一旦晚了一步没抢到，旧代码直接 return，要等下一次 30 分钟轮询；
 * 排队位置也被服务端吃掉了，于是永远轮不上。
 * 现在改成：拿不到就几十秒后再问一次，直到拿到或这一轮等够 30 分钟。
 */
async function acquireUpdateSlotWithRetry(serverUrl: string, token: string): Promise<boolean> {
  const deadline = Date.now() + UPDATE_SLOT_WAIT_MAX_MS;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    if (await acquireUpdateSlot(serverUrl, token)) {
      if (attempts > 1) logger.info('Update slot acquired after retry', { attempts });
      return true;
    }
    // 老板 2026-10-03：以前「排队等名额期间接了单就放弃」—— 这下好的包又白等一轮。
    // 下载不打断接单（真正打断的是装），所以照等；下完只等空闲那一下。
    if (Date.now() >= deadline) {
      logger.warn('Update slot still busy after retrying, give up this round', { attempts });
      return false;
    }
    const waitMs = UPDATE_SLOT_RETRY_MIN_MS + Math.floor(Math.random() * UPDATE_SLOT_RETRY_JITTER_MS);
    logger.info('Update slot busy, retry later', { attempts, waitMs });
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/** 陪玩正在接单/服务中。 */
function companionBusy(): boolean {
  return store.get('lastStatus') === 'BUSY';
}

// 开机宽限期：系统刚启动的这段时间，机器上还没人开打，把备好的更新直接装上最省事。
// 老板 2026-10-04：「什么都不用加，你直接每次开机的时候给他们更新就行。」
// 老板 2026-10-06：「等他们下次关机开机登录的时候再更新吧」——
// 于是自动更新收紧成**只在刚开机/刚登录那一次落地**：机器一直开着、中途就算空闲也不装，
// 包先备着，等下次开机自然换新版。正在打单的人从此零影响，不会被更新踢下线。
// 用**系统运行时长**判断「刚开机」：客户端可能被看门狗单独拉起，那种情况下进程刚启动
// 但机器早已开机，绝不能误判成「刚开机」去打断正在打单的人。
const BOOT_GRACE_SECONDS = 10 * 60;

function justBooted(): boolean {
  try {
    return os.uptime() < BOOT_GRACE_SECONDS;
  } catch {
    return false;
  }
}

/**
 * 这一次到底装不装（返回 false = 先不装，包留着等下次开机）。
 *
 * bootWindow：这次检查是不是「刚开机」的那一次 —— 由 performUpdate 在**下载开始前**定好。
 *   下载要限速排队、可能耗时十几分钟，下载完再判断会把这次开机白白错过。
 * allowIdleFallback：后台「推送更新」是管理端明确点的，仍按老规矩等这一单打完就装（最多等 30 分钟），
 *   免得刚推了却要拖到下次开机才生效。
 */
async function mayApplyUpdateNow(
  why: string,
  bootWindow: boolean,
  allowIdleFallback: boolean,
): Promise<boolean> {
  if (bootWindow) {
    let uptimeSeconds = -1;
    try {
      uptimeSeconds = Math.round(os.uptime());
    } catch {
      /* ignore */
    }
    logger.info('System just booted, applying update now', { why, uptimeSeconds });
    return true;
  }
  if (!allowIdleFallback) {
    logger.info('Not a fresh boot, keep the package and apply it at next boot', { why });
    return false;
  }
  if (!companionBusy()) return true;
  logger.info('Companion is busy, deferring pushed update', { why });
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    if (!companionBusy()) return true;
  }
  return false;
}

async function performUpdate(downloadUrl: string, version = '', allowIdleFallback = false): Promise<void> {
  // 同一个版本刚下过、本机版本却还是旧的（说明上一轮没真的装上去）→ 这一轮先别再下 123MB。
  // 等版本变了或过了 SAME_VERSION_RETRY_MS 再来，把「反复重下」这条死循环掐死。
  if (sameVersionTriedRecently(version)) {
    logger.warn('Skip repeat download of the same version (previous attempt did not take effect)', {
      version,
      localVersion: app.getVersion(),
    });
    return;
  }
  // 这次检查算不算「刚开机」的那一次 —— 下载要排队限速、可能耗时很久，
  // 所以宽限期在下载前就定下来；等下载完再判断，容易因为超过 10 分钟白白错过这次开机。
  const bootWindow = justBooted();
  const localDir = 'C:\\ProgramData\\chunlv';
  const localZip = path.join(localDir, 'update.zip');
  // 上一轮在接单时已经把这一版的包下好了 → 不用再下 123MB，等空闲直接装。
  const havePackage = stagedPackageReady(version, localZip);
  if (!havePackage) {
    // 下载本身不打断接单（计时、截图、客户都在陪玩那边，跟这儿没关系），
    // 所以「接单中」也先把包下好；会不会打断只看最后那一下重启。
    // 串行更新：先申请下载名额，没名额就等着，避免多台同时下载把带宽打满、谁也下不动。
    const serverUrl = getServerUrl();
    // 新机器刚装完还没登录，store 里没有令牌。以前这里直接 return false，于是永远打印一句
    // 「Update slot busy」，客户端版本卡死在装机包那一版。现在没令牌也去申请名额（服务端按机器记账）。
    const token = (store.get('refreshToken') as string) || (store.get('token') as string) || '';
    if (!(await acquireUpdateSlotWithRetry(serverUrl, token))) {
      logger.info('Update slot busy, skip this round and retry later', { hasToken: !!token });
      return;
    }
    startUpdateSpin();
    try {
      fs.mkdirSync(localDir, { recursive: true });
      await downloadZipWithProgress(downloadUrl, localZip, setUpdateProgress);
      setUpdateProgress(100);
      // 记下「这一版已经备好货」：即使现在正在接单，下一轮 / 下次开机也能直接装，不用重下。
      stageUpdate(version, localZip);
    } catch (err: any) {
      logger.error('Download failed', { error: err?.message });
      await releaseUpdateSlot(serverUrl, token);
      stopUpdateSpin();
      updateTrayTooltip('陪玩管理');
      // 兜底把包交给看门狗去下也要退出重启（一样会打断接单），所以同样只在刚开机
      // 或管理端明确推送时才走；别的时段这一轮先算了，等下轮、或干脆等下次开机再试。
      if (!bootWindow && !allowIdleFallback) {
        logger.info('Download failed and not a fresh boot, retry later instead of restarting');
        return;
      }
      // 这台机器的看门狗守的不是陪玩端 → 信号写不得（写了会换错目录），也别退出（退出就没人拉起来）。
      if (!watchdogWatchesCompanion()) {
        logger.warn('Watchdog on this machine does not watch the companion client — skip handoff');
        return;
      }
      signalUpdate(downloadUrl, undefined, version);
      rememberUpdateAttempt(version);
      setTimeout(() => { app.exit(0); }, 800);
      return;
    }
    await releaseUpdateSlot(serverUrl, token);
    stopUpdateSpin();
    updateTrayTooltip('陪玩管理');
  }
  // 包已经在本地了（备货标记还在）。到这一步才需要「别打断接单」：
  // 自动更新只在刚开机那一次落地，其余时段把包留着，等下次开机再装，不用重下。
  if (!(await mayApplyUpdateNow('before applying downloaded package', bootWindow, allowIdleFallback))) {
    logger.info('Deferred, keep the downloaded package for the next boot');
    return;
  }
  // 同机装了客服端、而身份被写成 cs 的机器：这份陪玩端的包绝不能被那份看门狗解压出去。
  // 这一轮不装、也不退出（退出就没人拉起来了）；备好的包留着，下轮或身份修好之后再用。
  if (!watchdogWatchesCompanion()) {
    logger.warn('Watchdog on this machine does not watch the companion client — keep the package, skip this round');
    return;
  }
  signalUpdate(downloadUrl, localZip, version);
  clearStagedUpdate();
  logger.info('Update handed off to SystemHelper', { localZip, version });
  // 记下「这一版已经交出去了」：装成功后 clearUpdateAttemptIfApplied 会清掉，
  // 装不成功就至少 30 分钟内不再重复下这一版。
  rememberUpdateAttempt(version);
  // 交给看门狗(SystemHelper，系统权限)解压重启，全程不弹 UAC
  setTimeout(() => { app.exit(0); }, 800);
}

/**
 * Compare two dot-separated version strings numerically.
 * Handles long segments like 1.0.20260810 (release-date style).
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * Check server for latest version, compare with local version.
 * If newer version available, download and install.
 */
export async function checkForUpdates(): Promise<void> {
  if (updateCheckRunning) return;
  updateCheckRunning = true;
  try {
    // 开机自动检查时随机错峰几秒即可：真正的并发由服务端的「更新名额」串行挡住，
    // 以前这里错峰最多 2 分钟，加上后面「名额被占就放弃」，开机根本等不到更新。
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 10_000)));
    const serverUrl = getServerUrl();
    const localVersion = app.getVersion();

    logger.info('Checking for updates', { localVersion, serverUrl });

    const res = await fetch(`${serverUrl}/api/agent/version`);
    const json = await res.json() as any;

    if (json?.code !== 200 || !json?.data) {
      logger.warn('Version check failed: invalid response', json);
      return;
    }

    const { version: latestVersion, downloadUrl } = json.data;

    // 这个版本在这台机器上装坏过（看门狗已回滚 + 拉黑）：别再下了，
    // 否则每 30 分钟白下 128MB，还要被看门狗反复回滚。
    if (isVersionBlocked(latestVersion)) {
      logger.warn('Latest version is blocked on this machine, skip this round', { latestVersion });
      clearStagedUpdate();
      return;
    }

    // 上一次「下了没装上」的记录：本机版本已经是那一版了就清掉，别影响后面的版本。
    clearUpdateAttemptIfApplied();

    // Only update when the server version is strictly NEWER than local.
    // A plain !== here caused an endless update loop whenever the server
    // config held an older version string (e.g. 1.0.0 vs 1.0.20260810):
    // every launch downloaded the installer, which killed the app, which
    // the watchdog then relaunched — forever.
    if (compareVersions(latestVersion, localVersion) <= 0) {
      logger.info('Already up-to-date', { local: localVersion, latest: latestVersion });
      return;
    }

    logger.info('New version available', {
      current: localVersion,
      latest: latestVersion,
    });

    const fullDownloadUrl = downloadUrl.startsWith('http')
      ? downloadUrl
      : `${serverUrl}${downloadUrl}`;

    await performUpdate(fullDownloadUrl, latestVersion);
  } catch (err: any) {
    logger.warn('Update check failed (non-fatal)', { error: err.message });
  } finally {
    updateCheckRunning = false;
  }
}

const MAX_REDIRECTS = 5;
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;
let updateCheckRunning = false;

function runInstaller(installerPath: string): Promise<void> {
  const installDir = path.dirname(app.getPath('exe'));
  return new Promise<void>((resolve, reject) => {
    execFile(
      installerPath,
      ['/S', `/D=${installDir}`],
      { timeout: 120_000 },
      (err) => {
        if (err) {
          logger.error('Installer failed', { error: err.message });
          reject(new Error(`Installer failed: ${err.message}`));
          return;
        }
        resolve();
      },
    );
  });
}

async function downloadAndInstallWithRedirects(
  downloadUrl: string,
  redirectCount: number,
): Promise<void> {
  const tmpDir = path.join(app.getPath('temp'), 'chunlv-update');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const installerPath = path.join(tmpDir, 'ChunlvAgent-Setup.exe');
  const token = store.get('token') as string;

  // 每次更新都重新下载，避免复用上一次可能错误的安装包（例如旧的 AllInOne 修复工具），
  // 导致反复弹出「Install complete」并重启的死循环。
  try { fs.unlinkSync(installerPath); } catch { /* ignore */ }

  logger.info('Downloading update', { url: downloadUrl, dest: installerPath });

  // Download using Node.js http for stream support
  const http = require('http') as typeof import('http');
  const https = require('https') as typeof import('https');
  const protocol = downloadUrl.startsWith('https') ? https : http;

  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(installerPath);
    const req = protocol.get(
      downloadUrl,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      (response: any) => {
        // Handle redirect
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlinkSync(installerPath);
          if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error(`Too many redirects: ${downloadUrl}`));
            return;
          }
          const nextUrl = new URL(response.headers.location, downloadUrl).toString();
          downloadAndInstallWithRedirects(nextUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(installerPath);
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        if (totalSize > MAX_DOWNLOAD_BYTES) {
          file.close();
          fs.unlinkSync(installerPath);
          response.destroy();
          reject(new Error(`Download too large: ${totalSize} bytes`));
          return;
        }
        response.pipe(file);

        file.on('finish', () => {
          file.close();
          const actualSize = fs.statSync(installerPath).size;
          if (actualSize <= 0) {
            fs.unlinkSync(installerPath);
            reject(new Error('Downloaded file is empty'));
          } else if (actualSize > MAX_DOWNLOAD_BYTES) {
            fs.unlinkSync(installerPath);
            reject(new Error(`Downloaded file exceeds limit: ${actualSize} bytes`));
          } else if (totalSize > 0 && actualSize !== totalSize) {
            fs.unlinkSync(installerPath);
            reject(new Error(`Download incomplete: expected ${totalSize}, got ${actualSize}`));
          } else {
            logger.info('Download complete', { size: actualSize });
            resolve();
          }
        });
      },
    );

    req.on('error', (err: Error) => {
      file.close();
      if (fs.existsSync(installerPath)) fs.unlinkSync(installerPath);
      reject(err);
    });

    req.setTimeout(300_000, () => {
      req.destroy();
      file.close();
      if (fs.existsSync(installerPath)) fs.unlinkSync(installerPath);
      reject(new Error('Download timed out'));
    });
  });

  // Run silent install
  logger.info('Running silent install', { installerPath });
  await runInstaller(installerPath);

  logger.info('Install complete, restarting...');

  // Cleanup and restart
  try { fs.unlinkSync(installerPath); } catch { /* ignore */ }
  app.relaunch();
  app.exit(0);
}

/**
 * Triggered by WebSocket pc:command { command: 'update' }.
 * Same as startup check but skips version comparison (server already decided).
 */
export async function handleUpdateCommand(downloadUrl?: string, pushedVersion?: string): Promise<void> {
  try {
    const serverUrl = getServerUrl();
    const url = downloadUrl
      ? downloadUrl.startsWith('http')
        ? downloadUrl
        : `${serverUrl}${downloadUrl}`
      : `${serverUrl}/api/agent/download/latest`;
    // 远程推送也得先看清推的是哪一版：这台机器上装坏过、已经拉黑的版本不装。
    let version = pushedVersion || '';
    if (!version) {
      try {
        const res = await fetch(`${serverUrl}/api/agent/version`);
        const json = (await res.json()) as any;
        version = json?.data?.version || '';
      } catch {
        /* 版本号拿不到就照老样子装，看门狗那边还会再拦一道 */
      }
    }
    if (isVersionBlocked(version)) {
      logger.warn('Pushed version is blocked on this machine, skip', { version });
      return;
    }
    // 叫号可能带着旧版本号，或这台机器其实已经装上了 → 版本没变就别白下 123MB。
    // 2026-10-01 线上就是这里漏了判断：全网叫号一轮，每台机器都把整包重下一遍。
    if (version && compareVersions(version, app.getVersion()) <= 0) {
      logger.info('Pushed update is not newer than the local version, skip', {
        version,
        localVersion: app.getVersion(),
      });
      return;
    }
    // 远程推送的机器，服务端已经把这个名额预约给它了（见 reserveUpdateSlot），
    // 所以只需要错开几秒，别再像以前那样错峰 0-60 秒 —— 那几十秒正好容易被别人抢走名额。
    const staggerMs = Math.floor(Math.random() * 5_000);
    await new Promise((resolve) => setTimeout(resolve, staggerMs));
    logger.info('Update command received, downloading...', { url, version });
    await performUpdate(url, version, true);
  } catch (err: any) {
    logger.error('Update command failed', { error: err.message });
  }
}
