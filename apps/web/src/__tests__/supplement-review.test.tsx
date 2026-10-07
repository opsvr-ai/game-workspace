import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { stubApi } from '../test/apiStub';

// 补单审核弹窗要用的接口全部打桩（只验界面行为，不连后端）
vi.mock('../api/orders', async () => stubApi(await vi.importActual('../api/orders'), 'ordersApi'));

import SupplementReviewButton from '../components/SupplementReviewButton';
import { ordersApi } from '../api/orders';
import { useAuthStore } from '../stores/authStore';

/**
 * 「补单审核 / 到期核查」弹窗（老板 2026-10-08）。
 *
 * 老板报的两件事：
 *   ① 「第一张图这个界面，给我直接跳转到订单管理的该订单，方便客服查看」——
 *      点订单（或整行）要跳到订单管理里那一单（整行高亮 + 自动打开详情）；
 *   ② 管理端订单管理里的「退款」改成「补单」之后，得能看清今天到底给谁补过名额 ——
 *      所以弹窗多了「补单记录」页签，并显示今日补单数。
 */

const LocationProbe = () => {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
};

function renderButton() {
  return render(
    <MemoryRouter initialEntries={['/admin/orders']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SupplementReviewButton />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const ADMIN_USER = { role: 'ADMIN', id: 'admin-1', username: '店长甲' };

describe('补单审核 / 到期核查弹窗', () => {
  it('三个页签带上真实数字；点订单直接跳到订单管理的那一单', async () => {
    useAuthStore.setState({ user: ADMIN_USER as never, isAuthenticated: true });
    vi.mocked(ordersApi.supplementSummary).mockResolvedValue({
      data: { data: { pending: 2, due: 4, approvedToday: 1 } },
    } as never);
    vi.mocked(ordersApi.listSupplements).mockResolvedValue({
      data: {
        data: [
          {
            id: 'sr1',
            orderId: 'o1',
            companionId: 'c1',
            companionName: '张三',
            reason: 'not_added',
            status: 'PENDING',
            order: { id: 'o1', orderCode: 'A100', gameName: '三角洲行动' },
          },
        ],
      },
    } as never);

    renderButton();

    fireEvent.click(screen.getByText('🧾 补单审核'));
    expect(await screen.findByText('待审核（2）')).toBeInTheDocument();
    expect(screen.getByText('到期核查（4）')).toBeInTheDocument();
    expect(screen.getByText('补单记录（今日 1）')).toBeInTheDocument();

    fireEvent.click(await screen.findByText('A100'));
    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe('/admin/orders?orderId=o1'),
    );
  });

  it('「补单记录」页签：给谁补过名额、谁批的，一眼看得到', async () => {
    useAuthStore.setState({ user: ADMIN_USER as never, isAuthenticated: true });
    vi.mocked(ordersApi.supplementSummary).mockResolvedValue({
      data: { data: { pending: 0, due: 0, approvedToday: 1 } },
    } as never);
    vi.mocked(ordersApi.listSupplements).mockResolvedValue({
      data: {
        data: [
          {
            id: 'sr2',
            orderId: 'o2',
            companionId: 'c2',
            companionName: '钱鸿鸣',
            reason: '【管理端补单】客户临时改时间',
            status: 'APPROVED',
            decidedByUserId: 'admin-1',
            decidedByName: '店长甲',
            byAdmin: true,
            decidedAt: '2026-10-08T05:20:00.000Z',
            order: { id: 'o2', orderCode: 'A200', gameName: '三角洲行动' },
          },
        ],
      },
    } as never);

    renderButton();

    fireEvent.click(screen.getByText('🧾 补单审核'));
    fireEvent.click(await screen.findByText('补单记录（今日 1）'));

    expect(await screen.findByText('管理端补单')).toBeInTheDocument();
    expect(screen.getByText('店长甲')).toBeInTheDocument();
    expect(screen.getByText('客户临时改时间')).toBeInTheDocument();
    expect(screen.getByText('钱鸿鸣')).toBeInTheDocument();
  });
});
