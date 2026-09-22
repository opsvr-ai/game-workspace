import { createBrowserRouter, Navigate, useRouteError, isRouteErrorResponse } from 'react-router-dom';
import { Suspense } from 'react';
import { Spin, Button, Result } from 'antd';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';

function RouteErrorBoundary() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);

  if (isRouteErrorResponse(error)) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f5f5' }}>
        <Result
          status={error.status === 404 ? '404' : 'error'}
          title={error.status === 404 ? '页面未找到' : error.statusText}
          subTitle={error.status === 404 ? '请检查URL是否正确' : error.data?.message || '发生了意外错误'}
          extra={
            <Button type="primary" onClick={() => (window.location.href = '/login')}>
              返回登录
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f5f5', padding: 24 }}>
      <Result
        status="error"
        title="应用错误"
        subTitle={message || '发生了意外错误，请刷新页面重试'}
        extra={
          <>
            <Button type="primary" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
            <Button onClick={() => (window.location.href = '/login')}>
              返回登录
            </Button>
            <details style={{ marginTop: 16, textAlign: 'left', maxWidth: 600, overflow: 'auto' }}>
              <summary style={{ cursor: 'pointer', color: '#999', fontSize: 12 }}>错误详情</summary>
              <pre style={{ fontSize: 12, color: '#666', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {message}{'\n\n'}{error instanceof Error ? error.stack : ''}
              </pre>
            </details>
          </>
        }
      />
    </div>
  );
}

import UnifiedDashboard from './pages/admin/UnifiedDashboard';
import CustomersPage from './pages/CustomersPage';
import DispatchPage from './pages/DispatchPage';
import OrdersPage from './pages/OrdersPage';
import BillingOverview from './pages/BillingOverview';
import CompanionsPage from './pages/CompanionsPage';
import CompanionPoolPage from './pages/OrderPoolPage';
import ManagedPcPage from './pages/admin/ManagedPcPage';
import PcControlPage from './pages/admin/PcControlPage';
import AnalyticsPage from './pages/admin/AnalyticsPage';
import PayrollPage from './pages/admin/PayrollPage';
import TrafficAccountPage from './pages/admin/TrafficAccountPage';
import EmployeesPage from './pages/owner/EmployeesPage';
import StudiosPage from './pages/owner/StudiosPage';
import BridgePage from './pages/BridgePage';
import AuthorizationsPage from './pages/owner/AuthorizationsPage';
import ReviewPage from './pages/admin/ReviewPage';
import SettingsPage from './pages/admin/SettingsPage';
import AgentVersionPage from './pages/admin/AgentVersionPage';
import StatsPage from './pages/StatsPage';
import BlacklistPage from './pages/admin/BlacklistPage';
import ProcessKillLogPage from './pages/admin/ProcessKillLogPage';
import WhitelistPage from './pages/admin/WhitelistPage';
import AttendancePage from './pages/admin/AttendancePage';
import ProfileSetupPage from './pages/ProfileSetupPage';
import CompanionPage from './pages/CompanionPage';
import CustomerDetailPage from './pages/CustomerDetailPage';
import ProfilePage from './pages/ProfilePage';
import WorkWechatPage from './pages/WorkWechatPage';
import PriceRulesPage from './pages/finance/PriceRulesPage';
import CommissionPage from './pages/finance/CommissionPage';
import CsCommissionTodayPage from './pages/finance/CsCommissionTodayPage';
import CsSettingsPage from './pages/admin/CsSettingsPage';
import ReconciliationPage from './pages/finance/ReconciliationPage';
import CsWechatFlowPage from './pages/finance/CsWechatFlowPage';
import ProfitCalendarPage from './pages/finance/ProfitCalendarPage';
import CompanionWalletCalendarPage from './pages/finance/CompanionWalletCalendarPage';
import RiskWorkbenchPage from './pages/finance/RiskWorkbenchPage';
import ExpenseReviewPage from './pages/finance/ExpenseReviewPage';
import BattleScreenshotsPage from './pages/BattleScreenshotsPage';
import BattleScreenshotReviewPage from './pages/BattleScreenshotReviewPage';
import ContentCheckPage from './pages/ContentCheckPage';

const SuspenseOutlet = () => (
  <Suspense
    fallback={
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <Spin size="large" />
      </div>
    }
  >
    <AppLayout />
  </Suspense>
);

const SuspenseFallback = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
    <Spin size="large" />
  </div>
);

