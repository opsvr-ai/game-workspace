import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { stubApi } from '../test/apiStub';

// 抢单池要的四个接口全部打桩：只验「页面能不能打开」，不验数据。（2026-10-07）
vi.mock('../api/orders', async () => stubApi(await vi.importActual('../api/orders'), 'ordersApi'));
vi.mock('../api/companions', async () => stubApi(await vi.importActual('../api/companions'), 'companionsApi'));
vi.mock('../api/config', async () => stubApi(await vi.importActual('../api/config'), 'configApi'));
vi.mock('../api/chat', async () => stubApi(await vi.importActual('../api/chat'), 'chatApi'));
import OrderPoolPage from '../pages/OrderPoolPage';

/**
 * 抢单池页面冒烟（2026-10-07）。
 *
 * 这一页是陪玩每天要盯的主战场，也是「抢单」主链路的入口。它以前没有任何测试，
 * 而它自己就 900 多行 —— 拆它、改它的时候，只有「打开网页看一眼」能发现问题。
 * 这里把四个接口全部打桩成「空数据」，只确认一件事：
 * **接口都说没有单的时候，页面照样画得出来，而且明确告诉人「暂时没有」，不是一片白。**
 */
describe('抢单池页面冒烟（数据全空，不连后端）', () => {
  it('能渲染出标题，并且给的是「暂无」提示而不是白屏', async () => {
    render(
      <MemoryRouter>
        <OrderPoolPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/订单池/).length).toBeGreaterThan(0);
    expect(await screen.findByText(/暂无待派订单|暂时没有可抢的新单/)).toBeInTheDocument();
  });
});
