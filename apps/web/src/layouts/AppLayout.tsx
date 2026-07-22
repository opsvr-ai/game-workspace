// craftsman-ignore: TS001,TS002
import React, { useEffect, useMemo, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Space, Spin, Tag, Modal, Badge, Popover } from 'antd';
import type { MenuProps } from 'antd';
import { useSocket } from '../hooks/useSocket';
// useChatNotification → now handled by ChatProvider
import ErrorBoundary from '../components/ErrorBoundary';
import UrgentOrderPopup from '../components/UrgentOrderPopup';
import DualCompanionModal from '../components/DualCompanionModal';
import { ChatProvider } from '../components/chat';
import CommandPalette from '../components/CommandPalette';
import ChatModal from '../components/ChatModal';
// FloatingChatWidget removed — redundant with bell notification
import { ConversationList } from '../components/ConversationList';
// Chat 3.0: playMessageSound + chatApi now handled by ChatProvider

// Badge pulse animation
if (!document.getElementById('badge-pulse-css')) {
  const s = document.createElement('style');
  s.id = 'badge-pulse-css';
  s.textContent =
    '@keyframes badge-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}.pulse-badge{animation:badge-pulse 0.6s ease-in-out infinite;display:inline-block}';
  document.head.appendChild(s);
}

// Bell pulse animation
if (!document.getElementById('bell-pulse-css')) {
  const s2 = document.createElement('style');
  s2.id = 'bell-pulse-css';
  s2.textContent =
    '@keyframes bell-ring{0%,100%{transform:rotate(0deg)}10%{transform:rotate(8deg)}20%{transform:rotate(-8deg)}30%{transform:rotate(6deg)}40%{transform:rotate(-6deg)}50%{transform:rotate(3deg)}60%{transform:rotate(-3deg)}70%{transform:rotate(0deg)}}.bell-animate{animation:bell-ring 0.8s ease-in-out;display:inline-block}';
  document.head.appendChild(s2);
}

import {
  ControlOutlined,
  StopOutlined,
  SafetyOutlined,
  HistoryOutlined,
  DashboardOutlined,
  DollarOutlined,
  TeamOutlined,
  UserOutlined,
  ShopOutlined,
  KeyOutlined,
  SendOutlined,
  AuditOutlined,
  FileTextOutlined,
  FundOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ClockCircleOutlined,
  BellOutlined,
} from '@ant-design/icons';
import { UserRole } from '@chunlv/shared';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useOrderStore } from '../stores/orderStore';
import { orderTypeConfig } from '../constants/orders';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

// Use React.createElement to bypass @ant-design/icons + @types/react 18.3.x JSX type conflict
const IconDashboard = React.createElement(DashboardOutlined);
const IconRevenue = React.createElement(DollarOutlined);
const IconCustomers = React.createElement(TeamOutlined);
const IconEmployees = React.createElement(UserOutlined);
const IconStudios = React.createElement(ShopOutlined);
const IconAuth = React.createElement(KeyOutlined);
const IconDispatch = React.createElement(SendOutlined);
const IconBilling = React.createElement(AuditOutlined);
const IconOrders = React.createElement(FileTextOutlined);
// Process管控菜单统一图标
const IconControl = React.createElement(ControlOutlined);
const IconStop = React.createElement(StopOutlined);
const IconSafety = React.createElement(SafetyOutlined);
const IconHistory = React.createElement(HistoryOutlined);
const IconClock = React.createElement(ClockCircleOutlined);

const IconLogout = React.createElement(LogoutOutlined);
const IconTraffic = React.createElement(FundOutlined);
const IconFold = React.createElement(MenuFoldOutlined);
const IconUnfold = React.createElement(MenuUnfoldOutlined);

interface MenuItemDef {
  key: string;
  icon?: React.ReactNode;
  label: string;
  type?: string;
  children?: MenuItemDef[];
}

