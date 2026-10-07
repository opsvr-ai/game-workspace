import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { stubApi } from '../test/apiStub';

vi.mock('../api/companions', async () => stubApi(await vi.importActual('../api/companions'), 'companionsApi'));
import { companionsApi } from '../api/companions';
import OrderNotifySettingsPanel, { notifyDecision } from '../components/OrderNotifySettingsPanel';
import NotifySettingsPage from '../pages/companion/NotifySettingsPage';

/**
 * 陪玩端「订单通知设置」测试（2026-10-08）。
 *
 * 老板原话：「刚才看了王甲振电脑，他设置里没有关弹窗的地方，并且没弹窗」。
 * 拆成两件事来守：
 *   ① 判定口径 —— notifyDecision（纯函数）必须跟服务端 ws.gateway.ts 的 urgentRecipientWhere 一致：
 *      空闲 / 挂机一律弹；接单中看 notifyWhileBusy（默认关）；娱乐中看 notifyWhileEntertainment（默认开）；
 *   ② 界面 —— 面板必须把「现在弹不弹、为什么」写在脸上，而且开关点下去要真写回服务端；
 *      另外它得能挂在「设置 → 通知设置」页里（以前只藏在首页那颗没字的 🔔 里）。
 */

const electronAPI = {
  storeGet: vi.fn(async () => undefined),
  storeSet: vi.fn(async () => ({ success: true })),
};

/** 按标签找到同一行的开关（antd 的 Switch 本身没有可读名字，只能从旁边的字定位）。 */
const switchFor = (label: string): HTMLElement => {
  // 标签是 <span class="ant-typography"><strong>文字</strong></span>，所以要从 <strong> 往上找回那一行 div。
  const row = screen.getByText(label).closest('div') as HTMLElement;
  const el = row?.querySelector('.ant-switch');
  if (!el) throw new Error('找不到『' + label + '』那一行的开关');
  return el as HTMLElement;
};

const mockPrefs = (data: Record<string, unknown>) =>
  (companionsApi.notifyPrefs as any).mockResolvedValue({ data: { data } });

describe('陪玩端「新单弹窗会不会弹」的判定（跟服务端口径一致）', () => {
  const off = { notifyWhileBusy: false, notifyWhileEntertainment: false };
  const on = { notifyWhileBusy: true, notifyWhileEntertainment: true };

  it('空闲 → 一律弹（不受开关影响）', () => {
    expect(notifyDecision('AVAILABLE', off).pop).toBe(true);
  });

  it('挂机（休息）→ 一律弹（不受开关影响）', () => {
    expect(notifyDecision('RESTING', off).pop).toBe(true);
  });

  it('接单中 + 开关关着 → 不弹，并且说清是哪个开关', () => {
    const d = notifyDecision('BUSY', off);
    expect(d.pop).toBe(false);
    expect(d.why).toContain('打单中也接收新单弹窗');
  });

  it('接单中 + 开关打开 → 弹', () => {
    expect(notifyDecision('BUSY', { ...off, notifyWhileBusy: true }).pop).toBe(true);
  });

  it('娱乐中 → 看「娱乐中也接收新单弹窗」', () => {
    expect(notifyDecision('ENTERTAINMENT', { ...off, notifyWhileEntertainment: true }).pop).toBe(true);
    expect(notifyDecision('ENTERTAINMENT', { ...off, notifyWhileEntertainment: false }).pop).toBe(false);
  });

  it('离线 / 状态未知 → 不弹', () => {
    expect(notifyDecision('OFFLINE', on).pop).toBe(false);
    expect(notifyDecision(null, on).pop).toBe(false);
  });
});

describe('陪玩端「订单通知设置」面板', () => {
  beforeEach(() => {
    (window as any).electronAPI = electronAPI;
    electronAPI.storeSet.mockClear();
    mockPrefs({ notifyWhileBusy: false, notifyWhileEntertainment: true, status: 'BUSY' });
  });

  it('接单中 + 开关关着 → 面板顶部就写「现在不弹新单」和原因', async () => {
    render(<OrderNotifySettingsPanel />);
    expect(await screen.findByText('现在不弹新单')).toBeInTheDocument();
    expect(screen.getByText(/打单中也接收新单弹窗」关着/)).toBeInTheDocument();
  });

  it('空闲时 → 面板顶部写「现在会弹新单」', async () => {
    mockPrefs({ notifyWhileBusy: false, notifyWhileEntertainment: true, status: 'AVAILABLE' });
    render(<OrderNotifySettingsPanel />);
    expect(await screen.findByText('现在会弹新单')).toBeInTheDocument();
  });

  it('把「打单中也接收新单弹窗」打开 → 真的写回服务端，顶部也跟着变成会弹', async () => {
    render(<OrderNotifySettingsPanel />);
    await screen.findByText('现在不弹新单');
    // eslint-disable-next-line no-console
    console.log('DBG', (screen.getByText('打单中也接收新单弹窗').parentElement as HTMLElement).outerHTML.slice(0, 700));
    fireEvent.click(switchFor('打单中也接收新单弹窗'));
    await waitFor(() => {
      expect(companionsApi.setNotifyPrefs).toHaveBeenCalledWith({ notifyWhileBusy: true });
    });
    expect(await screen.findByText('现在会弹新单')).toBeInTheDocument();
  });

  it('「全屏打游戏时弹不弹窗」这一档也在面板里（童祥瑞那台靠它）', async () => {
    render(<OrderNotifySettingsPanel />);
    expect(await screen.findByText('全屏打游戏时弹不弹窗')).toBeInTheDocument();
  });
});

describe('设置 → 通知设置 页', () => {
  beforeEach(() => {
    (window as any).electronAPI = electronAPI;
    mockPrefs({ notifyWhileBusy: true, notifyWhileEntertainment: true, status: 'AVAILABLE' });
  });

  it('页面打得开，标题在、面板在（以前从菜单进来根本找不到这些开关）', async () => {
    render(
      <MemoryRouter>
        <NotifySettingsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('通知设置')).toBeInTheDocument();
    expect(screen.getByText('打单中也接收新单弹窗')).toBeInTheDocument();
    expect(screen.getByText('娱乐中也接收新单弹窗')).toBeInTheDocument();
  });
});
