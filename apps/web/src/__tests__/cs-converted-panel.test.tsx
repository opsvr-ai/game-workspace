import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { stubApi } from '../test/apiStub';

// 「管理端直添客户流转明细」只用到订单 + 人员两个接口（都是只读拉取）。(2026-10-07)
vi.mock('../api/orders', async () => stubApi(await vi.importActual('../api/orders'), 'ordersApi'));
vi.mock('../api/companions', async () => stubApi(await vi.importActual('../api/companions'), 'companionsApi'));

import CsConvertedPanel from '../components/CsConvertedPanel';

/**
 * 「管理端直添客户流转明细」冒烟（2026-10-07）。
 *
 * 这是客服端最重的一块面板（900 多行），也是「客服跟进台账」被合并进来的那一页 ——
 * 老板原话是「显示的不一样 显得乱七八糟的」。合并之后它必须一次都不白屏，
 * 所以这里把两个接口打桩成空数据，确认「一个客户都没有」时标题、说明和
 * 「暂无客服工作微信」都在，页面是「空」而不是「坏」。
 */
describe('管理端直添客户流转明细冒烟（数据全空，不连后端）', () => {
  it('能渲染出标题与空态，而不是白屏', async () => {
    render(
      <MemoryRouter>
        <CsConvertedPanel />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/管理端直添客户流转明细/)).toBeInTheDocument();
    expect(screen.getByText('暂无客服工作微信')).toBeInTheDocument();
  });
});