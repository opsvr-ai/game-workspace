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
 *      点订单（或整行）要跳到订单管理里那一单（整行高亮 + 自动打开详情；这一条是明确要详情的入口，
 *      地址里多带一个 `detail=1` —— 聊天框顶上那个「查看订单」不带，2026-10-09 起只标阴影）；
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
const CS_USER = { role: 'CS', id: 'cs-1', username: '客服甲' };

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
      expect(screen.getByTestId('loc').textContent).toBe('/admin/orders?orderId=o1&detail=1'),
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

  it('「退单」在客服那一格是「无异议，转店长」—— 点它调 CS_PASS，不直接批', async () => {
    useAuthStore.setState({ user: CS_USER as never, isAuthenticated: true });
    vi.mocked(ordersApi.supplementSummary).mockResolvedValue({
      data: { data: { pending: 1, due: 0, approvedToday: 0 } },
    } as never);
    vi.mocked(ordersApi.listSupplements).mockResolvedValue({
      data: {
        data: [
          {
            id: 'sr9',
            type: 'REFUND',
            orderId: 'o9',
            companionId: 'c1',
            companionName: '张三',
            reason: '客户同意了，最后没打成',
            status: 'PENDING',
            csReviewedAt: null,
            order: { id: 'o9', orderCode: 'A900', gameName: '三角洲行动', contactStatus: 'added' },
          },
        ],
      },
    } as never);
    vi.mocked(ordersApi.decideSupplement).mockResolvedValue({ data: { data: {} } } as never);

    renderButton();
    fireEvent.click(screen.getByText('🧾 补单审核'));

    expect(await screen.findByText('退单')).toBeInTheDocument();
    expect(screen.getByText('待客服核对')).toBeInTheDocument();
    expect(screen.queryByText('同意退单')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '无异议，转店长' }));
    await waitFor(() => expect(ordersApi.decideSupplement).toHaveBeenCalledWith('sr9', 'CS_PASS'));
  });

  it('店长那一格才是「同意退单」—— 点它调 APPROVE（同意 = 这单退掉 + 名额 +1）', async () => {
    useAuthStore.setState({ user: ADMIN_USER as never, isAuthenticated: true });
    vi.mocked(ordersApi.supplementSummary).mockResolvedValue({
      data: { data: { pending: 1, due: 0, approvedToday: 0 } },
    } as never);
    vi.mocked(ordersApi.listSupplements).mockResolvedValue({
      data: {
        data: [
          {
            id: 'sr9',
            type: 'REFUND',
            orderId: 'o9',
            companionId: 'c1',
            companionName: '张三',
            reason: '客户同意了，最后没打成',
            status: 'PENDING',
            csReviewedAt: '2026-10-08T05:00:00.000Z',
            order: { id: 'o9', orderCode: 'A900', gameName: '三角洲行动', contactStatus: 'added' },
          },
        ],
      },
    } as never);
    vi.mocked(ordersApi.decideSupplement).mockResolvedValue({ data: { data: {} } } as never);

    renderButton();
    fireEvent.click(screen.getByText('🧾 补单审核'));

    expect(await screen.findByText('待店长拍板')).toBeInTheDocument();
    expect(screen.queryByText('无异议，转店长')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '同意退单' }));
    await waitFor(() => expect(ordersApi.decideSupplement).toHaveBeenCalledWith('sr9', 'APPROVE'));
  });
});
