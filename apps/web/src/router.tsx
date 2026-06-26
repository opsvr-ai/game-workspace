import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import CustomersPage from './pages/owner/CustomersPage';
import AdminCustomersPage from './pages/admin/CustomersPage';
import AdminCompanionsPage from './pages/admin/CompanionsPage';
import AdminDispatchPage from './pages/admin/DispatchPage';
import DispatchPage from './pages/cs/DispatchPage';
import CompanionsStatusPage from './pages/cs/CompanionsStatusPage';
import OrdersPage from './pages/cs/OrdersPage';
import AdminBillingPage from './pages/admin/BillingPage';
import AdminRevenuePage from './pages/admin/RevenuePage';
import AdminPcControlPage from './pages/admin/PcControlPage';
import EmployeesPage from './pages/owner/EmployeesPage';
import StudiosPage from './pages/owner/StudiosPage';
import AuthorizationsPage from './pages/owner/AuthorizationsPage';
import OwnerRevenuePage from './pages/owner/RevenuePage';
import ReviewPage from './pages/admin/ReviewPage';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      // Owner routes
      {
        path: 'owner/revenue',
        element: <OwnerRevenuePage />,
      },
      {
        path: 'owner/customers',
        element: <CustomersPage />,
      },
      {
        path: 'owner/employees',
        element: <EmployeesPage />,
      },
      {
        path: 'owner/studios',
        element: <StudiosPage />,
      },
      {
        path: 'owner/authorizations',
        element: <AuthorizationsPage />,
      },
      {
        path: 'owner/review',
        element: <ReviewPage />,
      },
      // Admin routes
      {
        path: 'admin/dispatch',
        element: <AdminDispatchPage />,
      },
      {
        path: 'admin/companions',
        element: <AdminCompanionsPage />,
      },
      {
        path: 'admin/customers',
        element: <AdminCustomersPage />,
      },
      {
        path: 'admin/billing',
        element: <AdminBillingPage />,
      },
      {
        path: 'admin/revenue',
        element: <AdminRevenuePage />,
      },
      {
        path: 'admin/pc-control',
        element: <AdminPcControlPage />,
      },
      {
        path: 'admin/review',
        element: <ReviewPage />,
      },
      // CS routes
      {
        path: 'cs/dispatch',
        element: <DispatchPage />,
      },
      {
        path: 'cs/orders',
        element: <OrdersPage />,
      },
      {
        path: 'cs/companions',
        element: <CompanionsStatusPage />,
      },
      {
        path: '',
        element: <Navigate to="/login" replace />,
      },
    ],
  },
]);
