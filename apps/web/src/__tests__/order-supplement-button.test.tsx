import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { stubApi } from '../test/apiStub';

/**
 * 管理端订单管理那一格「补单」（老板 2026-10-08）。
 *
 * 老板原话：「客服 / 店长那条直接『退款』的口子……：删除，改成补单，以后陪玩申请补单在对应订单
 * 后边的补单按钮做提示，点了补单要跟其他功能联动起来，补完的显示已补」。
 *
 * 所以这里守四件事：
 *   ① 客服 / 店长 / 老板那一格是「补单」，**再没有「退款」**；
 *   ② 陪玩已经提交补单申请的 → 按钮变主色（加红点提示），弹窗里能看到他写的原因；
 *   ③ 已经补过的 → 显示「已补」，不给再点（同一张单不能补两次名额）；
 *   ④ 点「补单」走的是补单接口（名额 +1 + 留记录 + 通知陪玩），不是直接退款。
 */

const { httpMock } = vi.hoisted(() => ({
  httpMock: {
    get: vi.fn((..._args: any[]): Promise<any> => Promise.resolve({ data: { data: { items: [] } } })),
    post: vi.fn((..._args: any[]): Promise<any> => Promise.resolve({ data: { data: null } })),
    put: vi.fn((..._args: any[]): Promise<any> => Promise.resolve({ data: { data: null } })),
    delete: vi.fn((..._args: any[]): Promise<any> => Promise.resolve({ data: { data: null } })),
  },
}));
vi.mock('../api/client', () => ({ default: httpMock }));
vi.mock('../api/orders', async () => stubApi(await vi.importActual('../api/orders'), 'ordersApi'));
vi.mock('../api/companions', async () => stubApi(await vi.importActual('../api/companions'), 'companionsApi'));
vi.mock('../api/config', async () => stubApi(await vi.importActual('../api/config'), 'configApi'));
vi.mock('../api/chat', async () => stubApi(await vi.importActual('../api/chat'), 'chatApi'));

import OrdersPage from '../pages/OrdersPage';
import { ordersApi } from '../api/orders';
import { useAuthStore } from '../stores/authStore';

const ORDER = {
  id: 'o1',
  orderCode: 'A100',
  gameName: '三角洲行动',
  status: 'GRABBED',
  companionId: 'c1',
  studioId: 's1',
  duration: 1,
  amount: 35,
  contactStatus: 'added',
  customFields: {},
  sessions: [],
  csUser: null,
  companion: { id: 'c1', user: { id: 'u-c1', username: 'zhangsan', displayName: '张三' } },
};

function mockHttp(items: any[]) {
  httpMock.get.mockImplementation(async (url: string) => {
    if (url === '/companions') return { data: { data: [] } };
    if (url === '/orders') return { data: { data: { items } } };
    if (url === '/orders/supplements/summary') return { data: { data: { pending: 0, due: 0, approvedToday: 0 } } };
    return { data: { data: null } };
  });
}

/** antd 会给两个汉字的按钮中间插一个空格（无障碍名字是「补 单」）。 */
const supplementBtn = () => screen.queryByRole('button', { name: /^补\s*单$/ });
const refundBtn = () => screen.queryByRole('button', { name: /^退\s*款$/ });

function renderPage() {
  return render(
    <MemoryRouter>
      <OrdersPage />
    </MemoryRouter>,
  );
}

describe('管理端订单管理那一格「补单」（老板 2026-10-08）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { role: 'CS', id: 'cs-1', studioId: 's1', username: '客服01' } as never,
      isAuthenticated: true,
    });
    mockHttp([ORDER]);
    vi.mocked(ordersApi.supplementOrder).mockResolvedValue({ data: { data: { id: 'sr1' } } } as never);
  });

  it('客服看到的也是「补单」，不再有「退款」', async () => {
    renderPage();
    await waitFor(() => expect(supplementBtn()).toBeTruthy());
    expect(refundBtn()).not.toBeTruthy();
  });

  it('陪玩已经提交补单申请 → 按钮变主色（红点提示），弹窗里能看到他写的原因', async () => {
    mockHttp([
      {
        ...ORDER,
        supplementPending: true,
        supplementApproved: false,
        supplementPendingRequest: { id: 'sr9', reason: '客户一直没通过好友', evidenceUrl: null },
      },
    ]);
    renderPage();
    await waitFor(() => expect(supplementBtn()).toBeTruthy());
    // 待补单：按钮是主色（提示「这里有事要办」）
    expect((supplementBtn() as HTMLElement).className).toContain('ant-btn-primary');

    fireEvent.click(supplementBtn() as HTMLElement);
    expect(await screen.findByText(/客户一直没通过好友/)).toBeInTheDocument();
  });

  it('待补单的单：原因可以不写，直接「同意补单」也走补单接口', async () => {
    mockHttp([
      {
        ...ORDER,
        supplementPending: true,
        supplementPendingRequest: { id: 'sr9', reason: '客户一直没通过好友', evidenceUrl: null },
      },
    ]);
    renderPage();
    await waitFor(() => expect(supplementBtn()).toBeTruthy());
    fireEvent.click(supplementBtn() as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: '同意补单' }));
    await waitFor(() => expect(ordersApi.supplementOrder).toHaveBeenCalledWith('o1', undefined));
  });

  it('没申请的单：必须写原因才能补单', async () => {
    renderPage();
    await waitFor(() => expect(supplementBtn()).toBeTruthy());
    fireEvent.click(supplementBtn() as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: '确认补单' }));
    await waitFor(() => expect(ordersApi.supplementOrder).not.toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText(/客户临时改时间/), {
      target: { value: '客户临时改时间' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认补单' }));
    await waitFor(() => expect(ordersApi.supplementOrder).toHaveBeenCalledWith('o1', '客户临时改时间'));
  });

  it('已经补过的单 → 显示「已补」，不给再点', async () => {
    mockHttp([{ ...ORDER, supplementApproved: true }]);
    renderPage();
    await waitFor(() => expect(screen.getByText('A100')).toBeInTheDocument());
    expect(screen.getByText('已补')).toBeInTheDocument();
    expect(supplementBtn()).not.toBeTruthy();
  });
});