export const router = createBrowserRouter([
  {
    path: '/login',
    errorElement: <RouteErrorBoundary />,
    element: (
      <Suspense fallback={<SuspenseFallback />}>
        <LoginPage />
      </Suspense>
    ),
  },
  {
    path: '/profile-setup',
    errorElement: <RouteErrorBoundary />,
    element: (
      <Suspense fallback={<SuspenseFallback />}>
        <ProfileSetupPage />
      </Suspense>
    ),
  },
  {
    path: '/companion',
    element: <SuspenseOutlet />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        path: '',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CompanionPage />
          </Suspense>
        ),
      },
      {
        path: 'pool',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CompanionPoolPage />
          </Suspense>
        ),
      },
      {
        path: 'billing',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <BillingOverview />
          </Suspense>
        ),
      },
      {
        path: 'wallet-calendar',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CompanionWalletCalendarPage />
          </Suspense>
        ),
      },
      {
        path: 'customers/:id',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CustomerDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'customers',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CustomersPage />
          </Suspense>
        ),
      },
      {
        path: 'orders',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <OrdersPage />
          </Suspense>
        ),
      },
      {
        path: 'dispatch',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <DispatchPage />
          </Suspense>
        ),
      },
      {
        path: 'companions',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CompanionsPage />
          </Suspense>
        ),
      },
      {
        path: 'stats',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <StatsPage />
          </Suspense>
        ),
      },
      {
        path: 'battle-screenshots',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <BattleScreenshotsPage />
          </Suspense>
        ),
      },
    ],
  },
  {
    path: '/',
    element: <SuspenseOutlet />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        path: 'owner/customers',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CustomersPage />
          </Suspense>
        ),
      },
      {
        path: 'owner/employees',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <EmployeesPage />
          </Suspense>
        ),
      },
      {
        path: 'owner/studios',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <StudiosPage />
          </Suspense>
        ),
      },
      {
        path: 'owner/bridges',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <BridgePage />
          </Suspense>
        ),
      },
      {
        path: 'owner/authorizations',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <AuthorizationsPage />
          </Suspense>
        ),
      },
      {
        path: 'owner/review',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <ReviewPage />
          </Suspense>
        ),
      },
      {
        path: 'owner/settings',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <SettingsPage />
          </Suspense>
        ),
      },
      {
        path: 'owner/agent-version',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <AgentVersionPage />
          </Suspense>
        ),
      },
      {
        path: 'owner/work-wechats',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <WorkWechatPage />
          </Suspense>
        ),
      },
      {
        path: 'owner/cs-wechat-flow',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CsWechatFlowPage />
          </Suspense>
        ),
      },
      {
        path: 'owner/stats',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <StatsPage />
          </Suspense>
        ),
      },
      {
        path: 'owner/orders',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <OrdersPage />
          </Suspense>
        ),
      },
      {
        path: 'admin',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <UnifiedDashboard />
          </Suspense>
        ),
      },
      {
        path: 'admin/dispatch',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <DispatchPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/employees',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <EmployeesPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/companions',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CompanionsPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/battle-screenshots',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <BattleScreenshotReviewPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/customers/:id',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CustomerDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/customers',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CustomersPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/billing',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <BillingOverview />
          </Suspense>
        ),
      },
      {
        path: 'admin/finance/risk',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <RiskWorkbenchPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/finance/reconciliation',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <ReconciliationPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/cs-wechat-flow',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CsWechatFlowPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/profit-calendar',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <ProfitCalendarPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/companion-wallet-calendar',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CompanionWalletCalendarPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/finance/expenses',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <ExpenseReviewPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/finance/commission',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CommissionPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/finance/commission-today',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CsCommissionTodayPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/cs-settings',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CsSettingsPage />
          </Suspense>
        ),
      },
      {
        // 「店长设置」页 2026-09-22 并进「工资规则」（店长 / 客服就是同一张工资表的两行），
        // 老书签/老链接照旧能用，直接落到那一页。
        path: 'admin/store-manager-settings',
        element: <Navigate to="/admin/payroll" replace />,
      },
      {
        path: 'admin/finance/price-rules',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <PriceRulesPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/pc-control',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <PcControlPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/managed-pcs',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <ManagedPcPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/analytics',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <AnalyticsPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/payroll',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <PayrollPage />
          </Suspense>
        ),
      },
      {
        // 「利润分成」页 2026-09-22 合并进「设置 → 系统配置 → 利润分成（分账规则）」，
        // 老书签/老链接照旧能用，直接落到那一页。
        path: 'admin/profit-split',
        element: <Navigate to="/admin/settings?tab=payment" replace />,
      },
      {
        path: 'admin/traffic-accounts',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <TrafficAccountPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/review',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <ReviewPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/orders',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <OrdersPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/traffic',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <DispatchPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/blacklist',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <BlacklistPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/whitelist',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <WhitelistPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/process-kill-log',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <ProcessKillLogPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/attendance',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <AttendancePage />
          </Suspense>
        ),
      },
      {
        path: 'content-check',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <ContentCheckPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/settings',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <SettingsPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/agent-version',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <AgentVersionPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/work-wechats',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <WorkWechatPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/stats',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <StatsPage />
          </Suspense>
        ),
      },
      {
        path: 'cs/billing',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <BillingOverview />
          </Suspense>
        ),
      },
      {
        path: 'cs/finance/risk',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <RiskWorkbenchPage />
          </Suspense>
        ),
      },
      {
        path: 'cs/dispatch',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <DispatchPage />
          </Suspense>
        ),
      },
      {
        path: 'cs/orders',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <OrdersPage />
          </Suspense>
        ),
      },
      {
        path: 'cs/customers/:id',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CustomerDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'cs/customers',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CustomersPage />
          </Suspense>
        ),
      },
      {
        path: 'cs/employees',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CompanionsPage />
          </Suspense>
        ),
      },
      {
        path: 'cs/companions',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <CompanionsPage />
          </Suspense>
        ),
      },
      {
        path: 'cs/work-wechats',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <WorkWechatPage />
          </Suspense>
        ),
      },
      {
        path: 'cs/stats',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <StatsPage />
          </Suspense>
        ),
      },
      {
        path: 'cs/traffic-accounts',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <TrafficAccountPage />
          </Suspense>
        ),
      },
      {
        path: 'profile',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <ProfilePage />
          </Suspense>
        ),
      },
      { path: '', element: <Navigate to="/admin" replace /> },
    ],
  },
]);
