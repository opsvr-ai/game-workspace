import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { stubApi } from '../test/apiStub';

// 客户看板只调一个接口（/customers/board），整体打桩成空数据。（2026-10-07）
vi.mock('../api/customers', async () => stubApi(await vi.importActual('../api/customers'), 'customersApi'));

import CustomerBoardPage from '../pages/CustomerBoardPage';

/**
 * 客户看板页面冒烟（2026-10-07）。
 *
 * 这一页是店长 / 老板「一眼看全所有客户」的那张板子，890 行、常年挂在墙上。
 * 它以前没有任何测试 —— 拆它、改它的时候，只有「打开网页看一眼」能发现问题。
 * 这里把接口打桩成空数据，只确认一件事：**没有客户的时候，页面照样画得出来**
 * （标题 + 那几个统计卡都在），不是一片白。
 */
describe('客户看板页面冒烟（数据全空，不连后端）', () => {
  it('能渲染出标题和统计卡，而不是白屏', async () => {
    render(
      <MemoryRouter>
        <CustomerBoardPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/客户看板/).length).toBeGreaterThan(0);
    // 这几个词在页面上出现不止一处（统计卡 + 表格列头），所以只要求「都在」
    expect(await screen.findByText('客户总数')).toBeInTheDocument();
    for (const label of ['正在打', '累计消费', '累计时长']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });
});