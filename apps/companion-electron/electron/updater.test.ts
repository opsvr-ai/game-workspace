// craftsman-ignore: TS001,TS002
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __test__ } from './updater';

/**
 * 陪玩端「要不要动用户这台机器」的那几个判断（详见 vitest.config.ts 的说明）。
 *
 * 这里**不启动 Electron**：electron / store / logger / tray / child_process 全打桩，
 * fs 也打桩 —— 绝不真的读写 C:\ProgramData（开发机就是老板在用的那台机器）。
 */

// 这几组桩要交给 vi.mock 的工厂用，所以必须走 vi.hoisted：
// vitest 会把 vi.mock 和 vi.hoisted 一起提到**所有 import 之前**求值，
// 普通 const 会被 import 抢跑、撞上「Cannot access before initialization」。
const { fsMock, appMock, storeMock } = vi.hoisted(() => ({
  fsMock: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(),
    rmSync: vi.fn(),
    unlinkSync: vi.fn(),
    existsSync: vi.fn(),
    createWriteStream: vi.fn(),
  },
  appMock: { getVersion: vi.fn(() => '1.0.1000') },
  storeMock: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('fs', () => ({ ...fsMock, default: fsMock }));
vi.mock('electron', () => ({ app: appMock }));
vi.mock('./store', () => ({ store: storeMock }));

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./tray', () => ({
  startUpdateSpin: vi.fn(),
  stopUpdateSpin: vi.fn(),
  updateTrayTooltip: vi.fn(),
}));
vi.mock('./config', () => ({ getServerUrl: vi.fn(() => 'http://127.0.0.1:3001') }));
vi.mock('child_process', () => ({ execFile: vi.fn() }));


