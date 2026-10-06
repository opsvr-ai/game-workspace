import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * 把某个 api 模块的**每一个方法**都打桩成「返回空数据」。
 * 手写方法名容易漏（第一版就漏了 configApi.get，页面直接崩）—— 这里按真实模块的 key 生成，
 * 以后接口加了新方法也不用改测试。
 */
function stubModule(name: 'orders' | 'companions' | 'config' | 'chat') {
  return async () => {
    const actual = await vi.importActual<Record<string, Record<string, unknown>>>(`../api/${name}`);
    const key = `${name}Api`;
    const stubbed = Object.fromEntries(
      Object.keys(actual[key]).map((k) => [k, vi.fn(async () => ({ data: { data: null } }))]),
    );
    return { ...actual, [key]: stubbed };
  };
}

// 抢单池要的四个接口全部打桩：只验「页面能不能打开」，不验数据。（2026-10-07）
vi.mock('../api/orders', stubModule('orders'));
vi.mock('../api/companions', stubModule('companions'));
vi.mock('../api/config', stubModule('config'));
vi.mock('../api/chat', stubModule('chat'));
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
