import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';

/**
 * 客服端「要不要动这台机器」的判断层（apps/cs-electron/update-decisions.js）。
 *
 * 为什么值得单独测：客服端只有一条路会碰到用户机器 —— 自动升级。走错了不是「页面难看」，
 * 而是**这台机器上的客户端起不来 / 陪玩端被换成客服端（那台机器就接不了单）**。
 * 线上真出过：一台电脑上两份客户端都在，客服端把包交给了「守陪玩端」的看门狗去解压。
 *
 * 这里全用假的 fs：**绝不碰真的 C:\\ProgramData**（开发机就是老板在用的那台电脑）。
 */

const requireCjs = createRequire(import.meta.url);
const {
  compareVersions,
  decideUpdate,
  createUpdateDecisions,
  defaultCompanionExePaths,
} = requireCjs('./update-decisions.js');

const MARK = '客服管理.exe';
const WATCHDOG = 'C:\\Program Files\\SystemHelper\\SystemHelper.exe';
const KIND_FILE = 'watchdog-client.txt';
const SIGNAL_FILE = 'update.json';
const BLOCKED_FILE = 'blocked-versions.json';

/** 假 fs：readFileSync 按「路径里含哪段」返回内容 / 抛 ENOENT，existsSync 按白名单回答。 */
function fakeFs({ files = {}, exists = [] } = {}) {
  return {
    readFileSync: vi.fn((p) => {
      const key = Object.keys(files).find((k) => String(p).includes(k));
      if (key === undefined) throw new Error('ENOENT: ' + String(p));
      return files[key];
    }),
    existsSync: vi.fn((p) => exists.some((e) => String(p).includes(e))),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
}

/** 一份「看门狗 exe」：内容够大（>1MB）并可选地带上内嵌标记。 */
function watchdogExeBytes(hasMark = true) {
  const size = (1 << 20) + 64;
  const buf = Buffer.alloc(size, 0x41);
  if (hasMark) Buffer.from(MARK).copy(buf, 1024);
  return buf;
}

function makeDecisions(opts = {}) {
  const fs = opts.fs || fakeFs();
  return {
    fs,
    decisions: createUpdateDecisions({
      fs,
      env: {},
      // 默认用「真清单」：这样「本机装了陪玩端」的判定走的就是线上那套路径表。
      companionExePaths: opts.companionExePaths || defaultCompanionExePaths({}),
      updateDir: 'C:\\ProgramData\\chunlv',
      watchdogExe: WATCHDOG,
      watchdogMark: MARK,
    }),
  };
}

describe('跨端保护：本机这台看门狗守的不是客服端时，绝不走「静默整包换装」', () => {
  it('身份写着 cs = 守客服端，放行', () => {
    const { decisions } = makeDecisions({ fs: fakeFs({ files: { [KIND_FILE]: 'cs\n' } }) });
    expect(decisions.watchdogWatchesCs()).toBe(true);
  });

  it('身份有多余空白 / 大写也认（ CS ）', () => {
    const { decisions } = makeDecisions({ fs: fakeFs({ files: { [KIND_FILE]: ' CS ' } }) });
    expect(decisions.watchdogWatchesCs()).toBe(true);
  });

  it('身份写着 companion = 守陪玩端，不放行（哪怕本机没装陪玩端）', () => {
    const { decisions } = makeDecisions({ fs: fakeFs({ files: { [KIND_FILE]: 'companion' } }) });
    expect(decisions.watchdogWatchesCs()).toBe(false);
  });

  it('身份文件读不到（很老的机器）而本机装了陪玩端 = 不放行', () => {
    const { decisions } = makeDecisions({
      fs: fakeFs({ exists: ['陪玩管理.exe'] }),
    });
    expect(decisions.watchdogWatchesCs()).toBe(false);
  });

  it('身份文件读不到、本机也没有陪玩端 = 放行（这种机器上只有客服端）', () => {
    const { decisions } = makeDecisions();
    expect(decisions.watchdogWatchesCs()).toBe(true);
  });

  it('陪玩端清单里随便命中一个落脚点，就算装了陪玩端', () => {
    const { decisions } = makeDecisions({
      fs: fakeFs({ exists: ['蠢驴电竞.exe'] }),
    });
    expect(decisions.companionInstalled()).toBe(true);
  });
});

describe('看门狗本体：在不在、认不认得客服端、是不是守客服端', () => {
  const ok = () => fakeFs({ files: { [KIND_FILE]: 'cs', 'SystemHelper.exe': watchdogExeBytes(true) }, exists: [WATCHDOG] });

  it('守客服端 + exe 在 + 够大 + 带标记 = 就绪', () => {
    const { decisions } = makeDecisions({ fs: ok() });
    expect(decisions.watchdogReady()).toBe(true);
  });

  it('exe 不在（还没装看门狗）= 没就绪', () => {
    const fs = fakeFs({ files: { [KIND_FILE]: 'cs', 'SystemHelper.exe': watchdogExeBytes(true) } });
    const { decisions } = makeDecisions({ fs });
    expect(decisions.watchdogReady()).toBe(false);
  });

  it('exe 是个半截文件（<1MB）= 没就绪', () => {
    const fs = fakeFs({ files: { [KIND_FILE]: 'cs', 'SystemHelper.exe': Buffer.from(MARK) }, exists: [WATCHDOG] });
    const { decisions } = makeDecisions({ fs });
    expect(decisions.watchdogReady()).toBe(false);
  });

  it('exe 够大但不含客服端标记（旧看门狗）= 没就绪', () => {
    const fs = fakeFs({ files: { [KIND_FILE]: 'cs', 'SystemHelper.exe': watchdogExeBytes(false) }, exists: [WATCHDOG] });
    const { decisions } = makeDecisions({ fs });
    expect(decisions.watchdogReady()).toBe(false);
  });

  it('看门狗什么都对，但本机这台守的是陪玩端 = 没就绪（最危险的一种）', () => {
    const fs = fakeFs({
      files: { [KIND_FILE]: 'companion', 'SystemHelper.exe': watchdogExeBytes(true) },
      exists: [WATCHDOG, '陪玩管理.exe'],
    });
    const { decisions } = makeDecisions({ fs });
    expect(decisions.watchdogReady()).toBe(false);
  });

  it('读 exe 时抛错 = 没就绪（不往外冒异常）', () => {
    const fs = fakeFs({ files: { [KIND_FILE]: 'cs' }, exists: [WATCHDOG] });
    const { decisions } = makeDecisions({ fs });
    expect(decisions.watchdogReady()).toBe(false);
  });
});

describe('拉黑名单：读不到 / 读坏了都当「没有」，宁可多试一次也别停在老版本', () => {
  it('正常读到内容', () => {
    const { decisions } = makeDecisions({
      fs: fakeFs({ files: { [BLOCKED_FILE]: '{"1.0.5":true}' } }),
    });
    expect(decisions.readBlockedVersions()).toEqual({ '1.0.5': true });
  });

  it('文件不存在 = 空对象', () => {
    const { decisions } = makeDecisions();
    expect(decisions.readBlockedVersions()).toEqual({});
  });

  it('内容不是 JSON = 空对象', () => {
    const { decisions } = makeDecisions({ fs: fakeFs({ files: { [BLOCKED_FILE]: '{坏了' } }) });
    expect(decisions.readBlockedVersions()).toEqual({});
  });

  it('内容恰好是 null = 空对象', () => {
    const { decisions } = makeDecisions({ fs: fakeFs({ files: { [BLOCKED_FILE]: 'null' } }) });
    expect(decisions.readBlockedVersions()).toEqual({});
  });
});

describe('写更新信号：必须带 kind=cs（看门狗靠它拦「把别家的包解压进自己目录」）', () => {
  it('信号内容和落点都对', () => {
    const { fs, decisions } = makeDecisions();
    decisions.signalUpdate('http://x/update-cs.zip', 'C:\\ProgramData\\chunlv\\update-cs.zip', '1.0.1000');

    expect(fs.mkdirSync).toHaveBeenCalledWith('C:\\ProgramData\\chunlv', { recursive: true });
    const [file, body] = fs.writeFileSync.mock.calls[0];
    expect(String(file)).toContain(SIGNAL_FILE);
    expect(JSON.parse(body)).toEqual({
      url: 'http://x/update-cs.zip',
      localPath: 'C:\\ProgramData\\chunlv\\update-cs.zip',
      version: '1.0.1000',
      kind: 'cs',
    });
  });

  it('写不进去（磁盘 / 权限）不往外抛：这轮装不上就下轮再说', () => {
    const { fs, decisions } = makeDecisions();
    fs.writeFileSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(() => decisions.signalUpdate('u', 'p', '1.0')).not.toThrow();
  });
});

describe('不再有「启动宽限期」这道闸（老板 2026-10-08：开机下载完就直接装，不攒着等下次开机）', () => {
  it('决策层里已经没有 withinLaunchGrace 这个东西了', () => {
    const { decisions } = makeDecisions();
    expect(decisions.withinLaunchGrace).toBeUndefined();
  });
});

describe('decideUpdate：动不动手、走哪条路（顺序就是语义）', () => {
  const base = {
    latest: '1.0.2000',
    current: '1.0.1000',
    exeUrl: '/uploads/setup.exe',
    zipUrl: '/uploads/update-cs.zip',
    blockedVersions: {},
    isWatchdogReady: () => true,
  };

  it('服务器没给版本 / 没给安装包地址 = 什么都不做', () => {
    expect(decideUpdate({ ...base, latest: undefined })).toEqual({ action: 'skip', reason: 'no-server-info' });
    expect(decideUpdate({ ...base, exeUrl: undefined })).toEqual({ action: 'skip', reason: 'no-server-info' });
  });

  it('版本不比本机新 = 不做（相等也算）', () => {
    expect(decideUpdate({ ...base, latest: '1.0.1000' }).reason).toBe('not-newer');
    expect(decideUpdate({ ...base, latest: '1.0.0900' }).reason).toBe('not-newer');
  });

  it('这个版本在这台机器上装坏过 = 不再下（否则就是死循环）', () => {
    expect(decideUpdate({ ...base, blockedVersions: { '1.0.2000': '2 次回滚' } })).toEqual({
      action: 'skip',
      reason: 'blocked',
    });
  });

  it('老代码传进来的 withinGrace 不再拦人（宽限期这道闸已经拿掉了）', () => {
    expect(decideUpdate({ ...base, withinGrace: false }).action).toBe('silent');
  });

  it('都在、看门狗也守客服端 = 走静默整包（url 取 zip）', () => {
    expect(decideUpdate(base)).toEqual({
      action: 'silent',
      version: '1.0.2000',
      url: '/uploads/update-cs.zip',
    });
  });

  it('看门狗不认客服端 / 守的是陪玩端 = 退回装安装包（要点一次 UAC）', () => {
    expect(decideUpdate({ ...base, isWatchdogReady: () => false })).toEqual({
      action: 'installer',
      version: '1.0.2000',
      url: '/uploads/setup.exe',
    });
  });

  it('服务器没给 zip 地址 = 同样退回装安装包', () => {
    expect(decideUpdate({ ...base, zipUrl: undefined }).action).toBe('installer');
  });

  it('前面几步就跳过时，绝不去读那个 1MB 的看门狗 exe', () => {
    const isWatchdogReady = vi.fn(() => true);
    decideUpdate({ ...base, latest: undefined, isWatchdogReady });
    decideUpdate({ ...base, exeUrl: undefined, isWatchdogReady });
    decideUpdate({ ...base, latest: '1.0.1000', isWatchdogReady });
    decideUpdate({ ...base, blockedVersions: { '1.0.2000': true }, isWatchdogReady });
    expect(isWatchdogReady).toHaveBeenCalledTimes(0);
    // 只有真走到「该动手了」这一步才会去读 exe
    decideUpdate({ ...base, isWatchdogReady });
    expect(isWatchdogReady).toHaveBeenCalledTimes(1);
  });

  it('拉黑名单是 null 也不会炸（读坏文件时就是各种奇怪形状）', () => {
    expect(decideUpdate({ ...base, blockedVersions: null }).action).toBe('silent');
  });
});

describe('compareVersions：按段比数字，不是按字符串', () => {
  it('1.10.0 比 1.9.0 新（字符串比会得出反的结论）', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
  });

  it('相等返回 0', () => {
    expect(compareVersions('1.0.20261020', '1.0.20261020')).toBe(0);
  });

  it('段数不一样时缺的当 0', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0.1', '1.0')).toBe(1);
  });

  it('不是数字的段当 0', () => {
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0);
  });
});