import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { Spin } from 'antd';
import AppLayout from './layouts/AppLayout';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const UnifiedDashboard = lazy(() => import('./pages/admin/UnifiedDashboard'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const DispatchPage = lazy(() => import('./pages/DispatchPage'));
const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const BillingOverview = lazy(() => import('./pages/BillingOverview'));
const CompanionsPage = lazy(() => import('./pages/CompanionsPage'));
const OrderPoolPage = lazy(() => import('./pages/OrderPoolPage'));
const CompanionPoolPage = lazy(() => import('./pages/DispatchPage'));
const AdminPcControlPage = lazy(() => import('./pages/admin/PcControlPage'));
const EmployeesPage = lazy(() => import('./pages/owner/EmployeesPage'));
const StudiosPage = lazy(() => import('./pages/owner/StudiosPage'));
const BridgePage = lazy(() => import('./pages/BridgePage'));
const AuthorizationsPage = lazy(() => import('./pages/owner/AuthorizationsPage'));
const ReviewPage = lazy(() => import('./pages/admin/ReviewPage'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const AgentVersionPage = lazy(() => import('./pages/admin/AgentVersionPage'));
const BlacklistPage = lazy(() => import('./pages/admin/BlacklistPage'));
const ProcessKillLogPage = lazy(() => import('./pages/admin/ProcessKillLogPage'));
const WhitelistPage = lazy(() => import('./pages/admin/WhitelistPage'));
const AttendancePage = lazy(() => import('./pages/admin/AttendancePage'));
const ProfileSetupPage = lazy(() => import('./pages/ProfileSetupPage'));
const CompanionPage = lazy(() => import('./pages/CompanionPage'));
const CustomerDetailPage = lazy(() => import('./pages/CustomerDetailPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));

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
    element: (
      <Suspense fallback={<SuspenseFallback />}>
        <LoginPage />
      </Suspense>
    ),
  },
  {
    path: '/profile-setup',
    element: (
      <Suspense fallback={<SuspenseFallback />}>
        <ProfileSetupPage />
      </Suspense>
    ),
  },
  {
    path: '/companion',
    element: <SuspenseOutlet />,
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
    ],
  },
  {
    path: '/',
    element: <SuspenseOutlet />,
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
        path: 'admin/pc-control',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <AdminPcControlPage />
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
        path: 'cs/billing',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <BillingOverview />
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
