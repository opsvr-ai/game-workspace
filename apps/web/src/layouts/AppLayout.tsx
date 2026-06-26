import React, { useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Space, Spin } from 'antd';
import type { MenuProps } from 'antd';
import {
  DollarOutlined,
  TeamOutlined,
  UserOutlined,
  ShopOutlined,
  KeyOutlined,
  SendOutlined,
  AuditOutlined,
  FileTextOutlined,
  DesktopOutlined,
  UnorderedListOutlined,
  HeartOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { UserRole } from '@chunlv/shared';
import { useAuthStore } from '../stores/authStore';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

// Use React.createElement to bypass @ant-design/icons + @types/react 18.3.x JSX type conflict
const IconRevenue = React.createElement(DollarOutlined);
const IconCustomers = React.createElement(TeamOutlined);
const IconEmployees = React.createElement(UserOutlined);
const IconStudios = React.createElement(ShopOutlined);
const IconAuth = React.createElement(KeyOutlined);
const IconDispatch = React.createElement(SendOutlined);
const IconCompanions = React.createElement(HeartOutlined);
const IconBilling = React.createElement(AuditOutlined);
const IconOrders = React.createElement(FileTextOutlined);
const IconPc = React.createElement(DesktopOutlined);
const IconCompanionStatus = React.createElement(UnorderedListOutlined);
const IconLogout = React.createElement(LogoutOutlined);
const IconFold = React.createElement(MenuFoldOutlined);
const IconUnfold = React.createElement(MenuUnfoldOutlined);

interface MenuItemDef {
  key: string;
  icon: React.ReactNode;
  label: string;
}

const roleMenus: Record<UserRole, MenuItemDef[]> = {
  [UserRole.OWNER]: [
    { key: '/owner/revenue', icon: IconRevenue, label: '盈亏统计' },
    { key: '/owner/customers', icon: IconCustomers, label: '客户管理' },
    { key: '/owner/employees', icon: IconEmployees, label: '员工管理' },
    { key: '/owner/studios', icon: IconStudios, label: '工作室管理' },
    { key: '/owner/authorizations', icon: IconAuth, label: '客户端授权' },
    { key: '/owner/review', icon: IconAuth, label: '实名审核' },
    { key: '/owner/settings', icon: IconAuth, label: '系统设置' },
  ],
  [UserRole.ADMIN]: [
    { key: '/admin/dispatch', icon: IconDispatch, label: '派单管理' },
    { key: '/admin/companions', icon: IconCompanions, label: '陪玩管理' },
    { key: '/admin/customers', icon: IconCustomers, label: '客户管理' },
    { key: '/admin/billing', icon: IconBilling, label: '报账审核' },
    { key: '/admin/revenue', icon: IconRevenue, label: '收入流水' },
    { key: '/admin/pc-control', icon: IconPc, label: '远程控制' },
    { key: '/admin/review', icon: IconAuth, label: '实名审核' },
    { key: '/admin/settings', icon: IconAuth, label: '系统设置' },
  ],
  [UserRole.CS]: [
    { key: '/cs/dispatch', icon: IconDispatch, label: '派单工作台' },
    { key: '/cs/orders', icon: IconOrders, label: '派单记录' },
  ],
  [UserRole.COMPANION]: [
    { key: '/companion', icon: IconRevenue, label: '首页' },
    { key: '/companion/pool', icon: IconDispatch, label: '抢单中心' },
    { key: '/companion/billing', icon: IconBilling, label: '报账系统' },
    { key: '/companion/customers', icon: IconCustomers, label: '客户管理' },
    { key: '/companion/orders', icon: IconOrders, label: '接单记录' },
  ],
};

const roleLabels: Record<UserRole, string> = {
  [UserRole.OWNER]: '老板',
  [UserRole.ADMIN]: '管理员',
  [UserRole.CS]: '客服',
  [UserRole.COMPANION]: '陪玩',
};

const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = React.useState(false);
  const { user, isAuthenticated, fetchUser, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!user && isAuthenticated) {
      fetchUser();
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const menuItems = useMemo(() => {
    if (!user) return [];
    return roleMenus[user.role] || [];
  }, [user]);

  const selectedKeys = useMemo(() => {
    const path = location.pathname;
    const matched = menuItems
      .map((item) => item.key)
      .filter((key) => path.startsWith(key))
      .sort((a, b) => b.length - a.length);
    return matched.length > 0 ? [matched[0]] : [];
  }, [location.pathname, menuItems]);

  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    navigate(key);
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  if (!user && isAuthenticated) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* ── 深色侧边栏 ── */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={220}
        style={{
          background: '#0F172A',
          borderRight: 'none',
        }}
      >
        {/* Logo 区域 */}
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <Text
            style={{
              fontSize: collapsed ? 14 : 18,
              fontWeight: 700,
              letterSpacing: -0.3,
              whiteSpace: 'nowrap',
              background: 'linear-gradient(135deg, #7B61FF, #00D4FF)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {collapsed ? '⚡' : '蠢驴电竞'}
          </Text>
        </div>

        {/* 导航菜单 */}
        <Menu
          mode="inline"
          theme="dark"
          selectedKeys={selectedKeys}
          items={menuItems as MenuProps['items']}
          onClick={onMenuClick}
          style={{
            background: 'transparent',
            border: 'none',
            marginTop: 8,
          }}
        />

        {/* 底部系统状态栏 */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '12px 16px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          <Text
            style={{
              color: '#64748B',
              fontSize: 11,
              display: 'block',
              textAlign: 'center',
            }}
          >
            {collapsed ? '' : 'CHUNLV ESports · v2.1'}
          </Text>
        </div>
      </Sider>

      <Layout>
        {/* 顶栏 — 白色底 */}
        <Header
          style={{
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #E2E8F0',
            zIndex: 1,
            height: 56,
            background: '#FFFFFF',
          }}
        >
          <Button
            type="text"
            icon={collapsed ? IconUnfold : IconFold}
            onClick={() => setCollapsed(!collapsed)}
            style={{ color: '#64748B' }}
          />
          <Space size="middle">
            {user && (
              <>
                <Text style={{ color: '#1E293B', fontWeight: 500 }}>{user.username}</Text>
                <Text style={{ color: '#00D4FF', fontSize: 12, fontWeight: 600 }}>
                  {roleLabels[user.role]}
                </Text>
              </>
            )}
            <Button
              type="text"
              icon={IconLogout}
              onClick={handleLogout}
              style={{ color: '#64748B' }}
            >
              退出
            </Button>
          </Space>
        </Header>

        {/* 内容区 — 白色圆角容器 */}
        <Content
          style={{
            margin: 20,
            padding: 24,
            background: '#FFFFFF',
            borderRadius: 12,
            minHeight: 280,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
