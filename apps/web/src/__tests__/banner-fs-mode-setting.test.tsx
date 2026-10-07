import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BannerFullscreenModeSetting from '../components/BannerFullscreenModeSetting';

/**
 * 「全屏打游戏时弹不弹窗」这一档的界面测试（2026-10-08）。
 *
 * 老板报童祥瑞那台「订单弹窗一出现就把游戏顶回桌面 / 退到抢单池」。陪玩端从「一个开关」
 * 改成了三档（自动 / 全屏时都不弹 / 全屏时照弹）：
 *   · 三档怎么判断（谁该压住横幅）在陪玩端主进程 —— electron/banner-policy.ts，那边单独测了 17 条；
 *   · 这里只守网页这一侧必须做对的三件事：老键要能迁移过来、点一下要真写进本机、老客户端要提示。
 */

const electronAPI = {
  storeGet: vi.fn<(key: string) => Promise<unknown>>(async () => undefined),
  storeSet: vi.fn<(key: string, value: unknown) => Promise<unknown>>(async () => ({ success: true })),
};

describe('陪玩端设置：全屏打游戏时弹不弹窗', () => {
  beforeEach(() => {
    (window as any).electronAPI = electronAPI;
    electronAPI.storeGet.mockReset();
    electronAPI.storeSet.mockReset();
    electronAPI.storeGet.mockResolvedValue(undefined);
    electronAPI.storeSet.mockResolvedValue({ success: true });
  });

  it('默认显示「自动」，三个选项都在', async () => {
    render(<BannerFullscreenModeSetting />);
    expect(await screen.findByRole('radio', { name: '自动（推荐）' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '全屏时都不弹' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '全屏时照弹' })).toBeInTheDocument();
  });

  it('本机存的是新键（hold）→ 显示成「全屏时都不弹」', async () => {
    electronAPI.storeGet.mockImplementation(async (key: string) =>
      key === 'bannerFullscreenMode' ? 'hold' : undefined,
    );
    render(<BannerFullscreenModeSetting />);
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: '全屏时都不弹' })).toBeChecked();
    });
  });

  it('本机存的是老键 true（老版本的全屏不弹）→ 迁移显示成「全屏时都不弹」', async () => {
    electronAPI.storeGet.mockImplementation(async (key: string) =>
      key === 'bannerMuteWhileFullscreen' ? true : undefined,
    );
    render(<BannerFullscreenModeSetting />);
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: '全屏时都不弹' })).toBeChecked();
    });
  });

  it('本机存的是老键 false（老版本的照旧弹）→ 显示成「全屏时照弹」', async () => {
    electronAPI.storeGet.mockImplementation(async (key: string) =>
      key === 'bannerMuteWhileFullscreen' ? false : undefined,
    );
    render(<BannerFullscreenModeSetting />);
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: '全屏时照弹' })).toBeChecked();
    });
  });

  it('点「全屏时都不弹」→ 把新键写进本机（hold）', async () => {
    render(<BannerFullscreenModeSetting />);
    fireEvent.click(await screen.findByRole('radio', { name: '全屏时都不弹' }));
    await waitFor(() => {
      expect(electronAPI.storeSet).toHaveBeenCalledWith('bannerFullscreenMode', 'hold');
    });
  });

  it('点「全屏时照弹」→ 把新键写进本机（show）', async () => {
    render(<BannerFullscreenModeSetting />);
    fireEvent.click(await screen.findByRole('radio', { name: '全屏时照弹' }));
    await waitFor(() => {
      expect(electronAPI.storeSet).toHaveBeenCalledWith('bannerFullscreenMode', 'show');
    });
  });

  it('写不进去（老客户端不认识这个键）→ 退回原来的选择，别显示成已改好', async () => {
    electronAPI.storeSet.mockRejectedValue(new Error('nope'));
    render(<BannerFullscreenModeSetting />);
    fireEvent.click(await screen.findByRole('radio', { name: '全屏时都不弹' }));
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: '自动（推荐）' })).toBeChecked();
    });
  });

  it('本机陪玩端还没有新版策略（读不到标记）→ 老实提示「升级后才生效」', async () => {
    render(<BannerFullscreenModeSetting />);
    await waitFor(() => {
      expect(screen.getByText(/本机陪玩端升级到最新版后/)).toBeInTheDocument();
    });
  });

  it('本机陪玩端已经是新版（标记 = 1）→ 不提示那句', async () => {
    electronAPI.storeGet.mockImplementation(async (key: string) =>
      key === 'bannerPolicyVersion' ? 1 : undefined,
    );
    render(<BannerFullscreenModeSetting />);
    await waitFor(() => {
      expect(electronAPI.storeGet).toHaveBeenCalledWith('bannerPolicyVersion');
    });
    expect(screen.queryByText(/本机陪玩端升级到最新版后/)).not.toBeInTheDocument();
  });

  it('网页里打开（没有 electronAPI）→ 不炸、也不提示「旧版本」（这条设置只管客户端）', async () => {
    (window as any).electronAPI = undefined;
    render(<BannerFullscreenModeSetting />);
    expect(await screen.findByRole('radio', { name: '自动（推荐）' })).toBeChecked();
    expect(screen.queryByText(/本机陪玩端升级到最新版后/)).not.toBeInTheDocument();
  });
});
