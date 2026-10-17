// craftsman-ignore: TS001,TS002
import { describe, expect, it, vi } from 'vitest';

import {
  SHELL_BRAND,
  isCompanionRole,
  isStaffRole,
  normalizeShellRole,
  shellTitle,
  shouldEnableHibernate,
  shouldShowStatusTray,
  shouldStartCapture,
  trayMenuTemplate,
  trayTooltip,
} from './role-policy';

/**
 * 统一客户端「按登录角色开关能力」的判断（2026-10-17）。
 *
 * 这一层在本机没法真跑（要真登录、真客服账号、真电源设置），但判断错了的后果很具体：
 * 客服机器被改成陪玩口径（改电源设置 / 录屏 / 锁屏），或者陪玩机器少了休眠/截图。
 * 所以每条能力开关、品牌文案、托盘菜单都在这里钉死。
 */

const ALL_ROLES = ['COMPANION', 'CS', 'ADMIN', 'OWNER', 'UNKNOWN'] as const;

function handlers() {
  const onShow = vi.fn();
  const onStatusChange = vi.fn((_status: string) => {});
  const onReload = vi.fn();
  const onQuit = vi.fn();
  return { onShow, onStatusChange, onReload, onQuit };
}

describe('normalizeShellRole —— 网页传什么都只能落到 5 个值之一', () => {
  it('4 个真实角色原样认', () => {
    expect(normalizeShellRole('COMPANION')).toBe('COMPANION');
    expect(normalizeShellRole('CS')).toBe('CS');
    expect(normalizeShellRole('ADMIN')).toBe('ADMIN');
    expect(normalizeShellRole('OWNER')).toBe('OWNER');
  });

  it('大小写 / 前后空格容错（网页历史版本传过小写）', () => {
    expect(normalizeShellRole(' companion ')).toBe('COMPANION');
    expect(normalizeShellRole('cs')).toBe('CS');
    expect(normalizeShellRole('Owner')).toBe('OWNER');
  });

  it('空值 / 老网页没传 / 脏值 → UNKNOWN，绝不默认成 COMPANION', () => {
    for (const v of [undefined, null, '', '   ', 'companion-admin', 'UNKNOWN', 0, 1, {}, []]) {
      expect(normalizeShellRole(v)).toBe('UNKNOWN');
    }
  });
});

describe('角色 → 能力开关', () => {
  it('只有 COMPANION 开陪玩能力：休眠 / 截图 / 状态托盘', () => {
    expect(isCompanionRole('COMPANION')).toBe(true);
    expect(shouldEnableHibernate('COMPANION')).toBe(true);
    expect(shouldStartCapture('COMPANION')).toBe(true);
    expect(shouldShowStatusTray('COMPANION')).toBe(true);
  });

  it('客服 / 店长 / 老板一个都不开（客服机器不能被改电源设置、不能被录屏）', () => {
    for (const role of ['CS', 'ADMIN', 'OWNER']) {
      expect(isCompanionRole(role)).toBe(false);
      expect(shouldEnableHibernate(role)).toBe(false);
      expect(shouldStartCapture(role)).toBe(false);
      expect(shouldShowStatusTray(role)).toBe(false);
    }
  });

  it('UNKNOWN（未登录 / 旧网页不调 setRole）同样不开 —— 不能把未登录机器当成陪玩', () => {
    expect(isCompanionRole('UNKNOWN')).toBe(false);
    expect(shouldEnableHibernate('UNKNOWN')).toBe(false);
    expect(shouldStartCapture('UNKNOWN')).toBe(false);
    expect(shouldShowStatusTray('UNKNOWN')).toBe(false);
  });

  it('isStaffRole 只认客服/店长/老板，陪玩和未知都不算', () => {
    expect(isStaffRole('CS')).toBe(true);
    expect(isStaffRole('ADMIN')).toBe(true);
    expect(isStaffRole('OWNER')).toBe(true);
    expect(isStaffRole('COMPANION')).toBe(false);
    expect(isStaffRole('UNKNOWN')).toBe(false);
  });
});

