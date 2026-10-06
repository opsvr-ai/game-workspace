import { createBrowserRouter, Navigate, useRouteError, isRouteErrorResponse } from 'react-router-dom';
import { Suspense, lazy, type ReactNode } from 'react';
import { Button, Space } from 'antd';
import LoadingState from './components/LoadingState';
import { TEXT } from './styles/tokens';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
// 独立聊天窗那一页也懒加载（它是单独一个窗口打开的，首屏用不到）。
const ChatWindowPage = lazy(() => import('./pages/ChatWindowPage'));

/**
 * 路由出错时的兜底页（页面不存在 / 页面自己崩了）。
 *
 * 为什么不再用 antd 的 <Result>：它自带的大插画是 antd 那套蓝紫色，跟本产品的品牌紫不是一套；
 * 而且这一页**真的会被人看到** —— 陪玩端 / 客服端内嵌窗口写死的老地址在新版本里下线之后，
 * 打开就是这里（还有客服发给别人、对方点进来的过期链接）。
 * 所以它跟登录页共用同一套「品牌外壳 + 品牌卡」（.brand-shell / .brand-card）：
 * 出错时颜色不跳、看着还是同一个产品，并且明确给出「下一步点哪」。
 */
function RouteErrorBoundary() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);
  const routeError = isRouteErrorResponse(error) ? error : null;
  const notFound = routeError?.status === 404;
  const subtitle = notFound
    ? '这个地址不存在，或者这个页面已经下线了。'
    : routeError?.data?.message || routeError?.statusText || message || '发生了意外错误，请刷新页面重试';

  return (
    <div className="brand-shell">
      <div className="brand-card" style={{ width: 440, textAlign: 'center' }}>
        <span className="brand-icon">{notFound ? '🧭' : '⚡'}</span>
        <h1>{notFound ? '没有这个页面' : '页面出了点问题'}</h1>
        <div className="subtitle">{subtitle}</div>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Button type="primary" size="large" block onClick={() => (window.location.href = '/')}>
            回到首页
          </Button>
          {notFound ? null : (
            <Button size="large" block onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          )}
          <Button type="text" block style={{ color: TEXT.secondary }} onClick={() => (window.location.href = '/login')}>
            重新登录
          </Button>
        </Space>
        {notFound ? null : (
          <details style={{ marginTop: 18, textAlign: 'left' }}>
            <summary style={{ cursor: 'pointer', color: TEXT.tertiary, fontSize: 12 }}>
              错误详情（给技术同事看）
            </summary>
            <pre
              style={{
                marginTop: 8,
                maxHeight: 200,
                overflow: 'auto',
                fontSize: 12,
                color: TEXT.secondary,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {message}
              {'\n\n'}
              {error instanceof Error ? error.stack : ''}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

// ── 页面一律按路由懒加载 ──────────────────────────────────────────────
// 以前 50 个页面全是同步 import：首屏必须把「所有页面」的代码都下载 + 解析完才画出第一帧
// （实测应用主包 1.2MB，本机都要 3 秒才见到外壳，线上更慢）。改成 lazy 之后首屏只拉
// 「外壳 + 当前这一页」，别的页面点到才下。
//
// 每条路由外面本来就有 <Suspense>（见下面的 page()），所以这里不用再包一层；
// 加载中显示的就是 SuspenseFallback（统一 LoadingState）。
//
// 只有 AppLayout（外壳）和 LoginPage（第一屏）保持同步 import —— 这两个任一拉不到，
// 用户连登录都进不去，不值得为这点体积冒险。
const UnifiedDashboard = lazy(() => import('./pages/admin/UnifiedDashboard'));
const OperationsBoard = lazy(() => import('./pages/admin/OperationsBoard'));
const LiveBoardPage = lazy(() => import('./pages/admin/LiveBoardPage'));
const CustomerBoardPage = lazy(() => import('./pages/CustomerBoardPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const DispatchPage = lazy(() => import('./pages/DispatchPage'));
const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const BillingOverview = lazy(() => import('./pages/BillingOverview'));
const CompanionsPage = lazy(() => import('./pages/CompanionsPage'));
const CompanionPoolPage = lazy(() => import('./pages/OrderPoolPage'));
const MachinesPage = lazy(() => import('./pages/admin/MachinesPage'));
const PcControlPage = lazy(() => import('./pages/admin/PcControlPage'));
const PayrollPage = lazy(() => import('./pages/admin/PayrollPage'));
const TrafficAccountPage = lazy(() => import('./pages/admin/TrafficAccountPage'));
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
const UiKitPage = lazy(() => import('./pages/UiKitPage'));
const CompanionPage = lazy(() => import('./pages/CompanionPage'));
const CustomerDetailPage = lazy(() => import('./pages/CustomerDetailPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const WorkWechatPage = lazy(() => import('./pages/WorkWechatPage'));
const PriceRulesPage = lazy(() => import('./pages/finance/PriceRulesPage'));
const CommissionPage = lazy(() => import('./pages/finance/CommissionPage'));
const CsCommissionTodayPage = lazy(() => import('./pages/finance/CsCommissionTodayPage'));
const CsSettingsPage = lazy(() => import('./pages/admin/CsSettingsPage'));
const ReconciliationPage = lazy(() => import('./pages/finance/ReconciliationPage'));
const CsWechatFlowPage = lazy(() => import('./pages/finance/CsWechatFlowPage'));
const ProfitCalendarPage = lazy(() => import('./pages/finance/ProfitCalendarPage'));
const CompanionWalletCalendarPage = lazy(() => import('./pages/finance/CompanionWalletCalendarPage'));
const RiskWorkbenchPage = lazy(() => import('./pages/finance/RiskWorkbenchPage'));
const ExpenseReviewPage = lazy(() => import('./pages/finance/ExpenseReviewPage'));
const BattleScreenshotsPage = lazy(() => import('./pages/BattleScreenshotsPage'));
const BattleScreenshotReviewPage = lazy(() => import('./pages/BattleScreenshotReviewPage'));
const ContentCheckPage = lazy(() => import('./pages/ContentCheckPage'));
const OrderReviewPage = lazy(() => import('./pages/admin/OrderReviewPage'));
const TodosPage = lazy(() => import('./pages/TodosPage'));

const SuspenseOutlet = () => (
  <Suspense
    fallback={<LoadingState size="large" minHeight={200} />}
  >
    <AppLayout />
  </Suspense>
);

const SuspenseFallback = () => <LoadingState size="large" minHeight={200} />;

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
    // 内部「设计校对页」：不在菜单里、不需要登录，改界面时前后各截一张图对照用（见 docs/ARCHITECTURE.md 5.1）。
    path: '/ui-kit',
    errorElement: <RouteErrorBoundary />,
    element: page(<UiKitPage />),
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
