import React, { useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Space, Spin, message } from 'antd';
import type { MenuProps } from 'antd';
import { useSocket } from '../hooks/useSocket';

// Badge pulse animation
if (!document.getElementById('badge-pulse-css')) {
  const s = document.createElement('style');
  s.id = 'badge-pulse-css';
  s.textContent = '@keyframes badge-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}.pulse-badge{animation:badge-pulse 0.6s ease-in-out infinite;display:inline-block}';
  document.head.appendChild(s);
}

import {
  DashboardOutlined,
  DollarOutlined,
  TeamOutlined,
  UserOutlined,
  ShopOutlined,
  KeyOutlined,
  SendOutlined,
  AuditOutlined,
  FileTextOutlined,
  DesktopOutlined,
  FundOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { UserRole } from '@chunlv/shared';
import { useAuthStore } from '../stores/authStore';

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
const IconPc = React.createElement(DesktopOutlined);
const IconLogout = React.createElement(LogoutOutlined);
const IconTraffic = React.createElement(FundOutlined);
const IconFold = React.createElement(MenuFoldOutlined);
const IconUnfold = React.createElement(MenuUnfoldOutlined);

interface MenuItemDef {
  key: string;
  icon: React.ReactNode;
  label: string;
}

const roleMenus: Record<UserRole, MenuItemDef[]> = {
  [UserRole.OWNER]: [
    { key: '/admin', icon: IconDashboard, label: '数据看板' },
    { key: '/owner/orders', icon: IconOrders, label: '订单管理' },
    { key: '/owner/customers', icon: IconCustomers, label: '客户管理' },
    { key: '/owner/employees', icon: IconEmployees, label: '员工管理' },
    { key: '/owner/studios', icon: IconStudios, label: '工作室管理' },
    { key: '/owner/authorizations', icon: IconAuth, label: '客户端授权' },
    { key: '/admin/traffic', icon: IconTraffic, label: '订单池' },
    { key: '/owner/review', icon: IconAuth, label: '实名审核' },
    { key: '/owner/settings', icon: IconAuth, label: '系统设置' },
  ],
  [UserRole.ADMIN]: [
    { key: '/admin', icon: IconDashboard, label: '数据看板' },
    { key: '/admin/dispatch', icon: IconDispatch, label: '派单管理' },
    { key: '/admin/orders', icon: IconOrders, label: '订单管理' },
    { key: '/admin/employees', icon: IconEmployees, label: '员工管理' },
    { key: '/admin/customers', icon: IconCustomers, label: '客户管理' },
    { key: '/admin/traffic', icon: IconTraffic, label: '订单池' },
    { key: '/admin/billing', icon: IconBilling, label: '报账审核' },
    { key: '/admin/pc-control', icon: IconPc, label: '远程控制' },
    { key: '/admin/review', icon: IconAuth, label: '实名审核' },
    { key: '/admin/settings', icon: IconAuth, label: '系统设置' },
  ],
  [UserRole.CS]: [
    { key: '/cs/dispatch', icon: IconDispatch, label: '派单工作台' },
    { key: '/cs/orders', icon: IconOrders, label: '订单管理' },
    { key: '/cs/employees', icon: IconEmployees, label: '员工管理' },
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
  const { user, isAuthenticated, fetchUser, logout, chatActive, chatPartner } = useAuthStore();

  // ── Invite popup (global, for companion) ──
  const [invitePopup, setInvitePopup] = React.useState<any>(null);
  const inviteTRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCompanionRole = user?.role === UserRole.COMPANION;

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!user && isAuthenticated) { fetchUser(); }
  }, []);

  // WebSocket connection for real-time updates
  useSocket({
    onChatNotify: (data: any) => {
      if (data?.companionId) {
        useAuthStore.getState().addChatCompanion(data.companionId);
      }
      if (data?.companionName) {
        useAuthStore.getState().setChatActive(true, data.companionName);
      }
    },
    onOrderNew: (data: any) => {
      if (isCompanionRole && data._isAssignment) {
        setInvitePopup(data);
        if (inviteTRef.current) clearTimeout(inviteTRef.current);
        inviteTRef.current = setTimeout(() => setInvitePopup(null), 15000);
      }
    },
  });

  // Global chat poll — single source of truth for all chat updates
  useEffect(() => {
    if (!user?.studioId) return;
    const seenKeys = new Set<string>();
    const poll = async () => {
      try {
        const res = await fetch('/api/companions/chat-pending', {
          headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
        });
        if (!res.ok) return;
        const { data } = await res.json();

        // Sidebar red dot (always check, regardless of messages)
        if (data?.hasNew) {
          useAuthStore.getState().setChatActive(true, data.companionName);
          if (data.companionId) useAuthStore.getState().addChatCompanion(data.companionId);
        }

        // Process messages if any
        if (data?.messages?.length) {
          for (const m of data.messages) {
            const dedupKey = `${m.text}|${m.time}`;
            if (seenKeys.has(dedupKey)) continue;
            seenKeys.add(dedupKey);

            // Save to localStorage (keyed by orderId to match ChatModal)
            const storageKey = `chat-msgs-${data.orderId || 'global'}`;
            try {
              const existing = JSON.parse(localStorage.getItem(storageKey) || '[]');
              if (!existing.some((em: any) => em.text === m.text && em.time === m.time)) {
                existing.push({ ...m, from: 'them' });
                localStorage.setItem(storageKey, JSON.stringify(existing.slice(-100)));
              }
            } catch {}

            // Dispatch to open ChatModal instances (include orderId for matching)
            window.dispatchEvent(new CustomEvent('chat-message', {
              detail: { text: m.text, time: m.time, orderId: data.orderId, companionId: data.companionId },
            }));
          }
        }

        // Unread badge — only update when there's a new notification from others
        if (data?.hasNew && data?.orderId) {
          try {
            const total = data?.messages?.length || 0;
            const lastSeen = parseInt(localStorage.getItem(`chat-lastRead-${data.orderId}`) || '0', 10);
            const unread = Math.max(0, total - lastSeen);
            // Per-order (companion's pool badge)
            localStorage.setItem(`unread-${data.orderId}`, String(unread));
            // Per-companion (CS's companion list badge)
            if (data?.companionId) {
              localStorage.setItem(`unread-${data.companionId}`, String(unread));
              localStorage.setItem(`last-orderId-${data.companionId}`, data.orderId);
            }
          } catch {}
        }
      } catch {}
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [user?.studioId]);

  useEffect(() => {
    if (!isAuthenticated) { navigate('/login', { replace: true }); return; }
    // Redirect authenticated users from root to their role default page
    if (location.pathname === '/' && user) {
      const defaults: Record<string, string> = { OWNER: '/admin', ADMIN: '/admin', CS: '/cs/dispatch', COMPANION: '/companion' };
      navigate(defaults[user.role] || '/admin', { replace: true });
    }
  }, [isAuthenticated, navigate, user, location.pathname]);

  const menuItems = useMemo(() => {
    if (!user) return [];
    const items = [...(roleMenus[user.role] || [])];
    // Add pulsing indicator to 陪玩管理 items when chat is active
    return items.map(item => {
      if (item.label === '陪玩管理' && chatActive) {
        const name = chatPartner || '?';
        return {
          ...item,
          label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{item.label}
            <span style={{
              width: 20, height: 20, borderRadius: '50%', background: '#FF4757', color: '#FFF',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 800, animation: 'pulse-glow 1s ease-in-out infinite',
              boxShadow: '0 0 10px #FF4757',
            }}>{name[0].toUpperCase()}</span>
          </span>,
        };
      }
      return item;
    });
  }, [user, chatActive]);

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
    <>
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
                <div
                  onClick={() => navigate('/profile')}
                  title="点击进入个人设置（修改头像/名字/密码）"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '2px 8px', borderRadius: 20, transition: 'background 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f0f0f0')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: user.avatar ? `url(/uploads/avatars/${user.avatar}) center/cover` : '#1677ff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {!user.avatar && (
                        <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>
                          {(user.displayName || user.username || '?')[0].toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div style={{
                      position: 'absolute', bottom: -2, right: -2,
                      width: 14, height: 14, borderRadius: '50%', background: '#1677ff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: '2px solid #fff',
                    }}>
                      <span style={{ color: '#fff', fontSize: 8 }}>📷</span>
                    </div>
                  </div>
                  <Text style={{ color: '#1E293B', fontWeight: 500 }}>
                    {user.displayName || user.username}
                  </Text>
                </div>
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

    {/* Invite popup — bottom-right */}
    {invitePopup && (
      <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999, background: '#FFF', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', padding: 20, minWidth: 320, maxWidth: 380, borderLeft: '4px solid #7B61FF' }}>
        <Typography.Text strong style={{ fontSize: 15 }}>📋 {invitePopup._inviterName || '客服'} 邀请你共同接单</Typography.Text>
        <div style={{ marginTop: 10, lineHeight: 1.8 }}>
          <div>🎮 游戏：<Typography.Text strong>{invitePopup.gameName}</Typography.Text> · <Typography.Text strong style={{ color: '#FF4757' }}>¥{Number(invitePopup.amount).toFixed(0)}</Typography.Text></div>
          {invitePopup.customFields?.deltaMode && <div>🎯 模式：{invitePopup.customFields.deltaMode} {invitePopup.customFields.deltaMission || ''} {invitePopup.customFields.deltaCount || ''}</div>}
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <Button danger size="small" onClick={async () => { try { const { ordersApi } = await import('../api/orders'); await ordersApi.declineAssignment(invitePopup.id); message.success('已拒绝'); setInvitePopup(null); } catch(e:any) { message.error(e?.response?.data?.message); } }} style={{ flex: 1 }}>拒绝</Button>
          <Button type="primary" size="small" onClick={async () => { try { const { ordersApi } = await import('../api/orders'); await ordersApi.acceptAssignment(invitePopup.id); message.success('已接单'); setInvitePopup(null); } catch(e:any) { message.error(e?.response?.data?.message); } }} style={{ flex: 1 }}>接单</Button>
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 6 }}>⏱ 15 秒后自动消失</Typography.Text>
      </div>
    )}
    </>
  );
};

export default AppLayout;