/** 让「读某个文件」返回内容；其他路径一律当作不存在。 */
function stubFile(filePart: string, content: string) {
  fsMock.readFileSync.mockImplementation((p: unknown) => {
    if (String(p).includes(filePart)) return content;
    throw new Error('ENOENT: ' + String(p));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  appMock.getVersion.mockReturnValue('1.0.1000');
});

describe('跨端保护：本机看门狗守的不是陪玩端时，绝不写更新信号', () => {
  it('身份文件写着 cs（本机是客服端）= 不认，返回 false', () => {
    stubFile('watchdog-client.txt', 'cs\n');
    expect(__test__.watchdogWatchesCompanion()).toBe(false);
  });

  it('身份区分大小写与空格：' + ' CS ' + ' 也算客服端', () => {
    stubFile('watchdog-client.txt', ' CS ');
    expect(__test__.watchdogWatchesCompanion()).toBe(false);
  });

  it('身份写着 companion = 认', () => {
    stubFile('watchdog-client.txt', 'companion');
    expect(__test__.watchdogWatchesCompanion()).toBe(true);
  });

  it('身份文件不存在（很老的机器）= 按陪玩端算，不能因为读不到就永远不更新', () => {
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(__test__.watchdogWatchesCompanion()).toBe(true);
  });

  it('读的就是装机时写下的那个身份文件', () => {
    stubFile('watchdog-client.txt', 'companion');
    __test__.watchdogWatchesCompanion();
    expect(String(fsMock.readFileSync.mock.calls[0][0])).toContain('chunlv');
    expect(String(fsMock.readFileSync.mock.calls[0][0])).toContain('watchdog-client.txt');
  });
});

describe('更新信号带上「我是哪一端」', () => {
  it('写信号必须带 kind=companion —— 看门狗靠它判断这是陪玩端的包', () => {
    __test__.signalUpdate('http://x/y.zip', 'C:\\pkg\\a.zip', '1.0.2000');
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
    const [file, body] = fsMock.writeFileSync.mock.calls[0];
    expect(String(file)).toContain('update.json');
    expect(JSON.parse(String(body))).toEqual({
      url: 'http://x/y.zip',
      localPath: 'C:\\pkg\\a.zip',
      version: '1.0.2000',
      kind: 'companion',
    });
  });

  it('没有本地包 / 版本号时，那两个字段干脆不写（老看门狗也不认未知字段）', () => {
    __test__.signalUpdate('http://x/y.zip');
    const [, body] = fsMock.writeFileSync.mock.calls[0];
    const parsed = JSON.parse(String(body));
    expect(parsed).toEqual({ url: 'http://x/y.zip', kind: 'companion' });
    expect('localPath' in parsed).toBe(false);
    expect('version' in parsed).toBe(false);
  });
});

describe('被看门狗拉黑的版本不许反复下回来', () => {
  it('名单里有这版 → 拉黑', () => {
    stubFile('blocked-versions.json', JSON.stringify({ '1.0.2000': '装完起不来，已回滚' }));
    expect(__test__.isVersionBlocked('1.0.2000')).toBe(true);
  });

  it('名单里没有这版 → 放行', () => {
    stubFile('blocked-versions.json', JSON.stringify({ '1.0.2000': 'x' }));
    expect(__test__.isVersionBlocked('1.0.2001')).toBe(false);
  });

  it('名单文件读不到 / 坏了 → 一律放行（宁可多试一次，也别因为文件坏了永远不更新）', () => {
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(__test__.isVersionBlocked('1.0.2000')).toBe(false);
    fsMock.readFileSync.mockReturnValue('{ 这不是 json');
    expect(__test__.isVersionBlocked('1.0.2000')).toBe(false);
  });

  it('空版本号 / 原型链上的名字（constructor）不算被拉黑', () => {
    stubFile('blocked-versions.json', '{}');
    expect(__test__.isVersionBlocked('')).toBe(false);
    expect(__test__.isVersionBlocked('constructor')).toBe(false);
  });
});

describe('同一个包别反复下一遍（123MB，一天能刷出几十 GB）', () => {
  const stubAttempt = (version: string, atMs: number) => {
    storeMock.get.mockImplementation((k: string) => {
      if (k === 'updateAttemptVersion') return version;
      if (k === 'updateAttemptAt') return atMs;
      return undefined;
    });
  };

  it('同一版、30 分钟内 → 先不再下', () => {
    stubAttempt('1.0.2000', Date.now() - 1000);
    expect(__test__.sameVersionTriedRecently('1.0.2000')).toBe(true);
  });

  it('超过 30 分钟 → 可以再试一次', () => {
    stubAttempt('1.0.2000', Date.now() - 31 * 60 * 1000);
    expect(__test__.sameVersionTriedRecently('1.0.2000')).toBe(false);
  });

  it('本机已经是这一版 → 不算「重试中」（压根不用再下）', () => {
    appMock.getVersion.mockReturnValue('1.0.2000');
    stubAttempt('1.0.2000', Date.now() - 1000);
    expect(__test__.sameVersionTriedRecently('1.0.2000')).toBe(false);
  });

  it('记的是别的版本 / 没记过 → 放行', () => {
    stubAttempt('1.0.1000', Date.now() - 1000);
    expect(__test__.sameVersionTriedRecently('1.0.2000')).toBe(false);
  });
});

describe('备货包（先下好，等空闲再装）能不能用', () => {
  const ready = { isFile: () => true, size: 120 * 1024 * 1024 };

  it('标记在 + 包在 + 够大 → 能用', () => {
    stubFile('staged-update.json', JSON.stringify({ version: '1.0.2000', localPath: 'C:\\pkg\\a.zip' }));
    fsMock.statSync.mockReturnValue(ready);
    expect(__test__.stagedPackageReady('1.0.2000', 'C:\\fallback.zip')).toBe(true);
  });

  it('标记里的版本和目标版本对不上 → 不能用', () => {
    stubFile('staged-update.json', JSON.stringify({ version: '1.0.2000', localPath: 'C:\\pkg\\a.zip' }));
    fsMock.statSync.mockReturnValue(ready);
    expect(__test__.stagedPackageReady('1.0.2001', 'C:\\fallback.zip')).toBe(false);
  });

  it('包已经没了（或只有半个文件）→ 不能用', () => {
    stubFile('staged-update.json', JSON.stringify({ version: '1.0.2000', localPath: 'C:\\pkg\\a.zip' }));
    fsMock.statSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(__test__.stagedPackageReady('1.0.2000', 'C:\\fallback.zip')).toBe(false);
    fsMock.statSync.mockReturnValue({ isFile: () => true, size: 1000 });
    expect(__test__.stagedPackageReady('1.0.2000', 'C:\\fallback.zip')).toBe(false);
  });

  it('没备过货 → 不能用', () => {
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(__test__.stagedPackageReady('1.0.2000', 'C:\\fallback.zip')).toBe(false);
  });

  it('标记里没写路径时用兜底路径去量', () => {
    stubFile('staged-update.json', JSON.stringify({ version: '1.0.2000', localPath: '' }));
    fsMock.statSync.mockReturnValue(ready);
    expect(__test__.stagedPackageReady('1.0.2000', 'C:\\fallback.zip')).toBe(true);
  });
});

describe('版本号比较', () => {
  it('按段比数字，不是按字符串比', () => {
    expect(__test__.compareVersions('1.0.2001', '1.0.2000')).toBe(1);
    expect(__test__.compareVersions('1.0.2000', '1.0.2001')).toBe(-1);
    expect(__test__.compareVersions('1.0.2000', '1.0.2000')).toBe(0);
    expect(__test__.compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(__test__.compareVersions('1.0.2000', '1.0.2000.0')).toBe(0);
  });
});
