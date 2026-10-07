import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BannerFullscreenModeSetting from '../components/BannerFullscreenModeSetting';

/**
 * 「全屏打游戏时弹不弹窗」这一档的界面测试（2026-10-08）。
 *
 * 老板报童祥瑞那台「订单弹窗一出现就把游戏顶回桌面 / 退到抢单池」。陪玩端从「一个开关」
 * 改成了三档（自动 / 全屏时都不弹 / 全屏时照弹）：
 *   · 三档怎么判断（谁该压住横幅）在陪玩端主进程 —— electron/banner-policy.ts，那边单独测了 17 条；
 *   · 这里只守网页这一侧必须做对的三件事：老键要能迁移过来、点一下要**两个键一起**真写进本机
 *     （新键给新版客户端 / 老键给老板现在这些客户端，详见组件顶部注释）、太老的客户端要拦住别骗人。
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
      expect(screen.getByText(/本机陪玩端还是老版本/)).toBeInTheDocument();
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
    expect(screen.queryByText(/本机陪玩端还是老版本/)).not.toBeInTheDocument();
  });

  it('网页里打开（没有 electronAPI）→ 不炸、也不提示「旧版本」（这条设置只管客户端）', async () => {
    (window as any).electronAPI = undefined;
    render(<BannerFullscreenModeSetting />);
    expect(await screen.findByRole('radio', { name: '自动（推荐）' })).toBeChecked();
    expect(screen.queryByText(/本机陪玩端还是老版本/)).not.toBeInTheDocument();
  });

  it('点「全屏时都不弹」→ 老键也一起写成 true（老板现有的客户端认这个）', async () => {
    render(<BannerFullscreenModeSetting />);
    fireEvent.click(await screen.findByRole('radio', { name: '全屏时都不弹' }));
    await waitFor(() => {
      expect(electronAPI.storeSet).toHaveBeenCalledWith('bannerMuteWhileFullscreen', true);
    });
  });

  it('点「全屏时照弹」→ 老键也一起写成 false', async () => {
    render(<BannerFullscreenModeSetting />);
    fireEvent.click(await screen.findByRole('radio', { name: '全屏时照弹' }));
    await waitFor(() => {
      expect(electronAPI.storeSet).toHaveBeenCalledWith('bannerMuteWhileFullscreen', false);
    });
  });

  it('太老的客户端两个键都不认（success:false）→ 退回原选择 + 提示改游戏画面，不骗人', async () => {
    electronAPI.storeSet.mockResolvedValue({ success: false });
    render(<BannerFullscreenModeSetting />);
    fireEvent.click(await screen.findByRole('radio', { name: '全屏时都不弹' }));
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: '自动（推荐）' })).toBeChecked();
    });
    expect(await screen.findByText(/无边框全屏/)).toBeInTheDocument();
  });

  it('老客户端上选「自动」→ 说清本机等同「照弹」，不谎报成已防住', async () => {
    render(<BannerFullscreenModeSetting />);
    await waitFor(() => { expect(screen.getByRole('radio', { name: '自动（推荐）' })).toBeChecked(); });
    fireEvent.click(screen.getByRole('radio', { name: '全屏时照弹' }));
    await waitFor(() => { expect(electronAPI.storeSet).toHaveBeenCalledWith('bannerFullscreenMode', 'show'); });
    fireEvent.click(screen.getByRole('radio', { name: '自动（推荐）' }));
    await waitFor(() => { expect(electronAPI.storeSet).toHaveBeenCalledWith('bannerFullscreenMode', 'auto'); });
  });

  it('老键 true 迁移成「全屏时都不弹」后，再点「照弹」要把老键改回 false', async () => {
    electronAPI.storeGet.mockImplementation(async (key: string) =>
      key === 'bannerMuteWhileFullscreen' ? true : undefined,
    );
    render(<BannerFullscreenModeSetting />);
    fireEvent.click(await screen.findByRole('radio', { name: '全屏时照弹' }));
    await waitFor(() => {
      expect(electronAPI.storeSet).toHaveBeenCalledWith('bannerMuteWhileFullscreen', false);
    });
  });
});
