import React, { useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Space, Spin, message, Tag, Modal, Input } from 'antd';
import type { MenuProps } from 'antd';
import { useSocket } from '../hooks/useSocket';
import ErrorBoundary from '../components/ErrorBoundary';

// Badge pulse animation
if (!document.getElementById('badge-pulse-css')) {
  const s = document.createElement('style');
  s.id = 'badge-pulse-css';
  s.textContent = '@keyframes badge-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}.pulse-badge{animation:badge-pulse 0.6s ease-in-out infinite;display:inline-block}';
  document.head.appendChild(s);
}

import { ControlOutlined, StopOutlined, SafetyOutlined, HistoryOutlined,
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
} from '@ant-design/icons';
import { UserRole } from '@chunlv/shared';
import { useAuthStore } from '../stores/authStore';
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
    { key: 'grp-overview', type: 'group', label: '经营概览', children: [
      { key: '/admin', icon: IconDashboard, label: '数据看板' },
      { key: '/admin/traffic', icon: IconTraffic, label: '订单池' },
      { key: '/admin/billing', icon: IconBilling, label: '报账系统' },
    ]},
    { key: 'grp-people', type: 'group', label: '人员管理', children: [
      { key: '/owner/orders', icon: IconOrders, label: '订单管理' },
      { key: '/owner/customers', icon: IconCustomers, label: '客户管理' },
      { key: '/owner/employees', icon: IconEmployees, label: '员工管理' },
      { key: '/owner/review', icon: IconAuth, label: '实名审核' },
    ]},
    { key: 'grp-control', type: 'group', label: '系统管控', children: [
      { key: '/owner/studios', icon: IconStudios, label: '工作室管理' },
      { key: '/owner/authorizations', icon: IconAuth, label: '客户端授权' },
      { key: '/admin/pc-control', icon: IconControl, label: '远程控制' },
      { key: '/admin/blacklist', icon: IconStop, label: '进程黑名单' },
      { key: '/admin/whitelist', icon: IconSafety, label: '进程白名单' },
      { key: '/admin/process-kill-log', icon: IconHistory, label: '杀进程日志' },
      { key: '/admin/attendance', icon: IconClock, label: '考勤管理' },
    ]},
    { key: 'grp-settings', type: 'group', label: '设置', children: [
      { key: '/owner/settings', icon: IconAuth, label: '系统设置' },
    ]},
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
  const { user, isAuthenticated, fetchUser, logout, chatActive, chatPartner, grabbedOrder, setGrabbedOrder } = useAuthStore();
  const [commandPalette, setCommandPalette] = React.useState(false);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPalette(true);
      }
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
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
    onOrderUrgent: (data: any) => {
      if (user?.role === 'COMPANION') setUrgentOrder(data);
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
    const t = setInterval(poll, 1500);
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
      if ((item.label === '陪玩管理' || item.label === '员工管理') && chatActive) {
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
        width={180}
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
                      background: user.avatar ? `url(/uploads/avatars/${user.avatar}?v=${user.avatar}) center/cover` : '#1677ff',
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
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </Content>
      </Layout>
    </Layout>

    {/* Urgent order — idle companion popup */}
    {urgentOrder && !urgentGrabbed && (
      <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999, background: '#FFF', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', padding: 20, minWidth: 320, borderLeft: '4px solid #FF4757' }}>
        <Typography.Text strong style={{ fontSize: 15 }}>⚡ 新订单！{urgentOrder._createdBy || '系统'} 发布</Typography.Text>
        <div style={{ marginTop: 10, lineHeight: 1.8 }}>
          <div>🎮 {urgentOrder.gameName} · <Typography.Text strong style={{ color: '#FF4757' }}>¥{Number(urgentOrder.amount).toFixed(0)}</Typography.Text></div>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button type="primary" size="large" block onClick={async () => {
            try { const { ordersApi } = await import('../api/orders'); const r = await ordersApi.quickGrab(urgentOrder.id); setUrgentGrabbed(r.data.data || urgentOrder); setUrgentOrder(null);
            } catch(e:any) { message.error(e?.response?.data?.message || '已被其他陪玩抢先'); setUrgentOrder(null); }
          }}>同意</Button>
        </div>
      </div>
    )}

    {/* Urgent grab success — solo (non-companion creator) */}
    {urgentGrabbed && urgentGrabbed._creatorRole !== 'COMPANION' && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#FFF', borderRadius: 16, padding: 28, maxWidth: 440, width: '90%' }}>
          <Typography.Title level={4}>🎉 恭喜抢单成功</Typography.Title>
          <div style={{ lineHeight: 2.2, marginTop: 12 }}>
            <div>🎮 {urgentGrabbed.gameName} · ¥{Number(urgentGrabbed.amount).toFixed(0)}</div>
            {urgentGrabbed.customFields?.customerWechat && <div>💬 微信：<Typography.Text copyable>{urgentGrabbed.customFields.customerWechat}</Typography.Text></div>}
            {urgentGrabbed.customFields?.customerRoomCode && <div>🏠 房间码：<Typography.Text copyable>{urgentGrabbed.customFields.customerRoomCode}</Typography.Text></div>}
          </div>
          <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
            <Button size="large" onClick={() => setUrgentGrabbed(null)} style={{ flex: 1 }}>关闭</Button>
            <Button type="primary" size="large" style={{ flex: 1, background: '#52c41a' }} onClick={async () => { try { const { ordersApi } = await import('../api/orders'); await ordersApi.confirm(urgentGrabbed.id); message.success('已开始服务'); setUrgentGrabbed(null); } catch(e:any) { message.error(e?.response?.data?.message); } }}>开始服务</Button>
          </div>
        </div>
      </div>
    )}

    {/* Dual-companion: grabber view (zhangsan) */}
    {urgentGrabbed && urgentGrabbed._creatorRole === 'COMPANION' && user?.id !== urgentGrabbed.csUserId && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#FFF', borderRadius: 16, padding: 28, maxWidth: 460, width: '90%' }}>
          <Typography.Title level={4}>🎉 恭喜抢单成功</Typography.Title>
          <div style={{ lineHeight: 2.2, marginTop: 12 }}>
            <div>🎮 {urgentGrabbed.gameName} · ¥{Number(urgentGrabbed.amount).toFixed(0)}</div>
            {urgentGrabbed.customFields?.customerWechat && <div>💬 微信：<Typography.Text copyable>{urgentGrabbed.customFields.customerWechat}</Typography.Text></div>}
            {urgentGrabbed.customFields?.customerRoomCode && <div>🏠 房间码：<Typography.Text copyable>{urgentGrabbed.customFields.customerRoomCode}</Typography.Text></div>}
          </div>
          <div style={{ marginTop: 16, background: '#f6ffed', borderRadius: 8, padding: 12 }}>
            <Typography.Text strong>🤝 你将与 {urgentGrabbed._createdBy} 一起服务老板</Typography.Text>
            <div style={{ marginTop: 8 }}>
              <Button type="primary" size="large" block onClick={async () => { try { const { ordersApi } = await import('../api/orders'); await ordersApi.markReady(urgentGrabbed.id); message.success('我已准备好'); setDualReady(true); } catch(e:any) { message.error(e?.response?.data?.message); } }}>我已准备好</Button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* Dual-companion: creator view (peiwana) — shows when partner is ready */}
    {urgentGrabbed && urgentGrabbed._creatorRole === 'COMPANION' && user?.id === urgentGrabbed.csUserId && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#FFF', borderRadius: 16, padding: 28, maxWidth: 480, width: '90%' }}>
          <Typography.Title level={4}>🤝 本单将由抢单陪玩跟你一起服务老板</Typography.Title>
          <div style={{ lineHeight: 2.2, marginTop: 12 }}>
            <div>🎮 {urgentGrabbed.gameName} · ¥{Number(urgentGrabbed.amount).toFixed(0)}</div>
            {urgentGrabbed.customFields?.customerWechat && <div>💬 微信：<Typography.Text copyable>{urgentGrabbed.customFields.customerWechat}</Typography.Text></div>}
            {urgentGrabbed.customFields?.customerRoomCode && <div>🏠 房间码：<Typography.Text copyable>{urgentGrabbed.customFields.customerRoomCode}</Typography.Text></div>}
          </div>
          {dualReady ? (
            <div style={{ marginTop: 16 }}>
              <Tag color="green">✅ 合作陪玩已准备就绪</Tag>
              <div style={{ marginTop: 8 }}>
                <Button type="primary" size="large" block style={{ background: '#52c41a' }} onClick={async () => { try { const { ordersApi } = await import('../api/orders'); await ordersApi.confirm(urgentGrabbed.id); message.success('已开始服务'); setUrgentGrabbed(null); setDualReady(null); } catch(e:any) { message.error(e?.response?.data?.message); } }}>开始服务</Button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <Typography.Text type="secondary">⏳ 等待合作陪玩准备就绪...</Typography.Text>
            </div>
          )}
        </div>
      </div>
    )}

      {/* Global Grab Success Modal — survives navigation */}
      <Modal title="抢单成功" open={!!grabbedOrder} onCancel={() => setGrabbedOrder(null)} footer={null} width={480}>
        {grabbedOrder && (
          <div style={{ fontSize: 14, lineHeight: 2 }}>
            <div>📋 {grabbedOrder.gameName} · {orderTypeConfig[grabbedOrder.type]?.label || grabbedOrder.type} · ¥{Number(grabbedOrder.amount).toFixed(0)} · {grabbedOrder.duration}h</div>
            {grabbedOrder.customer?.customerCode && <div>客户编号：{grabbedOrder.customer.customerCode}</div>}
            {grabbedOrder.customFields?.customerSource && <div>来源：{grabbedOrder.customFields.customerSource}</div>}
            {grabbedOrder.customFields?.customerWechat && <div>💬 微信：<Typography.Text copyable>{grabbedOrder.customFields.customerWechat}</Typography.Text></div>}
            {grabbedOrder.customFields?.customerRoomCode && <div>🏠 房间码：<Typography.Text copyable>{grabbedOrder.customFields.customerRoomCode}</Typography.Text></div>}
            {grabbedOrder.customFields?.customerPlatformAccount && <div>🔗 平台号：<Typography.Text copyable>{grabbedOrder.customFields.customerPlatformAccount}</Typography.Text></div>}
            {grabbedOrder.csUser?.username && <div>发布者：{grabbedOrder.csUser.username}</div>}
            {grabbedOrder.customFields?.urgency === 'later' && <Tag color="purple">📅预约</Tag>}
            {grabbedOrder.customFields?.urgency !== 'later' && grabbedOrder.customFields?.urgency && <Tag color="green">⚡立即打</Tag>}
          </div>
        )}
      </Modal>

      {/* Command Palette (Ctrl+K) */}
      <Modal open={commandPalette} onCancel={() => setCommandPalette(false)} footer={null} title="命令面板" width={480}>
        <Input.Search placeholder="搜索页面..." autoFocus onSearch={(v) => {
          const allMenuItems = (roleMenus[user?.role || UserRole.COMPANION] || []).flatMap(g => g.children || [g]);
          const match = allMenuItems.find(m => m.label.toLowerCase().includes(v.toLowerCase()) || m.key.toLowerCase().includes(v.toLowerCase()));
          if (match) { navigate(match.key); setCommandPalette(false); }
        }} />
        <div style={{ marginTop: 12 }}>
          {(roleMenus[user?.role || UserRole.COMPANION] || []).flatMap(g => g.children || [g]).slice(0, 15).map(m => (
            <div key={m.key} style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 6 }}
              onClick={() => { navigate(m.key); setCommandPalette(false); }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f0f0f0'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
              {m.icon} <Text style={{ marginLeft: 8 }}>{m.label}</Text>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
};

export default AppLayout;
