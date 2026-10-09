import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { stubApi } from '../test/apiStub';

/**
 * 「战绩图审核」页的按钮（老板 2026-10-09：「客服端怎么不能采纳陪玩上传的战绩图？」）。
 *
 * 客服端进的就是这一页（侧栏 /admin/battle-screenshots，客服那栏的标题 2026-10-09 起叫
 * 「战绩图审核」）。以前客服只能「下载图片包」，采纳 / 驳回两颗按钮只有店长 / 老板看得到 ——
 * 上传时那条实时提醒本来就发给客服，点进去却什么都做不了。这里守三件事：
 *   ① 客服看得到「采纳并加分 / 驳回」，点了真的调 review('approve')；
 *   ② 店长也一样（没被这次改动弄坏）；
 *   ③ 客服看不到「下载图片包」以外的东西，但也不该看到别家的（列表本来就按店过滤）。
 */

const { httpMock } = vi.hoisted(() => ({
  httpMock: {
    get: vi.fn((..._args: any[]): Promise<any> => Promise.resolve({ data: { data: [] } })),
    post: vi.fn((..._args: any[]): Promise<any> => Promise.resolve({ data: { data: null } })),
    put: vi.fn((..._args: any[]): Promise<any> => Promise.resolve({ data: { data: null } })),
    delete: vi.fn((..._args: any[]): Promise<any> => Promise.resolve({ data: { data: null } })),
  },
}));
vi.mock('../api/client', () => ({ default: httpMock }));
vi.mock('../api/battleScreenshots', async () =>
  stubApi(await vi.importActual('../api/battleScreenshots'), 'battleScreenshotsApi'));

import BattleScreenshotReviewPage from '../pages/BattleScreenshotReviewPage';
import { battleScreenshotsApi } from '../api/battleScreenshots';
import { useAuthStore } from '../stores/authStore';

const SHOT = {
  id: 'b1',
  companionId: 'c1',
  images: ['/uploads/battle-screenshots/童祥瑞/2026-10-09/1.jpg'],
  status: 'PENDING',
  createdAt: '2026-10-09T04:00:00.000Z',
  companion: { user: { username: 'tongxiangrui', displayName: '童祥瑞' } },
};

function renderPage(role: string) {
  useAuthStore.setState({
    user: { id: 'u1', username: 'u1', role, studioId: 's1' } as never,
    isAuthenticated: true,
  });
  return render(
    <MemoryRouter>
      <BattleScreenshotReviewPage />
    </MemoryRouter>,
  );
}

describe('战绩图审核 —— 客服也能采纳（老板 2026-10-09）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (battleScreenshotsApi.list as any).mockResolvedValue({ data: { data: [SHOT] } });
    (battleScreenshotsApi.review as any).mockResolvedValue({ data: { data: { id: 'b1' } } });
  });

  it('客服看得到「采纳并加分 / 驳回」，点采纳真的调 review(approve)', async () => {
    renderPage('CS');
    const approve = await screen.findByText('采纳并加分');
    // antd 会在两个中文字之间插一个空格：按钮里实际是「驳 回」，所以用正则匹配。
    expect(screen.getByRole('button', { name: /驳\s*回/ })).toBeTruthy();

    fireEvent.click(approve);
    await waitFor(() =>
      expect(battleScreenshotsApi.review).toHaveBeenCalledWith('b1', 'approve', undefined),
    );
  });

  it('店长照样能采纳（这次改动没动到店长）', async () => {
    renderPage('ADMIN');
    const approve = await screen.findByText('采纳并加分');
    fireEvent.click(approve);
    await waitFor(() =>
      expect(battleScreenshotsApi.review).toHaveBeenCalledWith('b1', 'approve', undefined),
    );
  });

  it('页面标题对能采纳的人叫「战绩图审核」', async () => {
    renderPage('CS');
    expect(await screen.findByText('战绩图审核')).toBeTruthy();
  });
});

/**
 * 战绩图改成「缩略图直接看」（老板 2026-10-09：「点查看文件怎么疯狂弹窗？能不能直接改成
 * 缩略图的形式？方便查看，觉得可以就直接点采纳」）。
 *
 * 以前这一页不显示图，唯一能看到战绩图的路子是「下载图片包 → 解压 → 开文件夹」，
 * 一组一弹、越点越多。现在缩略图直接铺在每条记录里，点一张放大（PreviewGroup），
 * 觉得可以，下面的「采纳并加分」当场就能点。
 */
const SHOT3 = {
  ...SHOT,
  id: 'b2',
  images: [
    '/uploads/battle-screenshots/童祥瑞/2026-10-09/1.jpg',
    '/uploads/battle-screenshots/童祥瑞/2026-10-09/2.jpg',
    '/uploads/battle-screenshots/童祥瑞/2026-10-09/3.jpg',
  ],
};

describe('战绩图审核 —— 缩略图直接看（老板 2026-10-09）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (battleScreenshotsApi.list as any).mockResolvedValue({ data: { data: [SHOT3] } });
    (battleScreenshotsApi.review as any).mockResolvedValue({ data: { data: { id: 'b2' } } });
  });

  it('每条记录把这一组的图都铺成缩略图（不用再下载图片包）', async () => {
    renderPage('CS');
    await screen.findByText('上传人：童祥瑞');
    const imgs = screen.getAllByRole('img') as HTMLImageElement[];
    // antd 的大图预览容器也会渲染两张没有 src 的占位 img，这里只看有 src 的缩略图。
    const srcs = imgs.map((el) => el.getAttribute('src')).filter(Boolean);
    expect(srcs).toEqual(SHOT3.images);
  });

  it('缩略图上有「点开放大」的提示，采纳按钮就在旁边', async () => {
    renderPage('CS');
    await screen.findByText('上传人：童祥瑞');
    expect(screen.getAllByText('点开放大').length).toBe(3);
    expect(screen.getByText('采纳并加分')).toBeTruthy();
    // 下载原图包降级成小链接（想存原图才点），文案也改短了
    expect(screen.getByText('下载原图包（3 张）')).toBeTruthy();
  });
});
