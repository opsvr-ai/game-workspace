import { createBrowserRouter, Navigate, useRouteError, isRouteErrorResponse } from 'react-router-dom';
import { Suspense, type ReactNode } from 'react';
import { Spin, Button, Result } from 'antd';
import { BG, TEXT } from './styles/tokens';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import ChatWindowPage from './pages/ChatWindowPage';

function RouteErrorBoundary() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);

  if (isRouteErrorResponse(error)) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: BG.base }}>
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
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: BG.base, padding: 24 }}>
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
              <summary style={{ cursor: 'pointer', color: TEXT.tertiary, fontSize: 12 }}>错误详情</summary>
              <pre style={{ fontSize: 12, color: TEXT.secondary, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
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
import OperationsBoard from './pages/admin/OperationsBoard';
import LiveBoardPage from './pages/admin/LiveBoardPage';
import CustomerBoardPage from './pages/CustomerBoardPage';
import CustomersPage from './pages/CustomersPage';
import DispatchPage from './pages/DispatchPage';
import OrdersPage from './pages/OrdersPage';
import BillingOverview from './pages/BillingOverview';
import CompanionsPage from './pages/CompanionsPage';
import CompanionPoolPage from './pages/OrderPoolPage';
import MachinesPage from './pages/admin/MachinesPage';
import PcControlPage from './pages/admin/PcControlPage';
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
import OrderReviewPage from './pages/admin/OrderReviewPage';
import TodosPage from './pages/TodosPage';

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

/**
 * 每个页面统一包一层 Suspense —— 单一入口，别在每个路由里各抄一遍 fallback。
 * 现在还没有真正的懒加载（页面都是同步 import 的），所以这一层暂时不会真的被触发；
 * 将来要按路由拆包，只把上面的 import 换成 lazy(() => import(...)) 就行，这里不用动。
 */
const page = (node: ReactNode) => <Suspense fallback={<SuspenseFallback />}>{node}</Suspense>;

export const router = createBrowserRouter([
  {
    path: '/login',
    errorElement: <RouteErrorBoundary />,
    element: page(<LoginPage />),
  },
  {
    // 独立的聊天窗口（一个联系人一个系统窗口，能最小化到任务栏 —— 老板 2026-10-05）。
    // 不在 AppLayout 里，只渲染一个聊天面板。
    path: '/chat-window',
    errorElement: <RouteErrorBoundary />,
    element: page(<ChatWindowPage />),
  },
  {
    path: '/profile-setup',
    errorElement: <RouteErrorBoundary />,
    element: page(<ProfileSetupPage />),
  },
  {
    path: '/companion',
    element: <SuspenseOutlet />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        path: '',
        element: page(<CompanionPage />),
      },
      {
        path: 'pool',
        element: page(<CompanionPoolPage />),
      },
      {
        path: 'live-board',
        element: page(<LiveBoardPage />),
      },
      {
        path: 'billing',
        element: page(<BillingOverview />),
      },
      {
        path: 'wallet-calendar',
        element: page(<CompanionWalletCalendarPage />),
      },
      {
        path: 'customers/:id',
        element: page(<CustomerDetailPage />),
      },
      {
        path: 'customer-board',
        element: page(<CustomerBoardPage />),
      },
      {
        path: 'customers',
       element: page(<CustomersPage />),
      },
      {
        path: 'orders',
        element: page(<OrdersPage />),
      },
      {
        path: 'dispatch',
        element: page(<DispatchPage />),
      },
      {
        path: 'companions',
        element: page(<CompanionsPage />),
      },
      {
        path: 'stats',
        element: page(<StatsPage />),
      },
      {
        path: 'battle-screenshots',
        element: page(<BattleScreenshotsPage />),
      },
    ],
  },
  {
    path: '/',
    element: <SuspenseOutlet />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: 'owner/live-board', element: <Navigate to="/admin" replace /> },
      {
        path: 'owner/customers',
       element: page(<CustomersPage />),
      },
      {
        path: 'owner/employees',
        element: page(<EmployeesPage />),
      },
      {
        path: 'owner/studios',
        element: page(<StudiosPage />),
      },
      {
        path: 'owner/bridges',
        element: page(<BridgePage />),
      },
      {
        path: 'owner/authorizations',
        element: page(<AuthorizationsPage />),
      },
      {
        path: 'owner/review',
        element: page(<ReviewPage />),
      },
      {
        path: 'owner/settings',
        element: page(<SettingsPage />),
      },
      {
        path: 'owner/work-wechats',
        element: page(<WorkWechatPage />),
      },
      {
        path: 'owner/orders',
        element: page(<OrdersPage />),
      },
      {
        path: 'owner/order-review',
        element: page(<OrderReviewPage />),
      },
      {
        // 待处理工作台（老板 2026-10-06）：店长 / 老板 / 客服上班先点这一页，
        // 所有待办汇总在这儿（不跟着角色分路由，三个角色共用一条）。
        path: 'todos',
        element: page(<TodosPage />),
      },
      {
        path: 'admin',
        element: page(<OperationsBoard />),
      },
      {
        path: 'admin/revenue',
        element: page(<UnifiedDashboard />),
      },
      {
        path: 'admin/dispatch',
        element: page(<DispatchPage />),
      },
      { path: 'admin/live-board', element: <Navigate to="/admin" replace /> },
      {
        path: 'admin/employees',
        element: page(<EmployeesPage />),
      },
      {
        path: 'admin/companions',
        element: page(<CompanionsPage />),
      },
      {
        path: 'admin/battle-screenshots',
        element: page(<BattleScreenshotReviewPage />),
      },
      {
        path: 'admin/customers/:id',
        element: page(<CustomerDetailPage />),
      },
      // 客户看板：老板 / 店长各自的菜单路径（陪玩端另有 /companion/customer-board；
      // 原来菜单里的 /owner/customer-board、/admin/customer-board 点进去是 404，老板 2026-10-04 发现）
      {
        path: 'owner/customer-board',
        element: page(<CustomerBoardPage />),
      },
      {
        path: 'admin/customer-board',
        element: page(<CustomerBoardPage />),
      },
      // 老板看客户看板点「详情」跳的是 /owner/customers/:id，这条原来也漏了
      {
        path: 'owner/customers/:id',
        element: page(<CustomerDetailPage />),
      },
      {
        path: 'admin/customers',
       element: page(<CustomersPage />),
      },
      {
        path: 'admin/billing',
        element: page(<BillingOverview />),
      },
      {
        path: 'admin/finance/risk',
        element: page(<RiskWorkbenchPage />),
      },
      {
        path: 'admin/finance/reconciliation',
        element: page(<ReconciliationPage />),
      },
      {
        path: 'admin/cs-wechat-flow',
        element: page(<CsWechatFlowPage />),
      },
      {
        path: 'admin/profit-calendar',
        element: page(<ProfitCalendarPage />),
      },
      {
        path: 'admin/companion-wallet-calendar',
        element: page(<CompanionWalletCalendarPage />),
      },
      {
        path: 'admin/finance/expenses',
        element: page(<ExpenseReviewPage />),
      },
      {
        path: 'admin/finance/commission',
        element: page(<CommissionPage />),
      },
      {
        path: 'admin/finance/commission-today',
        element: page(<CsCommissionTodayPage />),
      },
      {
        path: 'admin/cs-settings',
        element: page(<CsSettingsPage />),
      },
      {
        // 「店长设置」页 2026-09-22 并进「工资规则」（店长 / 客服就是同一张工资表的两行），
        // 老书签/老链接照旧能用，直接落到那一页。
        path: 'admin/store-manager-settings',
        element: <Navigate to="/admin/payroll" replace />,
      },
      {
        path: 'admin/finance/price-rules',
        element: page(<PriceRulesPage />),
      },
      {
        path: 'admin/pc-control',
        element: page(<PcControlPage />),
      },
      {
                path: 'admin/machines',
        element: page(<MachinesPage />),
      },
      {
        // 「电脑管理」2026-10-04 并进「机器管理」（手工登记 + 远程开关机那一块就在机器管理页里），
        // 老书签 / 老链接照旧能用，直接落到机器管理页。
        path: 'admin/managed-pcs',
        element: <Navigate to="/admin/machines" replace />,
      },
      {
        path: 'admin/payroll',
        element: page(<PayrollPage />),
      },
      {
        // 「利润分成」页 2026-09-22 合并进「设置 → 系统配置 → 利润分成（分账规则）」，
        // 老书签/老链接照旧能用，直接落到那一页。
        path: 'admin/profit-split',
        element: <Navigate to="/admin/settings?tab=payment" replace />,
      },
      {
        path: 'admin/traffic-accounts',
        element: page(<TrafficAccountPage />),
      },
      {
        path: 'admin/review',
        element: page(<ReviewPage />),
      },
      {
        path: 'admin/orders',
        element: page(<OrdersPage />),
      },
      {
        path: 'admin/order-review',
        element: page(<OrderReviewPage />),
      },
      {
        path: 'admin/blacklist',
        element: page(<BlacklistPage />),
      },
      {
        path: 'admin/whitelist',
        element: page(<WhitelistPage />),
      },
      {
        path: 'admin/process-kill-log',
        element: page(<ProcessKillLogPage />),
      },
      {
        path: 'admin/attendance',
        element: page(<AttendancePage />),
      },
      {
        path: 'content-check',
        element: page(<ContentCheckPage />),
      },
      {
        path: 'admin/settings',
        element: page(<SettingsPage />),
      },
      {
        path: 'admin/agent-version',
        element: page(<AgentVersionPage />),
      },
      {
        path: 'admin/work-wechats',
        element: page(<WorkWechatPage />),
      },
      {
        path: 'cs/billing',
        element: page(<BillingOverview />),
      },
      {
        path: 'cs/dispatch',
        element: page(<DispatchPage />),
      },
      { path: 'cs/live-board', element: <Navigate to="/cs/home" replace /> },
      {
        path: 'cs/orders',
        element: page(<OrdersPage />),
      },
      {
        path: 'cs/order-review',
        element: page(<OrderReviewPage />),
      },
      {
        path: 'cs/customers/:id',
        element: page(<CustomerDetailPage />),
      },
      {
        path: 'cs/customers',
        element: page(<CustomersPage />),
      },
      {
        path: 'cs/employees',
        element: page(<CompanionsPage />),
      },
      {
        path: 'cs/work-wechats',
        element: page(<WorkWechatPage />),
      },
      {
        path: 'cs/home',
        element: page(<OperationsBoard compact />),
      },
      {
        path: 'cs/stats',
        element: page(<StatsPage />),
      },
      {
        // 客服自己的提成看板（老板 2026-09-29）：和店长/老板那张是同一页，
        // 客服打开只能看自己的明细（后端强制），但整张表的人和数字都看得见。
        path: 'cs/finance/commission-today',
        element: page(<CsCommissionTodayPage />),
      },
      {
        path: 'cs/traffic-accounts',
        element: page(<TrafficAccountPage />),
      },
      {
        path: 'profile',
        element: page(<ProfilePage />),
      },
      { path: '', element: <Navigate to="/admin" replace /> },
    ],
  },
]);
