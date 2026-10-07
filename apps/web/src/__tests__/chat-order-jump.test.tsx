import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import ChatHeader from '../components/chat/ChatHeader';
import { useAuthStore } from '../stores/authStore';
import { encodeOrderInfo } from '../utils/chatOrder';

/**
 * 「查看订单」点了以后到底跳到哪儿（老板 2026-10-07 报的 bug）。
 *
 * 老板原话：「孙可馨点击聊天框的订单，跳转出来一个对话框，关闭对话框就是订单管理页面，
 * 点击任务栏宋树祥显示的还是订单管理页面，找不到跟宋树祥的聊天内容了。」
 * 根因：独立聊天窗口（一个联系人一个系统窗口）里拿了 react-router 的 navigate 去跳订单管理，
 * 等于把「跟这个人的聊天」整个换成了订单管理页。
 *
 * 这里钉两条：
 *   ① 独立聊天窗口（standalone）里点 → **另开一个订单管理窗口**，本窗口地址一动不动（聊天还在）；
 *   ② 页内浮窗（AppLayout 的 ChatModal，非 standalone）里点 → 照旧原地导航（那是主窗口，应该跳）。
 */

const ORDERS_URL = '/cs/orders?orderId=order-1';

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

describe('聊天框「查看订单」（老板 2026-10-07）', () => {
  it('独立聊天窗口里点：另开订单管理窗口，本窗口还是聊天（不会被导航走）', () => {
    useAuthStore.setState({ user: { role: 'CS', id: 'u1', username: '孙可馨' } as never, isAuthenticated: true });
    const openSpy = vi
      .spyOn(window, 'open')
      .mockImplementation(() => ({ closed: false, location: { href: '' }, focus: () => {} }) as never);

    renderHeader(true);
    fireEvent.click(screen.getByText('查看订单 ›'));

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][0]).toBe(ORDERS_URL);
    // 关键：本窗口没被导航走，聊天窗口还在原地
    expect(screen.getByTestId('loc').textContent).toBe('/chat-window?room=r1&name=宋树祥');
  });

  it('页内浮窗里点：照旧原地跳到订单管理（主窗口，本来就该跳）', () => {
    useAuthStore.setState({ user: { role: 'CS', id: 'u1', username: '孙可馨' } as never, isAuthenticated: true });
    const openSpy = vi.spyOn(window, 'open');

    renderHeader(false);
    fireEvent.click(screen.getByText('查看订单 ›'));

    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('loc').textContent).toBe(ORDERS_URL);
  });

  it('老会话（只有一行文本、不带订单 id）不给点', () => {
    useAuthStore.setState({ user: { role: 'CS', id: 'u1', username: '孙可馨' } as never, isAuthenticated: true });
    render(
      <MemoryRouter initialEntries={['/chat-window?room=r1']}>
        <ChatHeader name="宋树祥" role="CS" userId="u-song" orderInfo="三角洲行动 · ¥35" onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('查看订单 ›')).toBeNull();
  });
});
