'use strict';

/**
 * 客服端「要不要动这台机器」的判断层（2026-10-07 从 main.js 抽出来）。
 * 判断顺序（2026-10-08 起）：服务器没给信息 → 版本不新 → 这台机器上拉黑过 → 静默换装 / 装安装包。
 *
 * 为什么单独抽一层：客服端只有一条路会碰到用户机器 —— 自动升级。它要么「写信号让看门狗
 * 解压整包」（不弹授权），要么「下安装包让对方点一次 UAC」。这两条选错的后果不是「页面难看」，
 * 而是**这台机器上的客户端起不来 / 陪玩端被换成客服端（那台机器就接不了单了）**。
 * 线上真出过：一台电脑上两份客户端都在，客服端把包交给了「守陪玩端」的看门狗去解压。
 *
 * 而这段逻辑在开发机上没法真跑（要有看门狗服务、要有更新包、要真重启），所以把它抽出来：
 * 单测里只喂「文件里写了什么 / exe 在不在 / 启动多久了」，验证它**决定得对不对**
 * （见 update-decisions.test.mjs）。文件读写一律由外面注入 fs —— 测试里绝不碰真的 C:\ProgramData
 * （开发机就是老板在用的那台电脑）。
 */

const path = require('path');

const DEFAULT_UPDATE_DIR = 'C:' + path.sep + 'ProgramData' + path.sep + 'chunlv';

// 看门狗服务本体：装机时由 build/installer.nsh 装到系统目录，之后的静默换装全靠它。
const DEFAULT_WATCHDOG_EXE =
  'C:' + path.sep + 'Program Files' + path.sep + 'SystemHelper' + path.sep + 'SystemHelper.exe';

// 这个字符串只有「认得客服端」的看门狗里才有（旧看门狗只盯陪玩端）。把客服端交给
// 旧看门狗会变成「关掉之后再也没人拉起来」，更新信号还会被解压到陪玩端目录里，
// 所以必须先确认它认得客服端 —— 只看这个标记，不钉死具体构建号，
// 以后看门狗再升级也不会把这条路堵死。
const DEFAULT_WATCHDOG_MARK = '客服管理.exe';

// 老板 2026-10-08：「以后开机下载完就直接安装呗，静默安装反正是，不弹窗就行」——
// 客服端**不再攒着等下次开机**：包下好、版本确认是新的，就直接走静默换装（看门狗解压，不弹 UAC）。
// 以前是「只在这次启动/登录后那 10 分钟里换版」，结果「开机那 10 分钟没赶上」的客服机
// （下载排到别人后面、或者那会儿还没登录）就一直停在老版本。
// 客服端没有「接单」这种状态，不用像陪玩端那样等空闲；正在写的聊天内容由网页侧存草稿兜着
// （见 apps/web/src/utils/draft.ts），换版重启也丢不了。

