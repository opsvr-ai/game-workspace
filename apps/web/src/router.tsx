import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import CustomersPage from './pages/owner/CustomersPage';
import DispatchPage from './pages/cs/DispatchPage';
import CompanionsStatusPage from './pages/cs/CompanionsStatusPage';

const PlaceholderPage = ({ title }: { title: string }) => (
  <div style={{ padding: 24 }}>
    <h2>{title}</h2>
    <p>此页面将在后续阶段实现</p>
  </div>
);

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
        element: <PlaceholderPage title="盈亏统计" />,
      },
      {
        path: 'owner/customers',
        element: <CustomersPage />,
      },
      {
        path: 'owner/employees',
        element: <PlaceholderPage title="员工管理" />,
      },
      {
        path: 'owner/studios',
        element: <PlaceholderPage title="工作室管理" />,
      },
      {
        path: 'owner/authorizations',
        element: <PlaceholderPage title="客户端授权" />,
      },
      // Admin routes
      {
        path: 'admin/dispatch',
        element: <PlaceholderPage title="派单管理" />,
      },
      {
        path: 'admin/companions',
        element: <PlaceholderPage title="陪玩管理" />,
      },
      {
        path: 'admin/customers',
        element: <PlaceholderPage title="客户管理" />,
      },
      {
        path: 'admin/billing',
        element: <PlaceholderPage title="报账审核" />,
      },
      {
        path: 'admin/revenue',
        element: <PlaceholderPage title="收入流水" />,
      },
      {
        path: 'admin/pc-control',
        element: <PlaceholderPage title="远程控制" />,
      },
      // CS routes
      {
        path: 'cs/dispatch',
        element: <DispatchPage />,
      },
      {
        path: 'cs/orders',
        element: <PlaceholderPage title="派单记录" />,
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