const roleMenus: Record<UserRole, MenuItemDef[]> = {
  [UserRole.OWNER]: [
    {
      key: 'grp-overview',
      type: 'group',
      label: '经营概览',
      children: [
        { key: '/admin', icon: IconDashboard, label: '数据看板' },
        { key: '/admin/traffic', icon: IconTraffic, label: '订单池' },
        { key: '/admin/billing', icon: IconBilling, label: '报账系统' },
      ],
    },
    {
      key: 'grp-people',
      type: 'group',
      label: '人员管理',
      children: [
        { key: '/owner/orders', icon: IconOrders, label: '订单管理' },
        { key: '/owner/customers', icon: IconCustomers, label: '客户管理' },
        { key: '/owner/employees', icon: IconEmployees, label: '员工管理' },
        { key: '/owner/review', icon: IconAuth, label: '实名审核' },
      ],
    },
    {
      key: 'grp-control',
      type: 'group',
      label: '系统管控',
      children: [
        { key: '/owner/studios', icon: IconStudios, label: '工作室管理' },
        { key: '/owner/authorizations', icon: IconAuth, label: '客户端授权' },
        { key: '/admin/pc-control', icon: IconControl, label: '远程控制' },
        { key: '/admin/blacklist', icon: IconStop, label: '进程黑名单' },
        { key: '/admin/whitelist', icon: IconSafety, label: '进程白名单' },
        { key: '/admin/process-kill-log', icon: IconHistory, label: '杀进程日志' },
        { key: '/admin/attendance', icon: IconClock, label: '考勤管理' },
      ],
    },
    {
      key: 'grp-settings',
      type: 'group',
      label: '设置',
      children: [{ key: '/owner/settings', icon: IconAuth, label: '系统设置' }],
    },
  ],
  [UserRole.ADMIN]: [
    { key: '/admin', icon: IconDashboard, label: '数据看板' },
    { key: '/admin/dispatch', icon: IconDispatch, label: '派单管理' },
    { key: '/admin/orders', icon: IconOrders, label: '订单管理' },
    { key: '/admin/employees', icon: IconEmployees, label: '员工管理' },
    { key: '/admin/customers', icon: IconCustomers, label: '客户管理' },
    { key: '/admin/traffic', icon: IconTraffic, label: '订单池' },
    { key: '/admin/billing', icon: IconBilling, label: '报账系统' },
    { key: '/admin/pc-control', icon: IconControl, label: '远程控制' },
    { key: '/admin/blacklist', icon: IconStop, label: '进程黑名单' },
    { key: '/admin/whitelist', icon: IconSafety, label: '进程白名单' },
    { key: '/admin/process-kill-log', icon: IconHistory, label: '杀进程日志' },
    { key: '/admin/attendance', icon: IconClock, label: '考勤管理' },
    { key: '/admin/review', icon: IconAuth, label: '实名审核' },
    { key: '/admin/settings', icon: IconAuth, label: '系统设置' },
  ],
  [UserRole.CS]: [
    { key: '/cs/dispatch', icon: IconDispatch, label: '派单工作台' },
    { key: '/cs/billing', icon: IconBilling, label: '报账系统' },
    { key: '/cs/orders', icon: IconOrders, label: '订单管理' },
    { key: '/cs/employees', icon: IconEmployees, label: '陪玩管理' },
    { key: '/admin/pc-control', icon: IconControl, label: '远程控制' },
    { key: '/admin/blacklist', icon: IconStop, label: '进程黑名单' },
    { key: '/admin/whitelist', icon: IconSafety, label: '进程白名单' },
    { key: '/admin/process-kill-log', icon: IconHistory, label: '杀进程日志' },
    { key: '/admin/attendance', icon: IconClock, label: '考勤管理' },
  ],
  [UserRole.COMPANION]: [
    { key: '/companion', icon: IconRevenue, label: '首页' },
    { key: '/companion/pool', icon: IconDispatch, label: '订单池' },
    { key: '/companion/billing', icon: IconBilling, label: '报账系统' },
    { key: '/companion/customers', icon: IconCustomers, label: '客户管理' },
    { key: '/companion/orders', icon: IconOrders, label: '接单记录' },
    { key: '/companion/dispatch', icon: IconDispatch, label: '派单记录' },
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
  const totalUnread = useChatStore((s) => s.totalUnread);
  const { grabbedOrder, setGrabbedOrder } = useOrderStore();
  const [commandPalette, setCommandPalette] = React.useState(false);
  // Notification bell
  const [notifOpen, setNotifOpen] = React.useState(false);
  // Global chat modal (opened from notification bell)
  const [globalChatPartner, setGlobalChatPartner] = React.useState<{
    conversationId: string;
    participant?: { userId: string; username: string; displayName?: string; avatar?: string; role: string };
    orderInfo?: string;
  } | null>(null);
  // Refresh pending review count for OWNER/ADMIN every 30s
  useEffect(() => {
    if (user?.role !== 'OWNER' && user?.role !== 'ADMIN') return;
    const t = setInterval(() => {
      useAuthStore.getState().fetchUser();
    }, 30000);
    return () => clearInterval(t);
  }, [user?.role]);

  // Chat 3.0: notification handled by ChatProvider

  // Open chat from notification
  const openChatFromNotification = useCallback((conversationId: string, participantName: string) => {
    const conv = useChatStore.getState().conversations[conversationId];
    setNotifOpen(false);
    setGlobalChatPartner({
      conversationId,
      participant: conv?.participant || {
        userId: conversationId,
        username: participantName,
        role: 'COMPANION',
      },
      orderInfo: conv?.orderInfo,
    });
    useChatStore.getState().markRead(conversationId);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPalette(true);
      }
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        const searchInput = document.querySelector('input[placeholder*="搜索"]') as HTMLInputElement;
        searchInput?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Auto-collapse sidebar on mobile
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth <= 768) {
        setCollapsed(true);
      }
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const navigate = useNavigate();
  const location = useLocation();

  // ── Urgent order + dual-companion popup ──
  const [urgentOrder, setUrgentOrder] = React.useState<any>(null);
  const [urgentGrabbed, setUrgentGrabbed] = React.useState<any>(null);
  const [dualReady, setDualReady] = React.useState<any>(null);

  useEffect(() => {
    if (!user && isAuthenticated) {
      fetchUser();
    }
  }, []);

  // WebSocket connection for real-time updates
  // WebSocket connection for real-time updates
  useSocket({
    onOrderUrgent: (data: any) => {
      if (user?.role === 'COMPANION') setUrgentOrder(data);
    },
  });

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }
    // Redirect authenticated users from root to their role default page
    if (location.pathname === '/' && user) {
      const defaults: Record<string, string> = {
        OWNER: '/admin',
        ADMIN: '/admin',
        CS: '/cs/dispatch',
        COMPANION: '/companion',
      };
      navigate(defaults[user.role] || '/admin', { replace: true });
    }
  }, [isAuthenticated, navigate, user, location.pathname]);

  const menuItems = useMemo(() => {
    if (!user) return [];
    const items = [...(roleMenus[user.role] || [])];
    const pCount = user?.pendingReviewCount || 0;
    return items.map((item) => {
      // Check children (group items) for badge targets
      if (item.children) {
        const hasPending = item.children.some((c: any) => c.label === '工作室管理' && pCount > 0);
        const hasUnread = item.children.some((c: any) => (c.label === '陪玩管理' || c.label === '员工管理') && totalUnread > 0);
        if (hasPending || hasUnread) {
          return {
            ...item,
            children: item.children.map((child: any) => {
              if (child.label === '工作室管理' && pCount > 0) {
                return { ...child, label: <span onClick={(e: any) => { e.stopPropagation(); navigate(child.key); }} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>{child.label}<Badge count={pCount} size="small" overflowCount={99} style={{ boxShadow: '0 0 10px #FF4757' }} /></span> };
              }
              if ((child.label === '陪玩管理' || child.label === '员工管理') && totalUnread > 0) {
                return { ...child, label: <span onClick={(e: any) => { e.stopPropagation(); navigate(child.key); }} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>{child.label}<Badge count={totalUnread} size="small" overflowCount={99} style={{ boxShadow: totalUnread > 0 ? '0 0 10px #FF4757' : undefined }} /></span> };
              }
              return child;
            }),
          };
        }
      }
      // Top-level item check (fallback)
      if ((item.label === '陪玩管理' || item.label === '员工管理') && totalUnread > 0) {
        return {
          ...item,
          label: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {item.label}
              <Badge
                count={totalUnread}
                size="small"
                overflowCount={99}
                style={{ boxShadow: totalUnread > 0 ? '0 0 10px #FF4757' : undefined }}
              />
            </span>
          ),
        };
      }
      return item;
    });
  }, [user, totalUnread]);

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
    useChatStore.getState().reset();
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
    <ChatProvider>
      <Layout style={{ minHeight: '100vh' }}>
        {/* ── 浅色侧边栏 ── */}
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={null}
          width={200}
          style={{
            background: '#FFFFFF',
            borderRight: '1px solid #E2E8F0',
          }}
        >
          {/* Logo 区域 */}
          <div
            style={{
              height: 64,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderBottom: '1px solid #F1F5F9',
            }}
          >
            <Text
              style={{
                fontSize: collapsed ? 16 : 20,
                fontWeight: 700,
                letterSpacing: -0.5,
                whiteSpace: 'nowrap',
                color: '#2563EB',
              }}
            >
              {collapsed ? '⚡' : 'Chunlv'}
            </Text>
          </div>

          {/* 导航菜单 */}
          <Menu
            mode="inline"
            theme="light"
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
              {collapsed ? '' : 'Chunlv ESports v2.1'}
            </Text>
          </div>
        </Sider>

        <Layout>
          {/* 顶栏 — 白色底 */}
          <Header
            style={{
              padding: '0 16px',
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
              {/* Notification bell */}
              {user && (
                <Popover
                  open={notifOpen}
                  onOpenChange={setNotifOpen}
                  trigger="click"
                  placement="bottomRight"
                  title="消息通知"
                  content={
                    <ConversationList onOpenChat={openChatFromNotification} onClose={() => setNotifOpen(false)} />
                  }
                >
                  <Badge count={totalUnread} overflowCount={99} size="default" offset={[-2, 8]}>
                    <div
                      style={{
                        borderRadius: 8,
                        ...(totalUnread > 0
                          ? {
                              animation: 'bell-glow 2s ease-in-out infinite',
                              boxShadow: '0 0 12px rgba(37, 99, 235, 0.5)',
                            }
                          : {}),
                      }}
                    >
                      <Button
                        type="text"
                        icon={React.createElement(BellOutlined)}
                        style={{
                          color: totalUnread > 0 ? '#2563EB' : '#64748B',
                          fontSize: 20,
                        }}
                        className={totalUnread > 0 ? 'bell-animate' : ''}
                      />
                    </div>
                  </Badge>
                </Popover>
              )}
              {user && (
                <>
                  <div
                    onClick={() => navigate('/profile')}
                    title="点击进入个人设置（修改头像/名字/密码）"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      padding: '2px 8px',
                      borderRadius: 20,
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          background: user.avatar
                            ? `url(/uploads/avatars/${user.avatar}?v=${user.avatar}) center/cover`
                            : '#1677ff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {!user.avatar && (
                          <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>
                            {(user.displayName || user.username || '?')[0].toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          position: 'absolute',
                          bottom: -2,
                          right: -2,
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          background: '#1677ff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '2px solid #fff',
                        }}
                      >
                        <span style={{ color: '#fff', fontSize: 8 }}>📷</span>
                      </div>
                    </div>
                    <Text style={{ color: '#1E293B', fontWeight: 500 }}>{user.displayName || user.username}</Text>
                  </div>
                  <Text style={{ color: '#2563EB', fontSize: 12, fontWeight: 600 }}>{roleLabels[user.role]}</Text>
                </>
              )}
              <Button type="text" icon={IconLogout} onClick={handleLogout} style={{ color: '#64748B' }}>
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
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </Content>
        </Layout>
      </Layout>

      {/* Urgent order popup + solo grab success */}
      <UrgentOrderPopup
        urgentOrder={urgentOrder}
        urgentGrabbed={urgentGrabbed}
        setUrgentOrder={setUrgentOrder}
        setUrgentGrabbed={setUrgentGrabbed}
      />

      {/* Dual-companion modal */}
      <DualCompanionModal
        urgentGrabbed={urgentGrabbed}
        dualReady={!!dualReady}
        setUrgentGrabbed={setUrgentGrabbed}
        setDualReady={(v: boolean) => setDualReady(v || null)}
      />

      {/* Global Grab Success Modal — survives navigation */}
      <Modal title="抢单成功" open={!!grabbedOrder} onCancel={() => setGrabbedOrder(null)} footer={null} width={480}>
        {grabbedOrder && (
          <div style={{ fontSize: 14, lineHeight: 2 }}>
            <div>
              📋 {grabbedOrder.gameName} · {orderTypeConfig[grabbedOrder.type]?.label || grabbedOrder.type} · ¥
              {Number(grabbedOrder.amount).toFixed(0)} · {grabbedOrder.duration}h
            </div>
            {grabbedOrder.customer?.customerCode && <div>客户编号：{grabbedOrder.customer.customerCode}</div>}
            {grabbedOrder.customFields?.customerSource && <div>来源：{grabbedOrder.customFields.customerSource}</div>}
            {grabbedOrder.customFields?.customerWechat && (
              <div>
                💬 微信：<Typography.Text copyable>{grabbedOrder.customFields.customerWechat}</Typography.Text>
              </div>
            )}
            {grabbedOrder.customFields?.customerRoomCode && (
              <div>
                🏠 房间码：<Typography.Text copyable>{grabbedOrder.customFields.customerRoomCode}</Typography.Text>
              </div>
            )}
            {grabbedOrder.customFields?.customerPlatformAccount && (
              <div>
                🔗 平台号：
                <Typography.Text copyable>{grabbedOrder.customFields.customerPlatformAccount}</Typography.Text>
              </div>
            )}
            {grabbedOrder.csUser?.username && <div>发布者：{grabbedOrder.csUser.username}</div>}
            {grabbedOrder.customFields?.urgency === 'later' && <Tag color="purple">📅预约</Tag>}
            {grabbedOrder.customFields?.urgency !== 'later' && grabbedOrder.customFields?.urgency && (
              <Tag color="green">⚡立即打</Tag>
            )}
          </div>
        )}
      </Modal>

      {/* Global Chat Modal (opened from notification bell) */}
      <ChatModal
        open={!!globalChatPartner}
        partner={globalChatPartner as any}
        onClose={() => setGlobalChatPartner(null)}
      />

      {/* Command Palette (Ctrl+K) */}
      <CommandPalette open={commandPalette} onClose={() => setCommandPalette(false)} />
    </ChatProvider>
  );
};

export default AppLayout;