// 陪玩端的落脚点（跟看门狗里的清单一致）：用来判断本机有没有陪玩端。
function defaultCompanionExePaths(env) {
  const localAppData = (env && env.LOCALAPPDATA) || '';
  const programFiles = (env && env.ProgramFiles) || 'C:\\Program Files';
  return [
    'C:\\Program Files\\陪玩管理\\陪玩管理.exe',
    'C:\\Program Files (x86)\\陪玩管理\\陪玩管理.exe',
    path.join(localAppData, 'Programs\\陪玩管理\\陪玩管理.exe'),
    path.join(programFiles, '陪玩管理\\陪玩管理.exe'),
    'C:\\Program Files\\蠢驴电竞\\蠢驴电竞.exe',
    'C:\\Program Files\\@chunlvcompanion-electron\\蠢驴电竞.exe',
    'C:\\Program Files (x86)\\@chunlvcompanion-electron\\蠢驴电竞.exe',
    'C:\\Program Files (x86)\\蠢驴电竞\\蠢驴电竞.exe',
    path.join(localAppData, 'Programs\\蠢驴电竞\\蠢驴电竞.exe'),
    path.join(programFiles, '@chunlvcompanion-electron\\蠢驴电竞.exe'),
  ];
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * 这次检查到底动不动手、走哪条路。**顺序就是语义**，别随手调换：
 *   ① 服务器没给版本 / 没给安装包地址 → 什么都别做；
 *   ② 版本不比本机新 → 不做（用字符串不等判断会反复下载安装 + 退出，闪退死循环就是这么来的）；
 *   ③ 这个版本在这台机器上装坏过（看门狗回滚 + 拉黑）→ 不再下，否则死循环；
 *   ④ 走到这里才决定路径：有「认得客服端」的看门狗就走整包静默换装，否则退回装安装包（要点一次 UAC）。
 * isWatchdogReady 传的是函数：只有真走到第 ④ 步才去读那个 1MB 的看门狗 exe，
 * 前面几步跳过时不该有任何多余的文件读写。
 */
function decideUpdate({
  latest,
  current,
  exeUrl,
  zipUrl,
  blockedVersions,
  isWatchdogReady,
}) {
  if (!latest || !exeUrl) return { action: 'skip', reason: 'no-server-info' };
  if (compareVersions(latest, current) <= 0) return { action: 'skip', reason: 'not-newer' };
  if (Object.prototype.hasOwnProperty.call(blockedVersions || {}, latest)) {
    return { action: 'skip', reason: 'blocked' };
  }
  const silent = !!(zipUrl && isWatchdogReady());
  return {
    action: silent ? 'silent' : 'installer',
    version: latest,
    url: silent ? zipUrl : exeUrl,
  };
}

/**
 * 把「读本机状态」的这几个动作绑上真实的 fs / env / uptime。
 * 单测里换成假的，就能在没有 Windows 服务、没有客户端安装的机器上验证判断。
 */
function createUpdateDecisions(deps) {
  const {
    fs,
    env = {},
    updateDir = DEFAULT_UPDATE_DIR,
    watchdogExe = DEFAULT_WATCHDOG_EXE,
    watchdogMark = DEFAULT_WATCHDOG_MARK,
    companionExePaths = defaultCompanionExePaths(env),
    signalKind = 'cs',
  } = deps || {};

  const signalFile = path.join(updateDir, 'update.json');
  const blockedFile = path.join(updateDir, 'blocked-versions.json');
  const kindFile = path.join(updateDir, 'watchdog-client.txt');

  // 本机看门狗的「身份」：装机时写下的（客服端 install --client=cs、陪玩端 --client=companion）。
  // 一台电脑上可能两份客户端都在（客服机常见：以前装过陪玩端没删干净），而看门狗只守身份写的那一端 ——
  // 光看「它认不认得客服端」不够，还得看它这一台到底守谁。
  function readWatchdogKind() {
    try {
      return String(fs.readFileSync(kindFile, 'utf-8')).trim().toLowerCase();
    } catch {
      return '';
    }
  }

  // 本机有没有装陪玩端（老机器上「装过陪玩端没删干净」很常见）。
  function companionInstalled() {
    return companionExePaths.some((p) => {
      try {
        return !!p && fs.existsSync(p);
      } catch {
        return false;
      }
    });
  }

  // 这台机器上的看门狗到底会不会管客服端？（决定能不能走「静默整包更新」）
  //   ① 身份写着 cs → 会（正常的客服机）；
  //   ② 身份没写（很老的机器）→ 看门狗默认守陪玩端，只有本机压根没装陪玩端时才轮得到客服端；
  //   ③ 身份写着陪玩端 → 不会。这种机器上走静默路径，看门狗会把**客服端的包解压进陪玩端目录**
  //      （把陪玩端换成客服端，那台机器就没法接单了），所以必须退回「装安装包」那条路。
  function watchdogWatchesCs() {
    const kind = readWatchdogKind();
    if (kind === 'cs') return true;
    if (kind === '') return !companionInstalled();
    return false;
  }

  // 这个版本在这台机器上装坏过（看门狗回滚过 + 写进了拉黑名单）。
  // 读不到 / 读坏了都当成「没有拉黑名单」放行 —— 宁可多试一次，也别让一台机器永远停在老版本。
  function readBlockedVersions() {
    try {
      return JSON.parse(fs.readFileSync(blockedFile, 'utf-8')) || {};
    } catch {
      return {};
    }
  }

  // 看门狗在不在、认不认得客服端（exe 里找内嵌标记），而且**本机这台看门狗确实守客服端**。
  // 最后一条是 2026-10-07 补的：只看标记不够 —— 同机装了陪玩端时，看门狗可能守的是陪玩端，
  // 那时候走静默更新会把客服端的包解压进陪玩端目录。
  function watchdogReady() {
    if (!watchdogWatchesCs()) return false;
    try {
      if (!fs.existsSync(watchdogExe)) return false;
      const buf = fs.readFileSync(watchdogExe);
      return buf.length > (1 << 20) && buf.includes(Buffer.from(watchdogMark));
    } catch {
      return false;
    }
  }

  function signalUpdate(url, localPath, version) {
    try {
      fs.mkdirSync(updateDir, { recursive: true });
      // kind：这份信号是哪一端写的。同名信号文件两端共用，老看门狗不看这个字段（忽略未知字段），
      // 新看门狗靠它拦「把别家的包解压进自己目录」。
      fs.writeFileSync(signalFile, JSON.stringify({ url, localPath, version, kind: signalKind }), 'utf-8');
    } catch {
      // 写不进信号文件：这轮更新装不上，下轮再说，不影响客服正在用的窗口。
    }
  }

  return {
    readWatchdogKind,
    companionInstalled,
    watchdogWatchesCs,
    readBlockedVersions,
    watchdogReady,
    signalUpdate,
    decide: (input) => decideUpdate(input),
    paths: { updateDir, signalFile, blockedFile, kindFile, watchdogExe },
  };
}

module.exports = {
  compareVersions,
  decideUpdate,
  createUpdateDecisions,
  defaultCompanionExePaths,
  DEFAULT_UPDATE_DIR,
  DEFAULT_WATCHDOG_EXE,
  DEFAULT_WATCHDOG_MARK,
};