describe('窗口标题 / 托盘提示：中性品牌「蠢驴电竞」', () => {
  const version = '1.0.20261026';

  it('没有工作室名 → 「蠢驴电竞 v<版本>」', () => {
    for (const role of ALL_ROLES) {
      expect(shellTitle(role, '', version)).toBe('蠢驴电竞 v1.0.20261026');
      expect(shellTitle(role, undefined, version)).toBe('蠢驴电竞 v1.0.20261026');
    }
  });

  it('setStudioName 之后 → 「<工作室> · 蠢驴电竞 v<版本>」', () => {
    for (const role of ALL_ROLES) {
      expect(shellTitle(role, ' 星辰工作室 ', version)).toBe('星辰工作室 · 蠢驴电竞 v1.0.20261026');
    }
  });

  it('版本号为空时不留「v」尾巴（开发模式 / 读不到版本）', () => {
    expect(shellTitle('COMPANION', '', '')).toBe('蠢驴电竞');
    expect(shellTitle('CS', '', undefined)).toBe('蠢驴电竞');
    expect(shellTitle('COMPANION', '星辰', '')).toBe('星辰 · 蠢驴电竞');
  });

  it('托盘提示和窗口标题同一套中性品牌，任何角色都不再出现「陪玩管理」', () => {
    for (const role of ALL_ROLES) {
      const tip = trayTooltip(role, '', version);
      expect(tip).toBe(shellTitle(role, '', version));
      expect(tip).toContain(SHELL_BRAND);
      expect(tip).not.toContain('陪玩管理');
      expect(tip).not.toContain('客服管理');
    }
    expect(trayTooltip('COMPANION', '星辰工作室', version)).toBe('星辰工作室 · 蠢驴电竞 v1.0.20261026');
  });
});

describe('托盘菜单：状态子菜单只给陪玩', () => {
  const labels = (menu: ReturnType<typeof trayMenuTemplate>) =>
    menu.filter((i) => i.type !== 'separator').map((i) => i.label);

  it('COMPANION：有「切换状态」，4 个状态齐全', () => {
    const menu = trayMenuTemplate('COMPANION', handlers());
    expect(labels(menu)).toContain('切换状态');
    const statusItem = menu.find((i) => i.label === '切换状态');
    expect(statusItem?.submenu?.map((s) => s.label)).toEqual(['空闲', '接单', '娱乐', '休息']);
  });

  it('客服 / 店长 / 老板 / 未登录：没有「切换状态」', () => {
    for (const role of ['CS', 'ADMIN', 'OWNER', 'UNKNOWN']) {
      expect(labels(trayMenuTemplate(role, handlers()))).not.toContain('切换状态');
    }
  });

  it('点状态菜单回执正确的状态值', () => {
    const h = handlers();
    const menu = trayMenuTemplate('COMPANION', h);
    const submenu = menu.find((i) => i.label === '切换状态')?.submenu || [];
    for (const item of submenu) item.click?.();
    expect(h.onStatusChange.mock.calls.map((c) => c[0])).toEqual([
      'AVAILABLE',
      'BUSY',
      'ENTERTAINMENT',
      'RESTING',
    ]);
  });

  it('「显示主窗口」「退出」所有角色都有，并且真的回调', () => {
    for (const role of ALL_ROLES) {
      const h = handlers();
      const menu = trayMenuTemplate(role, h);
      expect(labels(menu)).toContain('显示主窗口');
      expect(labels(menu)).toContain('退出');
      menu.find((i) => i.label === '显示主窗口')?.click?.();
      menu.find((i) => i.label === '退出')?.click?.();
      expect(h.onShow).toHaveBeenCalledTimes(1);
      expect(h.onQuit).toHaveBeenCalledTimes(1);
    }
  });

  it('「重新加载页面」是本次从客服端移植的兜底：传了 onReload 才出现', () => {
    for (const role of ALL_ROLES) {
      expect(labels(trayMenuTemplate(role, handlers()))).toContain('重新加载页面');
      expect(labels(trayMenuTemplate(role, { onShow: vi.fn(), onQuit: vi.fn() }))).not.toContain(
        '重新加载页面',
      );
    }
  });

  it('「重新加载页面」点了会真的重新加载（兜底页之后的重试入口）', () => {
    const h = handlers();
    const menu = trayMenuTemplate('UNKNOWN', h);
    menu.find((i) => i.label === '重新加载页面')?.click?.();
    expect(h.onReload).toHaveBeenCalledTimes(1);
  });

  it('陪玩即使没注入状态回调，菜单也保持原样（点状态安全地什么都不做）', () => {
    const menu = trayMenuTemplate('COMPANION', { onShow: vi.fn(), onQuit: vi.fn() });
    const statusItem = menu.find((i) => i.label === '切换状态');
    expect(statusItem?.submenu?.map((s) => s.label)).toEqual(['空闲', '接单', '娱乐', '休息']);
    // 没有回调时点击不能抛错（老代码这里也是空操作）
    expect(() => statusItem?.submenu?.forEach((s) => s.click?.())).not.toThrow();
  });
});
