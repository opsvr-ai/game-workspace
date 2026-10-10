import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { stubApi } from '../test/apiStub';

/**
 * 陪玩端「申请补单」按钮（老板 2026-10-08 叫「退单」，2026-10-11 改名）。
 *
 * 老板原话：「管理端要退款就没有用，陪玩端要退款也没用，最多的情况就是添加成功了，客户没转钱
 * 或者转钱了最后不打了，直接让陪玩上传截图就行了，说明原因，说到这里你在陪玩端＋个按钮『退单』，
 * 就是把我上边说的情况 客户同意了 但是没打成 陪玩点退单，客服端审核 无异议到店长这里
 * 跟 添加失败一个流程。」
 * 2026-10-11 老板：「陪玩端 客户订单管理后边的那个退单 改成申请补单」。
 *
 * 所以这里守三件事：
 *   ① 陪玩自己抢的单（还没开始首单）才看得到「申请补单」；
 *   ② 点开必须写原因才能提交（客服 / 店长凭它判断）；
 *   ③ 提交走的是 **退单申请** 接口（不是直接退款）—— 钱的事得客服核对、店长拍板。
 */

// 类型上要能接参数（下面的 mockImplementation 会按 url 分派），返回值统一放宽成 any ——
// 这个桩只管「请求别真发出去」，具体返回什么由每个用例自己定。
const { httpMock } = vi.hoisted(() => ({
  httpMock: {
    get: vi.fn((..._args: any[]): Promise<any> => Promise.resolve({ data: { data: { items: [] } } })),
    post: vi.fn((..._args: any[]): Promise<any> => Promise.resolve({ data: { data: { url: 'https://img/1.png' } } })),
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

const MY_ORDER = {
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
};

/**
 * 按 URL 分派：订单列表给这一单；`/companions`（下拉筛选用）给空数组 ——
 * 页面里是 `setCompanions(data.data || [])`，给个对象它就直接崩（.map 不是函数）。
 */
function mockHttp(items: any[]) {
  httpMock.get.mockImplementation(async (url: string) => {
    if (url === '/companions') return { data: { data: [] } };
    if (url === '/orders') return { data: { data: { items } } };
    return { data: { data: null } };
  });
}

/**
 * 找「申请补单」按钮：antd 只对两个汉字的按钮插空格，四个字的不会 ——
 * 这里按正则取、并且只认**整个按钮名字就是申请补单**的（别把「提交补单申请」也算进来）。
 */
const refundBtn = () => screen.queryByRole('button', { name: /^申请补单$/ });

function renderPage() {
  return render(
    <MemoryRouter>
      <OrdersPage />
    </MemoryRouter>,
  );
}

describe('陪玩端「申请补单」按钮（老板 2026-10-08 叫退单 / 2026-10-11 改名）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { role: 'COMPANION', id: 'u1', companionId: 'c1', username: '张三' } as never,
      isAuthenticated: true,
    });
    mockHttp([MY_ORDER]);
    vi.mocked(ordersApi.list).mockResolvedValue({ data: { data: [MY_ORDER] } } as never);
    vi.mocked(ordersApi.requestRefund).mockResolvedValue({ data: { data: { id: 'sr9' } } } as never);
  });

  it('自己抢的单（还没开始首单）→ 看得到「申请补单」', async () => {
    renderPage();
    await waitFor(() => expect(refundBtn()).toBeTruthy());
  });

  it('已经点过「开始首单」的单 → 不给「申请补单」（那种单没打成要走「报结果」）', async () => {
    mockHttp([{ ...MY_ORDER, sessions: [{ id: 'se1', startedAt: '2026-10-08T04:00:00.000Z' }] }]);
    renderPage();
    await waitFor(() => expect(screen.getByText('A100')).toBeInTheDocument());
    expect(refundBtn()).not.toBeTruthy();
  });

  it('点「申请补单」→ 弹窗；没写原因不能提交；写了原因提交走「补单申请」接口', async () => {
    renderPage();
    await waitFor(() => expect(refundBtn()).toBeTruthy());
    fireEvent.click(refundBtn() as HTMLElement);
    // 弹窗正文（标题「申请补单」跟按钮同名，用正文那句话定位，免得 findByText 撞上多个）
    expect(await screen.findByText(/就提交补单申请/)).toBeInTheDocument();

    // 先不写原因直接提交 → 不调接口
    fireEvent.click(screen.getByRole('button', { name: '提交补单申请' }));
    await waitFor(() => expect(ordersApi.requestRefund).not.toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText(/写清楚为什么没打成/), {
      target: { value: '客户同意了口头上，但一直没转钱' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交补单申请' }));
    await waitFor(() =>
      expect(ordersApi.requestRefund).toHaveBeenCalledWith(
        'o1',
        '客户同意了口头上，但一直没转钱',
        undefined,
      ),
    );
  });
});
