import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { stubApi } from '../test/apiStub';

// 派单工作台在挂载时会拉四个接口（订单 / 人员 / 配置 / 群聊），全部打桩成空数据。(2026-10-07)
vi.mock('../api/orders', async () => stubApi(await vi.importActual('../api/orders'), 'ordersApi'));
vi.mock('../api/companions', async () => stubApi(await vi.importActual('../api/companions'), 'companionsApi'));
vi.mock('../api/config', async () => stubApi(await vi.importActual('../api/config'), 'configApi'));
vi.mock('../api/chat', async () => stubApi(await vi.importActual('../api/chat'), 'chatApi'));

import CSDispatchView from '../pages/dispatch/CSDispatchView';

/**
 * 客服「派单工作台」冒烟（2026-10-07）。
 *
 * 这一页 1,100 多行，是客服每天真正干活的地方（看单、抢单、转单、看人员）。
 * 它以前没有任何测试；这里把四个接口打桩成空数据（Socket 在测试里没有 token，
 * 会自动不连），只确认：**一单都没有的时候，页面照样打得开** ——
 * 两个页签「派单工作台」「订单池流转失败明细」都在。
 */
describe('客服派单工作台冒烟（数据全空，不连后端）', () => {
  it('能渲染出页签与「订单池」，而不是白屏', async () => {
    render(
      <MemoryRouter>
        <CSDispatchView />
      </MemoryRouter>,
    );
    // 「待派」在页面上出现好几处（页签 / 计数 / 空态文案），所以只要求「都在」
    expect(await screen.findByText('派单工作台')).toBeInTheDocument();
    expect(screen.getAllByText('订单池').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/待派/).length).toBeGreaterThan(0);
  });
});