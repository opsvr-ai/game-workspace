import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { stubApi } from '../test/apiStub';

/**
 * 「从聊天框点『查看订单』跳过来」到底是什么行为（老板 2026-10-09）。
 *
 * 老板原话：「为什么刚才童祥瑞给邵泽慧通过订单后的沟通发的消息，邵泽慧点看聊天框顶部的
 * 查看订单详情 还是弹窗？不是让你直接跳转到订单管理并且标阴影么」。
 *
 * 上一轮（网页 v992）只去掉了「另开一个订单管理窗口」；跳过来之后 OrdersPage 还会**自动把
 * 「订单详情」弹窗打开** —— 老板看到的就是那个「弹窗」。所以这里钉两条：
 *   ① 普通跳过来（聊天框顶上那行）→ **只高亮那一行，不弹详情**；
 *   ② 带 detail=1 的入口（补单审核里点订单，那边点进去就是要看详情）→ 照旧自动打开详情。
 */

const { state } = vi.hoisted(() => ({
  state: { orders: [] as any[] },
}));

const ORDER = {
  id: 'o1',
  orderCode: 'A100',
  status: 'GRABBED',
  gameName: '三角洲行动',
  amount: 35,
  duration: 2,
};

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(async (url: string) => {
      if (String(url).includes('/orders')) return { data: { data: { items: state.orders } } };
      return { data: { data: null } };
    }),
    post: vi.fn(async () => ({ data: { data: null } })),
    put: vi.fn(async () => ({ data: { data: null } })),
    delete: vi.fn(async () => ({ data: { data: null } })),
  },
}));
vi.mock('../api/orders', async () => stubApi(await vi.importActual('../api/orders'), 'ordersApi'));
vi.mock('../api/companions', async () => stubApi(await vi.importActual('../api/companions'), 'companionsApi'));
vi.mock('../api/trafficAccount', async () => stubApi(await vi.importActual('../api/trafficAccount'), 'trafficAccountApi'));
vi.mock('../api/finance', async () => stubApi(await vi.importActual('../api/finance'), 'financeApi'));

import OrdersPage from '../pages/OrdersPage';
import { ordersApi } from '../api/orders';
import { useAuthStore } from '../stores/authStore';

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <OrdersPage />
    </MemoryRouter>,
  );
}

describe('订单管理「跳过来」的落点（老板 2026-10-09）', () => {
  beforeEach(() => {
    state.orders = [ORDER];
    // 真跑起来 /orders/:id 一定返回那一单（这里故意也让它返回 —— 旧代码就是靠这条退路
    // 把详情弹窗弹出来的，不这么桩测试就抓不到那个 bug）。
    vi.mocked(ordersApi.getOrder).mockClear();
    vi.mocked(ordersApi.getOrder).mockResolvedValue({ data: { data: ORDER } } as never);
    useAuthStore.setState({
      user: { role: 'COMPANION', id: 'u1', username: '邵泽慧', companionId: 'companion-1' } as never,
      isAuthenticated: true,
    });
  });

  it('聊天框顶上跳过来：只把那一行标成高亮，不自动弹「订单详情」', async () => {
    renderAt('/companion/orders?orderId=o1');

    await waitFor(() => expect(document.querySelector('tr.row-jump-focus')).toBeTruthy());
    // 列表里本来就有这一单 → 走高亮这条路，连「单独取一单」都不该调
    expect(ordersApi.getOrder).not.toHaveBeenCalled();
    expect(screen.queryByText(/订单详情 · A100/)).toBeNull();
  });

  it('带 detail=1 的入口（补单审核点订单）：照旧自动打开详情', async () => {
    renderAt('/companion/orders?orderId=o1&detail=1');

    expect(await screen.findByText(/订单详情 · A100/)).toBeTruthy();
    expect(ordersApi.getOrder).not.toHaveBeenCalled();
  });

  it('那一单不在当前筛选里（列表里没有）：退回打开详情，不能跳过来一片空白', async () => {
    state.orders = [];

    renderAt('/companion/orders?orderId=o1');

    await waitFor(() => expect(ordersApi.getOrder).toHaveBeenCalledWith('o1'));
    expect(await screen.findByText(/订单详情 · A100/)).toBeTruthy();
  });
});
