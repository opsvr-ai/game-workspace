import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import ChatHeader from '../components/chat/ChatHeader';
import { useAuthStore } from '../stores/authStore';
import { encodeOrderInfo } from '../utils/chatOrder';
import { installWindowNavListener, navigateOpenerWindow } from '../utils/windowNav';

/**
 * 「查看订单」点了以后到底跳到哪儿。
 *
 * 老板 2026-10-07：「孙可馨点击聊天框的订单，跳转出来一个对话框，关闭对话框就是订单管理页面，
 * 点击任务栏宋树祥显示的还是订单管理页面，找不到跟宋树祥的聊天内容了」——
 * 根因：独立聊天窗口（一个联系人一个系统窗口）里拿 react-router 的 navigate 去跳订单管理，
 * 等于把「跟这个人的聊天」整个换成了订单管理页。
 * 当时的做法是**另开一个订单管理窗口**；老板 2026-10-08 又问：
 * 「直接跳到订单管理不行？为啥还得搞窗口？」—— 于是改成**让主程序窗口去跳**：
 *   ① 独立聊天窗口里点 → 本窗口一动不动（聊天还在），也不开新窗口；
 *      浏览器里 window.open 出来的聊天窗口 → 直接指挥 window.opener；
 *      独立系统窗口（没有 opener）→ 走 utils/windowNav.ts 的跨窗口通道；
 *   ② 页内浮窗（AppLayout 的 ChatModal，非 standalone）里点 → 照旧原地导航（那是主窗口，本来就该跳）；
 *   ③ 主程序窗口不在（没人应答）→ 不发新窗口（那会儿没手势了，一定被拦），只提示去任务栏打开主程序。
 */

const ORDERS_URL = '/cs/orders?orderId=order-1';

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));

vi.mock('../utils/feedback', async () => {
  const actual = (await vi.importActual('../utils/feedback')) as Record<string, unknown>;
  return {
    ...actual,
    message: {
      ...(actual.message as Record<string, unknown>),
      warning: warnSpy,
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
  };
});

const LocationProbe = () => {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
};

function renderHeader(standalone: boolean) {
  return render(
    <MemoryRouter initialEntries={['/chat-window?room=r1&name=宋树祥']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <ChatHeader
                name="宋树祥"
                role="CS"
                userId="u-song"
                orderInfo={encodeOrderInfo('单号 250 · 三角洲行动 · ¥35', 'order-1')}
                standalone={standalone}
                onClose={() => {}}
              />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** 模拟一次「跨窗口的 storage 事件」（jsdom 里同一份文档写 localStorage 不会触发，只能自己发）。 */
function fireStorage(key: string, newValue: string) {
  const ev = new Event('storage') as StorageEvent;
  Object.defineProperty(ev, 'key', { value: key });
  Object.defineProperty(ev, 'newValue', { value: newValue });
  window.dispatchEvent(ev);
}

/** 假装「主程序窗口在线」：看到「请跳这个地址」就立刻回一个 ack，并把请求的地址记下来。 */
function fakeMainWindow() {
  const seen: string[] = [];
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(((key: string, value: string) => {
    if (key !== 'chunlv:window-nav') return;
    const msg = JSON.parse(value) as { id: string; url: string };
    seen.push(msg.url);
    window.setTimeout(() => fireStorage('chunlv:window-nav-ack', JSON.stringify({ id: msg.id })), 0);
  }) as never);
  return { seen };
}

describe('聊天框「查看订单」（老板 2026-10-07 / 2026-10-08）', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { role: 'CS', id: 'u1', username: '孙可馨' } as never, isAuthenticated: true });
    warnSpy.mockClear();
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
  });

  it('独立聊天窗口里点：只请主程序窗口去跳 —— 不开新窗口、本窗口还是聊天', async () => {
    const openSpy = vi.spyOn(window, 'open');
    const main = fakeMainWindow();

    renderHeader(true);
    fireEvent.click(screen.getByText('查看订单 ›'));

    expect(openSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(main.seen).toEqual([ORDERS_URL]));
    // 关键：本窗口没被导航走，聊天窗口还在原地
    expect(screen.getByTestId('loc').textContent).toBe('/chat-window?room=r1&name=宋树祥');
  });

  it('浏览器里 window.open 出来的聊天窗口：直接让开着它的那个窗口跳（同步，不会被弹窗拦）', () => {
    const opener = { closed: false, location: { href: '' }, focus: vi.fn() };
    Object.defineProperty(window, 'opener', { value: opener, configurable: true });

    renderHeader(true);
    fireEvent.click(screen.getByText('查看订单 ›'));

    expect(opener.location.href).toBe(ORDERS_URL);
    expect(opener.focus).toHaveBeenCalled();
    expect(screen.getByTestId('loc').textContent).toBe('/chat-window?room=r1&name=宋树祥');
  });

  it('主程序窗口没人应答 → 不开新窗口，只提示「先从任务栏打开主程序」', async () => {
    const openSpy = vi.spyOn(window, 'open');

    renderHeader(true);
    fireEvent.click(screen.getByText('查看订单 ›'));

    expect(openSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(warnSpy).toHaveBeenCalled(), { timeout: 3000 });
    expect(String(warnSpy.mock.calls[0][0])).toContain('主程序');
    expect(screen.getByTestId('loc').textContent).toBe('/chat-window?room=r1&name=宋树祥');
  });

  it('页内浮窗里点：照旧原地跳到订单管理（那就是主窗口，本来就该跳）', () => {
    const openSpy = vi.spyOn(window, 'open');

    renderHeader(false);
    fireEvent.click(screen.getByText('查看订单 ›'));

    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('loc').textContent).toBe(ORDERS_URL);
  });

  it('老会话（只有一行文本、不带订单 id）不给点', () => {
    render(
      <MemoryRouter initialEntries={['/chat-window?room=r1']}>
        <ChatHeader name="宋树祥" role="CS" userId="u-song" orderInfo="三角洲行动 · ¥35" onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('查看订单 ›')).toBeNull();
  });
});

describe('跨窗口通道（utils/windowNav.ts）', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
  });

  it('主程序窗口这一侧：收到「请跳」→ 跳到那个地址 + 回一个 ack；取消订阅后不再响应', () => {
    const navigate = vi.fn();
    const setSpy = vi.spyOn(Storage.prototype, 'setItem');

    const off = installWindowNavListener(navigate);
    fireStorage('chunlv:window-nav', JSON.stringify({ id: 'abc', url: ORDERS_URL }));

    expect(navigate).toHaveBeenCalledWith(ORDERS_URL);
    expect(setSpy.mock.calls.some((c) => c[0] === 'chunlv:window-nav-ack')).toBe(true);

    off();
    navigate.mockClear();
    fireStorage('chunlv:window-nav', JSON.stringify({ id: 'def', url: '/companion/orders' }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('不是我们写的消息（坏 JSON / 少了地址）直接忽略，不炸', () => {
    const navigate = vi.fn();
    const off = installWindowNavListener(navigate);

    fireStorage('chunlv:window-nav', '{不是 JSON');
    fireStorage('chunlv:window-nav', JSON.stringify({ id: 'x' }));
    fireStorage('别的键', JSON.stringify({ id: 'y', url: ORDERS_URL }));
    expect(navigate).not.toHaveBeenCalled();

    off();
  });

  it('navigateOpenerWindow：没有 opener（独立系统窗口）老实返回 false', () => {
    expect(navigateOpenerWindow(ORDERS_URL)).toBe(false);
  });
});