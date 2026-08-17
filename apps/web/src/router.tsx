import { createBrowserRouter, Navigate, useRouteError, isRouteErrorResponse } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { Spin, Button, Result } from 'antd';
import AppLayout from './layouts/AppLayout';

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

const LoginPage = lazy(() => import('./pages/LoginPage'));
const UnifiedDashboard = lazy(() => import('./pages/admin/UnifiedDashboard'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const DispatchPage = lazy(() => import('./pages/DispatchPage'));
const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage'));
const BillingOverview = lazy(() => import('./pages/BillingOverview'));
const CompanionsPage = lazy(() => import('./pages/CompanionsPage'));
const CompanionPoolPage = lazy(() => import('./pages/OrderPoolPage'));
const AdminPcControlPage = lazy(() => import('./pages/admin/PcControlPage'));
const ManagedPcPage = lazy(() => import('./pages/admin/ManagedPcPage'));
const EmployeesPage = lazy(() => import('./pages/owner/EmployeesPage'));
const StudiosPage = lazy(() => import('./pages/owner/StudiosPage'));
const BridgePage = lazy(() => import('./pages/BridgePage'));
const AuthorizationsPage = lazy(() => import('./pages/owner/AuthorizationsPage'));
const ReviewPage = lazy(() => import('./pages/admin/ReviewPage'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const AgentVersionPage = lazy(() => import('./pages/admin/AgentVersionPage'));
const StatsPage = lazy(() => import('./pages/StatsPage'));
const BlacklistPage = lazy(() => import('./pages/admin/BlacklistPage'));
const ProcessKillLogPage = lazy(() => import('./pages/admin/ProcessKillLogPage'));
const WhitelistPage = lazy(() => import('./pages/admin/WhitelistPage'));
const AttendancePage = lazy(() => import('./pages/admin/AttendancePage'));
const ProfileSetupPage = lazy(() => import('./pages/ProfileSetupPage'));
const CompanionPage = lazy(() => import('./pages/CompanionPage'));
const CustomerDetailPage = lazy(() => import('./pages/CustomerDetailPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const WorkWechatPage = lazy(() => import('./pages/WorkWechatPage'));
const PriceRulesPage = lazy(() => import('./pages/finance/PriceRulesPage'));
const CommissionPage = lazy(() => import('./pages/finance/CommissionPage'));
const SettlementPage = lazy(() => import('./pages/finance/SettlementPage'));
const ReconciliationPage = lazy(() => import('./pages/finance/ReconciliationPage'));
const RiskWorkbenchPage = lazy(() => import('./pages/finance/RiskWorkbenchPage'));
const ExpenseReviewPage = lazy(() => import('./pages/finance/ExpenseReviewPage'));

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
        path: 'orders/:id',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <OrderDetailPage />
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
        path: 'owner/orders/:id',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <OrderDetailPage />
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
        path: 'admin/finance/expenses',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <ExpenseReviewPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/finance/settlement',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <SettlementPage />
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
            <AdminPcControlPage />
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
        path: 'admin/orders/:id',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <OrderDetailPage />
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
        path: 'cs/finance/reconciliation',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <ReconciliationPage />
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
        path: 'cs/orders/:id',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <OrderDetailPage />
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
