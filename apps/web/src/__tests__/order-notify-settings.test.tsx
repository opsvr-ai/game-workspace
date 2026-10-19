import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { stubApi } from '../test/apiStub';

vi.mock('../api/companions', async () => stubApi(await vi.importActual('../api/companions'), 'companionsApi'));
import { companionsApi } from '../api/companions';
import OrderNotifySettingsPanel from '../components/OrderNotifySettingsPanel';
import NotifySettingsPage from '../pages/companion/NotifySettingsPage';

const electronAPI = {
  storeGet: vi.fn(async () => undefined),
  storeSet: vi.fn(async () => ({ success: true })),
};

const mockPrefs = (data: Record<string, unknown>) =>
  (companionsApi.notifyPrefs as any).mockResolvedValue({ data: { data } });

const switchEl = (): HTMLElement => {
  const el = document.querySelector('.ant-switch');
  if (!el) throw new Error('找不到接单中弹窗开关');
  return el as HTMLElement;
};

describe('陪玩端通知设置：只保留「接单中弹窗」一个开关', () => {
  beforeEach(() => {
    (window as any).electronAPI = electronAPI;
    (companionsApi.setNotifyPrefs as any).mockResolvedValue({ data: { data: {} } });
    mockPrefs({ notifyWhileBusy: false });
  });

  it('显示「接单中弹窗」和是/否开关，初始为否', async () => {
    render(<OrderNotifySettingsPanel />);
    expect(await screen.findByText('接单中弹窗')).toBeInTheDocument();
    await waitFor(() => expect(switchEl().classList.contains('ant-switch-checked')).toBe(false));
    expect(switchEl().textContent).toContain('否');
  });

  it('打开开关后真的写回服务端', async () => {
    render(<OrderNotifySettingsPanel />);
    await screen.findByText('接单中弹窗');
    fireEvent.click(switchEl());
    await waitFor(() => expect(companionsApi.setNotifyPrefs).toHaveBeenCalledWith({ notifyWhileBusy: true }));
    await waitFor(() => expect(switchEl().classList.contains('ant-switch-checked')).toBe(true));
  });

  it('服务端已经是打开状态时，进页面显示「是」', async () => {
    mockPrefs({ notifyWhileBusy: true });
    render(<OrderNotifySettingsPanel />);
    await waitFor(() => expect(switchEl().classList.contains('ant-switch-checked')).toBe(true));
    expect(switchEl().textContent).toContain('是');
  });

  it('设置页能打开，标题和开关都在', async () => {
    render(
      <MemoryRouter>
        <NotifySettingsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('通知设置')).toBeInTheDocument();
    expect(screen.getByText('接单中弹窗')).toBeInTheDocument();
    expect(switchEl()).toBeInTheDocument();
  });
});
