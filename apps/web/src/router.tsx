import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import UnifiedDashboard from './pages/admin/UnifiedDashboard';
import CustomersPage from './pages/CustomersPage';
import DispatchPage from './pages/DispatchPage';
import OrdersPage from './pages/OrdersPage';
import BillingPage from './pages/BillingPage';
import CompanionsPage from './pages/CompanionsPage';
import OrderPoolPage from './pages/OrderPoolPage';
import AdminPcControlPage from './pages/admin/PcControlPage';
import EmployeesPage from './pages/owner/EmployeesPage';
import StudiosPage from './pages/owner/StudiosPage';
import AuthorizationsPage from './pages/owner/AuthorizationsPage';
import ReviewPage from './pages/admin/ReviewPage';
import SettingsPage from './pages/admin/SettingsPage';
import BlacklistPage from './pages/admin/BlacklistPage';
import ProcessKillLogPage from './pages/admin/ProcessKillLogPage';
import WhitelistPage from './pages/admin/WhitelistPage';
import AttendancePage from './pages/admin/AttendancePage';
import ProfileSetupPage from './pages/ProfileSetupPage';
import CompanionPage from './pages/CompanionPage';
import CustomerDetailPage from './pages/CustomerDetailPage';
import ProfilePage from './pages/ProfilePage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/profile-setup', element: <ProfileSetupPage /> },
  {
    path: '/companion',
    element: <AppLayout />,
    children: [
      { path: '', element: <CompanionPage /> },
      { path: 'pool', element: <OrderPoolPage /> },
      { path: 'billing', element: <BillingPage /> },
      { path: 'customers/:id', element: <CustomerDetailPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'orders', element: <OrdersPage /> },
      { path: 'dispatch', element: <DispatchPage /> },
      { path: 'companions', element: <CompanionsPage /> },
    ],
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { path: 'owner/customers', element: <CustomersPage /> },
      { path: 'owner/employees', element: <EmployeesPage /> },
      { path: 'owner/studios', element: <StudiosPage /> },
      { path: 'owner/authorizations', element: <AuthorizationsPage /> },
      { path: 'owner/review', element: <ReviewPage /> },
      { path: 'owner/settings', element: <SettingsPage /> },
      { path: 'owner/orders', element: <OrdersPage /> },
      { path: 'admin', element: <UnifiedDashboard /> },
      { path: 'admin/dispatch', element: <DispatchPage /> },
      { path: 'admin/employees', element: <CompanionsPage /> },
      { path: 'admin/customers/:id', element: <CustomerDetailPage /> },
      { path: 'admin/customers', element: <CustomersPage /> },
      { path: 'admin/billing', element: <BillingPage /> },
      { path: 'admin/pc-control', element: <AdminPcControlPage /> },
      { path: 'admin/review', element: <ReviewPage /> },
      { path: 'admin/orders', element: <OrdersPage /> },
      { path: 'admin/traffic', element: <OrderPoolPage /> },
      { path: 'admin/blacklist', element: <BlacklistPage /> },
      { path: 'admin/whitelist', element: <WhitelistPage /> },
      { path: 'admin/process-kill-log', element: <ProcessKillLogPage /> },
      { path: 'admin/attendance', element: <AttendancePage /> },
      { path: 'admin/settings', element: <SettingsPage /> },
      { path: 'cs/dispatch', element: <DispatchPage /> },
      { path: 'cs/orders', element: <OrdersPage /> },
      { path: 'cs/employees', element: <CompanionsPage /> },
      { path: 'cs/companions', element: <CompanionsPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: '', element: <Navigate to="/admin" replace /> },
    ],
  },
]);
