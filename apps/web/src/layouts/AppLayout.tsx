// craftsman-ignore: TS001,TS002
import React, { useEffect, useMemo, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Space, Spin, Tag, Modal, Badge, Popover, message, notification, Form, Input } from 'antd';
import type { MenuProps } from 'antd';
import { useSocket } from '../hooks/useSocket';
import { usePolling } from '../hooks/usePolling';
import http from '../api/client';
import { ordersApi } from '../api/orders';
// useChatNotification → now handled by ChatProvider
import ErrorBoundary from '../components/ErrorBoundary';
import UrgentOrderPopup from '../components/UrgentOrderPopup';
import { ChatProvider } from '../components/chat';
import { commander } from '../styles/commander';
import CommandPalette from '../components/CommandPalette';
import ChatModal from '../components/ChatModal';
import IncomingCallModal from '../components/IncomingCallModal';
import VoiceCallBar from '../components/VoiceCallBar';
import { useVoiceCall } from '../hooks/useVoiceCall';
import { showSystemNotification, playNotificationSound } from '../utils/notify';
import ServiceStartOverlay from '../components/ServiceStartOverlay';
// FloatingChatWidget removed — redundant with bell notification
import { ConversationList } from '../components/ConversationList';
import LeftMessagePanel from '../components/LeftMessagePanel';
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

// 侧边栏子菜单展开后保持透明，避免出现白色背景
if (!document.getElementById('menu-sub-bg-css')) {
  const s3 = document.createElement('style');
  s3.id = 'menu-sub-bg-css';
  s3.textContent =
    '.ant-layout-sider .ant-menu, .ant-layout-sider .ant-menu-item, .ant-menu-sub .ant-menu-item, .ant-layout-sider .ant-menu-submenu-title, .ant-layout-sider .ant-menu-item:hover, .ant-layout-sider .ant-menu-item-active, .ant-layout-sider .ant-menu-item-selected, .ant-layout-sider .ant-menu-submenu-selected > .ant-menu-submenu-title, .ant-layout-sider .ant-menu-submenu-title:hover { background: transparent !important; background-color: transparent !important; } ' +
    '.ant-layout-sider .ant-menu-sub, .ant-layout-sider .ant-menu-submenu > .ant-menu, .ant-layout-sider .ant-menu-inline .ant-menu-sub, .ant-menu-dark .ant-menu-sub, .ant-menu-dark .ant-menu-submenu-popup, .ant-menu-dark .ant-menu-submenu > .ant-menu { background: #0b1024 !important; background-color: #0b1024 !important; }';
  document.head.appendChild(s3);
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
  PictureOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ClockCircleOutlined,
  BellOutlined,
  MessageOutlined,
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
const IconPicture = React.createElement(PictureOutlined);
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
      key: 'owner-home', icon: IconDashboard, label: '首页',
      children: [
        { key: '/admin', label: '数据看板' },
      ],
    },
    {
      key: 'owner-dispatch', icon: IconDispatch, label: '派单管理',
      children: [
        { key: '/admin/dispatch', label: '派单工作台' },
      ],
    },
    {
      key: 'owner-orders', icon: IconOrders, label: '订单管理',
      children: [
        { key: '/owner/orders', label: '全部订单' },
      ],
    },
    {
      key: 'owner-customers', icon: IconCustomers, label: '客户管理',
      children: [
        { key: '/owner/customers', label: '客户列表' },
      ],
    },
    {
      key: 'owner-employees', icon: IconEmployees, label: '员工管理',
      children: [
        {
          key: 'owner-admin-mgmt', label: '店长管理',
          children: [
            { key: '/owner/employees?role=ADMIN', label: '店长列表' },
          ],
        },
        {
          key: 'owner-companion-mgmt', label: '陪玩管理',
          children: [
            { key: '/admin/companions?role=COMPANION', label: '陪玩列表' },
            { key: '/owner/work-wechats?type=COMPANION', label: '陪玩工作微信' },
            { key: '/admin/battle-screenshots', label: '战绩图审核' },
          ],
        },
        {
          key: 'owner-cs-mgmt', label: '客服管理',
          children: [
            { key: '/owner/employees?role=CS', label: '客服列表' },
            { key: '/owner/work-wechats?type=STUDIO', label: '客服工作微信' },
            { key: '/admin/traffic-accounts', label: '工作室账号管理' },
            { key: '/content-check', label: '内容查重风控' },
          ],
        },
        { key: '/owner/review', label: '实名审核' },
        { key: '/admin/attendance', label: '考勤管理' },
      ],
    },
    {
      key: 'owner-finance', icon: IconRevenue, label: '财务管理',
      children: [
        { key: '/admin/profit-calendar', label: '财务中心' },
        {
          key: 'owner-companion-salary', label: '陪玩工资管理',
          children: [
            { key: '/admin/finance/expenses', label: '陪玩审核 + 支取' },
            {
              key: 'owner-companion-reconciliation', label: '陪玩报账对账',
              children: [
                { key: '/admin/finance/reconciliation', label: '应报 vs 实报' },
                { key: '/admin/companion-wallet-calendar', label: '报账与支取日历' },
              ],
            },
            { key: '/admin/finance/risk', label: '打私单风险' },
          ],
        },
        {
          key: 'owner-cs-finance', label: '客服财务管理',
          children: [
            {
              key: 'owner-cs-commission', label: '客服提成',
              children: [
                { key: '/admin/finance/commission-today', label: '今日看板' },
                { key: '/admin/finance/commission', label: '月度结算' },
              ],
            },
            { key: '/admin/cs-wechat-flow', label: '客服微信收款明细' },
          ],
        },
      ],
    },
    {
      key: 'owner-shop', icon: IconStudios, label: '店铺管理',
      children: [
        { key: '/owner/studios', label: '工作室管理' },
        { key: '/owner/bridges', label: '工作室桥接' },
        { key: '/owner/authorizations', label: '客户端授权' },
      ],
    },
    {
      key: 'owner-settings', icon: IconAuth, label: '设置中心',
      children: [
        {
          key: '系统与规则', label: '系统与规则',
          children: [
            { key: '/owner/settings', label: '系统配置' },
            { key: '/admin/cs-settings', label: '客服设置' },
            { key: '/admin/store-manager-settings', label: '店长设置' },
            { key: '/admin/payroll', label: '工资规则' },
            { key: '/admin/profit-split', label: '利润分成' },
            { key: '/admin/finance/price-rules', label: '价格规则' },
          ],
        },
        {
          key: '客户端与设备', label: '客户端与设备',
          children: [
            { key: '/admin/managed-pcs', label: '电脑管理' },
            { key: '/admin/pc-control', label: '远程控制' },
            { key: '/admin/agent-version', label: '客户端版本' },
            { key: '/admin/blacklist', label: '进程黑名单' },
            { key: '/admin/whitelist', label: '进程白名单' },
            { key: '/admin/process-kill-log', label: '杀进程日志' },
          ],
        },
      ],
    },
  ],
  [UserRole.ADMIN]: [
    {
      key: 'admin-home', icon: IconDashboard, label: '首页',
      children: [
        { key: '/admin', label: '数据看板' },
      ],
    },
    {
      key: 'admin-dispatch', icon: IconDispatch, label: '派单管理',
      children: [
        { key: '/admin/dispatch', label: '派单工作台' },
      ],
    },
    {
      key: 'admin-orders', icon: IconOrders, label: '订单管理',
      children: [
        { key: '/admin/orders', label: '全部订单' },
      ],
    },
    {
      key: 'admin-customers', icon: IconCustomers, label: '客户管理',
      children: [
        { key: '/admin/customers', label: '客户列表' },
      ],
    },
    {
      key: 'admin-employees', icon: IconEmployees, label: '员工管理',
      children: [
        {
          key: 'admin-companion-mgmt', label: '陪玩管理',
          children: [
            { key: '/admin/companions?role=COMPANION', label: '陪玩列表' },
            { key: '/admin/work-wechats?type=COMPANION', label: '陪玩工作微信' },
            { key: '/admin/battle-screenshots', label: '战绩图审核' },
          ],
        },
        {
          key: 'admin-cs-mgmt', label: '客服管理',
          children: [
            { key: '/admin/employees?role=CS', label: '客服列表' },
            { key: '/admin/work-wechats?type=STUDIO', label: '客服工作微信' },
            { key: '/admin/traffic-accounts', label: '工作室账号管理' },
            { key: '/content-check', label: '内容查重风控' },
          ],
        },
        { key: '/admin/review', label: '实名审核' },
        { key: '/admin/attendance', label: '考勤管理' },
      ],
    },
    {
      key: 'admin-finance', icon: IconRevenue, label: '财务管理',
      children: [
        { key: '/admin/profit-calendar', label: '财务中心' },
        {
          key: 'admin-companion-salary', label: '陪玩工资管理',
          children: [
            { key: '/admin/finance/expenses', label: '陪玩审核 + 支取' },
            {
              key: 'admin-companion-reconciliation', label: '陪玩报账对账',
              children: [
                { key: '/admin/finance/reconciliation', label: '应报 vs 实报' },
                { key: '/admin/companion-wallet-calendar', label: '报账与支取日历' },
              ],
            },
            { key: '/admin/finance/risk', label: '打私单风险' },
          ],
        },
        {
          key: 'admin-cs-finance', label: '客服财务管理',
          children: [
            {
              key: 'admin-cs-commission', label: '客服提成',
              children: [
                { key: '/admin/finance/commission-today', label: '今日看板' },
                { key: '/admin/finance/commission', label: '月度结算' },
              ],
            },
            { key: '/admin/cs-wechat-flow', label: '客服微信收款明细' },
          ],
        },
      ],
    },
    {
      key: 'admin-settings', icon: IconAuth, label: '设置中心',
      children: [
        {
          key: '系统与规则', label: '系统与规则',
          children: [
            { key: '/admin/settings', label: '系统配置' },
            { key: '/admin/cs-settings', label: '客服设置' },
            { key: '/admin/store-manager-settings', label: '店长设置' },
            { key: '/admin/payroll', label: '工资规则' },
            { key: '/admin/profit-split', label: '利润分成' },
            { key: '/admin/finance/price-rules', label: '价格规则' },
            { key: '/owner/bridges', label: '工作室桥接' },
          ],
        },
        {
          key: '客户端与设备', label: '客户端与设备',
          children: [
            { key: '/admin/managed-pcs', label: '电脑管理' },
            { key: '/admin/pc-control', label: '远程控制' },
            { key: '/admin/agent-version', label: '客户端版本' },
            { key: '/admin/blacklist', label: '进程黑名单' },
            { key: '/admin/whitelist', label: '进程白名单' },
            { key: '/admin/process-kill-log', label: '杀进程日志' },
          ],
        },
      ],
    },
  ],
  [UserRole.CS]: [
    {
      key: 'cs-home', icon: IconDashboard, label: '首页',
      children: [{ key: '/cs/stats', label: '每日统计' }],
    },
    {
      key: 'cs-dispatch', icon: IconDispatch, label: '派单管理',
      children: [{ key: '/cs/dispatch', label: '派单工作台' }],
    },
    {
      key: 'cs-orders', icon: IconOrders, label: '订单管理',
      children: [{ key: '/cs/orders', label: '全部订单' }],
    },
    {
      key: 'cs-customers', icon: IconCustomers, label: '客户管理',
      children: [
        { key: '/cs/customers', label: '客户列表' },
      ],
    },
    {
      key: 'cs-employees', icon: IconEmployees, label: '员工管理',
      children: [
        {
          key: 'cs-companion-mgmt', label: '陪玩管理',
          children: [
            { key: '/cs/employees', label: '人员管理' },
            { key: '/cs/work-wechats?type=COMPANION', label: '陪玩工作微信' },
          ],
        },
        {
          key: 'cs-cs-mgmt', label: '客服管理',
          children: [
            { key: '/cs/work-wechats?type=STUDIO', label: '客服工作微信' },
            { key: '/cs/traffic-accounts', label: '工作室账号管理' },
            { key: '/content-check', label: '内容查重风控' },
          ],
        },
      ],
    },
    {
      key: 'cs-finance', icon: IconRevenue, label: '财务管理',
      children: [
        { key: '/cs/billing', label: '报账系统' },
      ],
    },
    {
      key: 'cs-settings', icon: IconAuth, label: '设置',
      children: [
        { key: '/profile', label: '个人设置' },
      ],
    },
  ],
  [UserRole.COMPANION]: [
    {
      key: 'companion-home', icon: IconDashboard, label: '首页',
      children: [{ key: '/companion', label: '我的首页' }],
    },
    {
      key: 'companion-dispatch', icon: IconDispatch, label: '派单管理',
      children: [{ key: '/companion/pool', label: '订单池' }],
    },
    {
      key: 'companion-orders', icon: IconOrders, label: '订单管理',
      children: [{ key: '/companion/orders', label: '我的订单' }],
    },
    {
      key: 'companion-customers', icon: IconCustomers, label: '客户管理',
      children: [{ key: '/companion/customers', label: '我的客户' }],
    },
    {
      key: 'companion-battle-screenshots', icon: IconPicture, label: '战绩图上传',
      children: [{ key: '/companion/battle-screenshots', label: '上传战绩图' }],
    },
    {
      key: 'companion-finance', icon: IconRevenue, label: '财务管理',
      children: [
        { key: '/companion/billing', label: '报账系统' },
        { key: '/companion/wallet-calendar', label: '报账与支取日历' },
        { key: '/companion/stats', label: '每日统计' },
      ],
    },
    {
      key: 'companion-settings', icon: IconAuth, label: '设置',
      children: [{ key: '/profile', label: '个人设置' }],
    },
  ],
};

const roleLabels: Record<UserRole, string> = {
  [UserRole.OWNER]: '老板',
  [UserRole.ADMIN]: '店长',
  [UserRole.CS]: '客服',
  [UserRole.COMPANION]: '陪玩',
};

const InviteCountdown: React.FC<{ seconds: number }> = ({ seconds }) => {
  const [left, setLeft] = React.useState(seconds);
  React.useEffect(() => {
    const t = setInterval(() => setLeft((v) => (v <= 1 ? 0 : v - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span style={{ color: '#f5222d', fontWeight: 600 }}>⏳ {left} 秒后自动取消</span>
  );
};

function loadSeenCount(key: string): number {
  try {
    const v = parseInt(localStorage.getItem(key) || '0', 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = React.useState(false);
  const [isCompact, setIsCompact] = React.useState(() => typeof window !== 'undefined' && window.innerWidth <= 1080);
  const [messagePanelCollapsed, setMessagePanelCollapsed] = React.useState(true);
  const { user, isAuthenticated, fetchUser, logout } = useAuthStore();
  const [studioBrand, setStudioBrand] = React.useState<{ name: string; logo?: string } | null>(null);
  const [appVersion, setAppVersion] = React.useState('');
  const [webBuild, setWebBuild] = React.useState('');
  const [myCommission, setMyCommission] = React.useState<number | null>(null);
  const [mySalary, setMySalary] = React.useState<any>(null);
  const [salaryOpen, setSalaryOpen] = React.useState(false);
  const isCsClient = typeof window !== 'undefined'
    && !!(window as any).electronAPI
    && !(window as any).electronAPI?.getSavedCredentials
    && !(window as any).electronAPI?.onStatusChanged;
  useEffect(() => {
    const api = (window as any).electronAPI;
    api?.getAppVersion?.().then((v: string) => setAppVersion(v || '')).catch(() => {});
  }, []);
  useEffect(() => {
    const pageStartedAt = Date.now();
    const send = () => {
      http
        .post('/agent/heartbeat', { agentVersion: appVersion || undefined })
        .then((res: any) => {
          const id = res?.data?.data?.webBuildId;
          if (!id) return;
          setWebBuild(id);
          const prev = localStorage.getItem('webBuildId');
          if (!prev) {
            localStorage.setItem('webBuildId', id);
            return;
          }
          if (prev === id) return;
          // 有新版本前端页面。以前这里无条件刷新，服务端每重启一次大家就整页刷一次，
          // 看起来就是「动不动掉线」。现在：服务中不刷、刚打开页面先等一会儿、5 分钟内只刷一次。
          if (res?.data?.data?.inService) return;
          if (Date.now() - pageStartedAt < 120_000) return;
          const lastReloadAt = Number(localStorage.getItem('webBuildReloadAt') || 0);
          if (Date.now() - lastReloadAt < 5 * 60_000) return;
          localStorage.setItem('webBuildId', id);
          localStorage.setItem('webBuildReloadAt', String(Date.now()));
          window.location.reload();
        })
        .catch(() => {});
    };
    send();
    // 前端版本检查：每 60 秒一次；页面不可见（最小化 / 切到后台）时跳过。
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') send();
    }, 60_000);
    return () => clearInterval(timer);
  }, [appVersion]);
  useEffect(() => {
    if (user?.role === 'CS') {
      http
        .get('/finance/commission/my-month')
        .then(({ data }: any) => {
          const rows = data?.data?.rows;
          setMyCommission(rows?.[0]?.totalYuan ?? 0);
        })
        .catch(() => {});
      http
        .get('/finance/commission/my-salary')
        .then(({ data }: any) => setMySalary(data?.data || null))
        .catch(() => {});
    }
  }, [user?.role]);
  useEffect(() => {
    if (user?.studioId) {
      http
        .get('/studios/public')
        .then(({ data }) => {
          const s = (data.data || []).find((s: any) => s.id === user.studioId);
          if (s) setStudioBrand({ name: s.name });
        })
        .catch(() => {});
    }
  }, [user?.studioId]);

  // 客服端/陪玩端版本上报，让管理端能直接看到各客户端版本
  useEffect(() => {
    if (!user?.id) return;
    if (user.role === 'COMPANION') return; // 陪玩端走 /agent/heartbeat + WebSocket，不报 cs-heartbeat
    const api = (window as any).electronAPI;
    if (!api?.getAppVersion) return;
    const report = () => {
      api.getAppVersion().then((v: string) => {
        http.post('/agent/cs-heartbeat', { agentVersion: v }).catch(() => {});
      }).catch(() => {});
    };
    report();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') report();
    }, 60_000);
    return () => clearInterval(timer);
  }, [user?.id, user?.role]);
  const totalUnread = useChatStore((s) => s.totalUnread);
  const conversations = useChatStore((s) => s.conversations);
  const conversationOrder = useChatStore((s) => s.conversationOrder);
  const groupUnread = useMemo(
    () =>
      conversationOrder.reduce((sum, id) => {
        const conv = conversations[id];
        if (conv && (conv.isGroup || conv.participant?.role === 'GROUP')) {
          return sum + (conv.unreadCount || 0);
        }
        return sum;
      }, 0),
    [conversations, conversationOrder],
  );
  // 群聊未读只展示在左侧消息面板，不再计入铃铛和导航聊天角标。
  const directUnread = Math.max(0, totalUnread - groupUnread);
  const { grabbedOrder, setGrabbedOrder } = useOrderStore();
  const [commandPalette, setCommandPalette] = React.useState(false);

  // Notification bell
  const [notifOpen, setNotifOpen] = React.useState(false);
  // Global chat modal (opened from notification bell)
  const [globalChatPartner, setGlobalChatPartner] = React.useState<{
    conversationId: string;
    participant?: { userId: string; username: string; displayName?: string; avatar?: string; role: string };
    orderInfo?: string | null;
  } | null>(null);
  // Badge: raw count from API, with seen-tracking via ref (not state)
  const [pendingBadge, setPendingBadge] = React.useState(0);
  const seenRef = React.useRef(0);

  useEffect(() => {
    if (user?.role !== 'OWNER' && user?.role !== 'ADMIN') return;
    const seenKey = `pending-seen-${user?.id || 'anon'}`;
    seenRef.current = loadSeenCount(seenKey);
    const doFetch = async () => {
      try {
        const { data } = await http.get('/users/pending-review');
        const total = (data.data || []).length;
        if (seenRef.current > total) {
          seenRef.current = total;
          localStorage.setItem(seenKey, String(total));
        }
        setPendingBadge(Math.max(0, total - seenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(() => { if (document.visibilityState === 'visible') doFetch(); }, 120000);
    return () => clearInterval(t);
  }, [user?.role, user?.id]);

  // Bridge pending badge for ADMIN (same pattern as pendingBadge above)
  const [bridgePendingBadge, setBridgePendingBadge] = React.useState(0);
  const bridgeSeenRef = React.useRef(0);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    const seenKey = `bridge-pending-seen-${user?.id || 'anon'}`;
    bridgeSeenRef.current = loadSeenCount(seenKey);
    const doFetch = async () => {
      try {
        const { data } = await http.get('/bridges');
        const pending = data.data?.pending || [];
        const total = pending.length;
        if (bridgeSeenRef.current > total) {
          bridgeSeenRef.current = total;
          localStorage.setItem(seenKey, String(total));
        }
        setBridgePendingBadge(Math.max(0, total - bridgeSeenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(() => { if (document.visibilityState === 'visible') doFetch(); }, 120000);
    return () => clearInterval(t);
  }, [user?.role, user?.id]);

  // Billing pending badge (报账审核 + 支出审批 + 支取审批)
  const [billingBadge, setBillingBadge] = React.useState(0);
  const billingSeenRef = React.useRef(0);

  useEffect(() => {
    if (user?.role !== 'OWNER' && user?.role !== 'ADMIN' && user?.role !== 'CS') return;
    const seenKey = `billing-pending-seen-${user?.id || 'anon'}`;
    billingSeenRef.current = loadSeenCount(seenKey);
    const doFetch = async () => {
      try {
        const { data } = await http.get('/billing/pending-count');
        const total = data.data?.total || 0;
        if (billingSeenRef.current > total) {
          billingSeenRef.current = total;
          localStorage.setItem(seenKey, String(total));
        }
        setBillingBadge(Math.max(0, total - billingSeenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(() => { if (document.visibilityState === 'visible') doFetch(); }, 120000);
    return () => clearInterval(t);
  }, [user?.role, user?.id]);

  // 工作抽查 badge（ADMIN/OWNER）
  const [reviewBadge, setReviewBadge] = React.useState(0);
  const reviewSeenRef = React.useRef(0);
  useEffect(() => {
    if (user?.role !== 'OWNER' && user?.role !== 'ADMIN') return;
    const doFetch = async () => {
      try {
        const { data } = await http.get('/admin/review-queue-count');
        const count = data.data?.count || 0;
        if (reviewSeenRef.current > count) {
          reviewSeenRef.current = count;
        }
        setReviewBadge(Math.max(0, count - reviewSeenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(() => { if (document.visibilityState === 'visible') doFetch(); }, 120000);
    return () => clearInterval(t);
  }, [user?.role]);

  const markReviewSeen = () => {
    setReviewBadge((prev) => {
      const total = prev + reviewSeenRef.current;
      reviewSeenRef.current = total;
      return 0;
    });
  };

  const markBillingSeen = () => {
    const seenKey = `billing-pending-seen-${user?.id || 'anon'}`;
    setBillingBadge((prev) => {
      const total = prev + billingSeenRef.current;
      billingSeenRef.current = total;
      localStorage.setItem(seenKey, String(total));
      return 0;
    });
  };

  const markBridgeSeen = () => {
    const seenKey = `bridge-pending-seen-${user?.id || 'anon'}`;
    setBridgePendingBadge((prev) => {
      const total = prev + bridgeSeenRef.current;
      bridgeSeenRef.current = total;
      localStorage.setItem(seenKey, String(total));
      return 0;
    });
  };

  const markSeen = () => {
    // Read current total from state to set seen
    const seenKey = `pending-seen-${user?.id || 'anon'}`;
    setPendingBadge((prev) => {
      const total = prev + seenRef.current; // reconstruct: badge + seen = total
      seenRef.current = total;
      localStorage.setItem(seenKey, String(total));
      return 0;
    });
  };

  // Contact pending badge (联系状态待处理 — for CS/ADMIN/OWNER)
  const [contactBadge, setContactBadge] = React.useState(0);
  const contactSeenRef = React.useRef(0);

  useEffect(() => {
    if (user?.role !== 'OWNER' && user?.role !== 'ADMIN' && user?.role !== 'CS') return;
    const seenKey = `contact-pending-seen-${user?.id || 'anon'}`;
    contactSeenRef.current = loadSeenCount(seenKey);
    const doFetch = async () => {
      try {
        const { data } = await http.get('/orders/pending-contact-count');
        const total = data?.data || 0;
        if (contactSeenRef.current > total) {
          contactSeenRef.current = total;
          localStorage.setItem(seenKey, String(total));
        }
        setContactBadge(Math.max(0, total - contactSeenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(() => { if (document.visibilityState === 'visible') doFetch(); }, 120000);
    return () => clearInterval(t);
  }, [user?.role, user?.id]);

  const markContactSeen = () => {
    const seenKey = `contact-pending-seen-${user?.id || 'anon'}`;
    setContactBadge((prev) => {
      const total = prev + contactSeenRef.current;
      contactSeenRef.current = total;
      localStorage.setItem(seenKey, String(total));
      return 0;
    });
  };

  // 陪玩待开始订单角标：已抢单/已确认但还没点首单的订单数（订单管理菜单红点）
  const [pendingStartBadge, setPendingStartBadge] = React.useState(0);
  const pendingStartSeenRef = React.useRef(0);

  useEffect(() => {
    if (user?.role !== 'COMPANION') return;
    const seenKey = `pending-start-seen-${user?.id || 'anon'}`;
    pendingStartSeenRef.current = loadSeenCount(seenKey);
    const doFetch = async () => {
      try {
        const { data } = await http.get('/orders/pending-start');
        const total = (data?.data || []).length;
        if (pendingStartSeenRef.current > total) {
          pendingStartSeenRef.current = total;
          localStorage.setItem(seenKey, String(total));
        }
        setPendingStartBadge(Math.max(0, total - pendingStartSeenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(() => { if (document.visibilityState === 'visible') doFetch(); }, 60000);
    return () => clearInterval(t);
  }, [user?.role, user?.id]);

  const markPendingStartSeen = () => {
    const seenKey = `pending-start-seen-${user?.id || 'anon'}`;
    setPendingStartBadge((prev) => {
      const total = prev + pendingStartSeenRef.current;
      pendingStartSeenRef.current = total;
      localStorage.setItem(seenKey, String(total));
      return 0;
    });
  };

  // Chat 3.0: notification handled by ChatProvider

  // Listen for open-chat-modal event from CSDispatchView
  useEffect(() => {
    const handler = (e: CustomEvent) => setGlobalChatPartner(e.detail);
    window.addEventListener('open-chat-modal', handler as EventListener);
    return () => window.removeEventListener('open-chat-modal', handler as EventListener);
  }, []);

  // Open chat from notification
  const openChatFromNotification = useCallback((conversationId: string, participantName: string) => {
    const conv = useChatStore.getState().conversations[conversationId];
    setNotifOpen(false);
    setGlobalChatPartner({
      conversationId,
      participant: conv?.participant || {
        // 未知对方时不要用 roomId 冒充 userId，否则会在服务端建出幽灵会话。
        userId: '',
        username: participantName,
        role: '',
      },
      // 从铃铛进入时不要主动清掉已有订单上下文；若是从订单沟通发起的会话，双方仍应看到该订单信息。
      orderInfo: conv?.orderInfo,
    });
    useChatStore.getState().markRead(conversationId);
  }, []);

  // Open the studio group chat from the persistent left-side message panel.
  const openGroupChat = useCallback((conversationId: string, groupName: string) => {
    const conv = useChatStore.getState().conversations[conversationId];
    setGlobalChatPartner({
      conversationId,
      participant: conv?.participant || {
        userId: '',
        username: groupName,
        displayName: groupName,
        role: 'GROUP',
      },
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
      const compact = window.innerWidth <= 1080;
      setIsCompact(compact);
      if (compact) setMessagePanelCollapsed(true);
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
  // 待处理搭档邀请（弹窗消失后仍能在右上角铃铛里找到）
  const [partnerInvites, setPartnerInvites] = React.useState<any[]>([]);
  const [partnerInviteOpen, setPartnerInviteOpen] = React.useState(false);
  const [partnerInviteModalOpen, setPartnerInviteModalOpen] = React.useState(false);

  const addPartnerInvite = React.useCallback((invite: any) => {
    setPartnerInvites((prev) => {
      const exists = prev.some((p) => p.sessionId === invite.sessionId);
      if (exists) return prev;
      return [...prev, invite];
    });
  }, []);

  const removePartnerInvite = React.useCallback((sessionId: string) => {
    setPartnerInvites((prev) => prev.filter((p) => p.sessionId !== sessionId));
  }, []);

  // 自动清理已过期的搭档邀请，避免铃铛里残留。
  useEffect(() => {
    const t = setInterval(() => {
      setPartnerInvites((prev) => {
        const now = Date.now();
        const next = prev.filter((p) => p.expiresAt > now);
        return next.length === prev.length ? prev : next;
      });
    }, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user && isAuthenticated) {
      fetchUser();
    }
  }, []);

  // WebSocket connection for real-time updates
  const voiceSocketRef = useSocket({
    onOrderNew: (data: any) => {
      if (data?.type !== 'DUAL_INVITE') {
        // 非搭档邀请的 order:new 通常就是“新订单进池/广播”，
        // 让已挂载的订单池页面立即刷新，和弹窗保持同步。
        if (data?.dispatchType === 'POOL' || data?.dispatchType === 'BROADCAST' || data?._notify) {
          window.dispatchEvent(new Event('chunlv:order-pool-updated'));
        }
        return;
      }
      if (!user?.companionId || data?.coCompanionId !== user.companionId) return;
      const inviter = data.inviterName || '有陪玩';
      const desc = `${inviter}邀请你搭档服务：${data.gameName || ''} · 搭档金额 ¥${Number((data.coAmount ?? data.amount) || 0).toFixed(1)} · ${data.duration || 1}h`;
      const ttl = data.expiresInSec ?? 15;
      addPartnerInvite({
        sessionId: data.id,
        inviterName: inviter,
        gameName: data.gameName || '',
        amount: Number((data.coAmount ?? data.amount) || 0),
        duration: data.duration || 1,
        expiresAt: Date.now() + ttl * 1000,
      });
      setPartnerInviteModalOpen(true);
      showSystemNotification('蠢驴电竞 · 搭档邀请', desc);
      playNotificationSound();
    },
    onPartnerAccepted: (data: any) => {
      notification.success({
        message: '✅ 搭档已同意',
        description: '开始计时，进入接单中，用心服务',
        placement: 'bottomRight',
        duration: 4,
      });
      (window as any).electronAPI?.sessionWatch?.(data.sessionId);
      window.dispatchEvent(new Event('chunlv:service-started'));
    },
    onPartnerRejected: (data: any) => {
      notification.warning({
        message: '🙅 搭档已拒绝',
        description: `${data?.partnerName || '搭档'} 拒绝了你的搭档邀请`,
        placement: 'bottomRight',
        duration: 4,
      });
      window.dispatchEvent(new Event('chunlv:dual-invite-expired'));
    },
    onPartnerTimeout: (data: any) => {
      notification.info({
        message: '⏰ 搭档未回应',
        description: '搭档在倒计时内未回应，邀请已自动取消',
        placement: 'bottomRight',
        duration: 4,
      });
      window.dispatchEvent(new Event('chunlv:dual-invite-expired'));
    },
    onDualInvite: (data: any) => {
      // 广播找搭档：主陪未指定搭档，工作室任意陪玩可接受，第一个接受者成为搭档
      if (!user?.companionId || !data?.sessionId) return;
      if (data?.companionId === user.companionId) return; // 主陪自己不看自己的广播
      const inviter = data.inviterName || '有陪玩';
      const desc = `${inviter}广播找搭档：${data.gameName || ''} · 搭档金额 ¥${Number(data.amount || 0).toFixed(1)} · ${data.duration || 1}h`;
      const ttl = data.expiresInSec ?? 15;
      addPartnerInvite({
        sessionId: data.sessionId,
        inviterName: inviter,
        gameName: data.gameName || '',
        amount: Number(data.amount || 0),
        duration: data.duration || 1,
        expiresAt: Date.now() + ttl * 1000,
      });
      setPartnerInviteModalOpen(true);
      showSystemNotification('蠢驴电竞 · 找搭档邀请', desc);
      playNotificationSound();
    },
    onDualInviteExpired: (data: any) => {
      const sid = data?.sessionId;
      if (sid) {
        notification.destroy(`dual-invite-${sid}`);
        notification.destroy(`dual-broadcast-${sid}`);
        removePartnerInvite(sid);
      }
      window.dispatchEvent(new Event('chunlv:dual-invite-expired'));
    },
    onServiceHandoff: (data: any) => {
      // 换主陪：原主陪把订单交给自己启动，这里开启自己的计时和工作记录
      notification.success({
        message: '🤝 有陪玩把订单交给你',
        description: '已进入接单中，用心服务',
        placement: 'bottomRight',
        duration: 4,
      });
      (window as any).electronAPI?.sessionWatch?.(data?.sessionId);
      window.dispatchEvent(new Event('chunlv:service-started'));
    },
    onSegmentFinished: (data: any) => {
      const amount = Number(data?.amount || 0).toFixed(1);
      const desc = data?.message || `你这一段服务已结束，本段计入流水 ¥${amount}`;
      notification.info({
        message: '🏁 这一段服务已结束',
        description: desc,
        placement: 'bottomRight',
        duration: 6,
      });
      showSystemNotification('蠢驴电竞 · 服务结束', desc);
    },
    onServiceDurationReminder: (data: any) => {
      const desc = data?.message || '服务时间已到，请引导客户续单';
      notification.warning({
        message: '⏰ 时间到了',
        description: desc,
        placement: 'bottomRight',
        duration: 5,
      });
      showSystemNotification('蠢驴电竞 · 时间提醒', desc);
    },
    onOrderPoolUpdated: () => {
      window.dispatchEvent(new Event('chunlv:order-pool-updated'));
    },
    // 群聊广播：客服/店长发广播后，陪玩电脑右下角弹 Windows 提醒，5 秒后自动消失
    onChatBroadcast: (data: any) => {
      if (user?.role !== 'COMPANION') return;
      const senderName = data?.senderName || '客服';
      const content = String(data?.content || '').trim();
      if (!content) return;
      const title = `📢 ${senderName} 广播`;
      const electronApi = (window as any).electronAPI;
      if (electronApi?.broadcastPopup) {
        // 陪玩端：交给 Electron 主进程画一个置顶窗口，最小化/全屏时也能看到
        try {
          electronApi.broadcastPopup({ title, body: content });
        } catch {
          /* ignore */
        }
      } else {
        // 浏览器里打开时的兜底
        notification.warning({
          message: title,
          description: content,
          placement: 'bottomRight',
          duration: 5,
        });
      }
      playNotificationSound();
    },
    onOrderUrgent: (data: any) => {
      if (user?.role === 'COMPANION') {
        setUrgentOrder(data);
        window.dispatchEvent(new Event('chunlv:order-pool-updated'));
      }
    },
    onScheduledReminder: (data: any) => {
      if (user?.role === 'CS' || user?.role === 'ADMIN' || user?.role === 'OWNER') {
        message.warning({ content: data.message || '你发布的预约单已超时未接，请跟进对接客户', duration: 10 });
      }
    },
    onWalletReviewed: (data: any) => {
      message.info(data.message || `支取 ¥${data.amount} ${data.status === 'APPROVED' ? '已通过' : '已拒绝'}`);
    },
    onUserAuthorized: (data: any) => {
      message.success(data.message || '注册申请已通过审核', 6);
    },
    onUserRejected: (data: any) => {
      message.warning(data.message || '注册申请未通过审核', 6);
    },
    onBridgeResponded: (data: any) => {
      message.info(data.message || (data.accepted ? '对方已同意桥接申请' : '对方已拒绝桥接申请'));
    },
    onRevenueDiff: (data: any) => {
      const isMgmt = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS';
      if (isMgmt && data.message) {
        message.warning({ content: data.message, duration: 10 });
      }
    },
    onReviewAlert: (data: any) => {
      const isMgmt = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS';
      if (isMgmt) {
        setReviewBadge((p) => p + 1);
        message.warning({
          content: `工作抽查：${data.companionName} 存在异常（${data.reason || data.level || '异常'}），请到陪玩管理工作记录核查`,
          duration: 10,
        });
      }
    },
    onCsAccountAnomaly: (data: any) => {
      if (user?.role === 'CS' && data.message) {
        message.warning({ content: data.message, duration: 12 });
        showSystemNotification('蠢驴电竞 · 账目异常', data.message);
      }
    },
  });

  // Voice call handler — uses the same WebSocket from useSocket
  const vc = useVoiceCall(voiceSocketRef);
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { targetUserId, targetUserName } = e.detail || {};
      if (targetUserId) vc.startCall(targetUserId, targetUserName || '未知');
    };
    window.addEventListener('start-voice-call', handler as EventListener);
    return () => window.removeEventListener('start-voice-call', handler as EventListener);
  }, [vc.startCall]);

  const VoiceCallHandler = () => (
    <>
      <IncomingCallModal
        open={vc.callState.status === 'ringing' || vc.callState.status === 'calling'}
        callerName={vc.callState.peerName}
        calling={vc.callState.status === 'calling'}
        onAccept={vc.acceptCall}
        onReject={vc.rejectCall}
      />
      {vc.callState.status === 'connected' && (
        <VoiceCallBar
          peerName={vc.callState.peerName}
          duration={vc.callState.duration}
          volume={vc.callState.volume}
          onVolumeChange={vc.setVolume}
          onHangup={vc.hangup}
        />
      )}
    </>
  );

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
        CS: '/cs/stats',
        COMPANION: '/companion',
      };
      navigate(defaults[user.role] || '/admin', { replace: true });
    }
  }, [isAuthenticated, navigate, user, location.pathname]);

  const menuItems = useMemo(() => {
    if (!user) return [];
    const items = [...(roleMenus[user.role] || [])];
    const pCount = pendingBadge;
    const bpCount = bridgePendingBadge;
    const bCount = billingBadge;
    const cCount = contactBadge;
    const psCount = pendingStartBadge;
    const rvCount = reviewBadge;
    const REVIEW_LABELS = ['工作室管理', '实名审核'];
    const CHAT_LABELS = ['陪玩管理', '员工管理', '首页'];
    const CONTACT_LABELS = ['派单工作台'];
    const PENDING_START_LABELS = ['订单管理'];
    const REVIEW_WORK_LABELS = ['陪玩管理', '陪玩'];
    return items.map((item) => {
      // Check children (group items) for badge targets
      if (item.children) {
        const hasPending = item.children.some((c: any) => REVIEW_LABELS.includes(c.label) && pCount > 0);
        const hasBridgePending = item.children.some((c: any) => c.label === '工作室桥接' && bpCount > 0);
        const hasBilling = item.children.some((c: any) => c.label === '报账系统' && bCount > 0);
        const hasUnread = item.children.some((c: any) => CHAT_LABELS.includes(c.label) && directUnread > 0);
        const hasReview = item.children.some((c: any) => REVIEW_WORK_LABELS.includes(c.label) && rvCount > 0);
        const hasContact = item.children.some((c: any) => CONTACT_LABELS.includes(c.label) && cCount > 0);
        const hasPendingStart = item.children.some((c: any) => PENDING_START_LABELS.includes(c.label) && psCount > 0);
        if (hasPending || hasBridgePending || hasBilling || hasUnread || hasReview || hasContact || hasPendingStart) {
          return {
            ...item,
            children: item.children.map((child: any) => {
              if (!child.children && REVIEW_LABELS.includes(child.label) && pCount > 0) {
                return {
                  ...child,
                  label: (
                    <span
                      onClick={(e: any) => {
                        e.stopPropagation();
                        markSeen();
                        navigate(child.key);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      {child.label}
                      <Badge count={pCount} size="small" overflowCount={99} style={{ boxShadow: '0 0 10px #FF4757' }} />
                    </span>
                  ),
                };
              }
              if (!child.children && child.label === '工作室桥接' && bpCount > 0) {
                return {
                  ...child,
                  label: (
                    <span
                      onClick={(e: any) => {
                        e.stopPropagation();
                        markBridgeSeen();
                        navigate(child.key);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      {child.label}
                      <Badge
                        count={bpCount}
                        size="small"
                        overflowCount={99}
                        style={{ boxShadow: '0 0 10px #FF4757' }}
                      />
                    </span>
                  ),
                };
              }
              if (!child.children && child.label === '报账系统' && bCount > 0) {
                return {
                  ...child,
                  label: (
                    <span
                      onClick={(e: any) => {
                        e.stopPropagation();
                        markBillingSeen();
                        navigate(child.key);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      {child.label}
                      <Badge count={bCount} size="small" overflowCount={99} style={{ boxShadow: '0 0 10px #FF4757' }} />
                    </span>
                  ),
                };
              }
              if (!child.children && REVIEW_WORK_LABELS.includes(child.label) && rvCount > 0) {
                return {
                  ...child,
                  label: (
                    <span
                      onClick={(e: any) => {
                        e.stopPropagation();
                        markReviewSeen();
                        navigate(child.key);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      {child.label}
                      <Badge
                        count={rvCount}
                        size="small"
                        overflowCount={99}
                        style={{ boxShadow: '0 0 10px #FAAD14' }}
                      />
                    </span>
                  ),
                };
              }
              if (!child.children && CHAT_LABELS.includes(child.label) && directUnread > 0) {
                return {
                  ...child,
                  label: (
                    <span
                      onClick={(e: any) => {
                        e.stopPropagation();
                        navigate(child.key);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      {child.label}
                      <Badge
                        count={directUnread}
                        size="small"
                        overflowCount={99}
                        style={{ boxShadow: directUnread > 0 ? '0 0 10px #FF4757' : undefined }}
                      />
                    </span>
                  ),
                };
              }
              if (!child.children && CONTACT_LABELS.includes(child.label) && cCount > 0) {
                return {
                  ...child,
                  label: (
                    <span
                      onClick={(e: any) => {
                        e.stopPropagation();
                        markContactSeen();
                        navigate(`${child.key}?tab=followup`);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      {child.label}
                      <Badge
                        count={cCount}
                        size="small"
                        overflowCount={99}
                        style={{ boxShadow: '0 0 10px #F59E0B' }}
                      />
                    </span>
                  ),
                };
              }
              if (!child.children && PENDING_START_LABELS.includes(child.label) && psCount > 0) {
                return {
                  ...child,
                  label: (
                    <span
                      onClick={(e: any) => {
                        e.stopPropagation();
                        markPendingStartSeen();
                        navigate(child.key);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      {child.label}
                      <Badge
                        count={psCount}
                        size="small"
                        overflowCount={99}
                        style={{ boxShadow: '0 0 10px #F59E0B' }}
                      />
                    </span>
                  ),
                };
              }
              return child;
            }),
          };
        }
      }
      // Top-level item check (fallback)
      if (REVIEW_LABELS.includes(item.label as string) && pCount > 0) {
        return {
          ...item,
          label: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {item.label}
              <Badge count={pCount} size="small" overflowCount={99} style={{ boxShadow: '0 0 10px #FF4757' }} />
            </span>
          ),
        };
      }
      if (item.label === '工作室桥接' && bpCount > 0) {
        return {
          ...item,
          label: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {item.label}
              <Badge count={bpCount} size="small" overflowCount={99} style={{ boxShadow: '0 0 10px #FF4757' }} />
            </span>
          ),
        };
      }
      if (item.label === '报账系统' && bCount > 0) {
        return {
          ...item,
          label: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {item.label}
              <Badge count={bCount} size="small" overflowCount={99} style={{ boxShadow: '0 0 10px #FF4757' }} />
            </span>
          ),
        };
      }
      if (CHAT_LABELS.includes(item.label as string) && directUnread > 0) {
        return {
          ...item,
          label: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {item.label}
              <Badge
                count={directUnread}
                size="small"
                overflowCount={99}
                style={{ boxShadow: directUnread > 0 ? '0 0 10px #FF4757' : undefined }}
              />
            </span>
          ),
        };
      }
      return item;
    }).map((item) => {
      // 单子菜单直接平铺：点击父级直接跳转，省掉再点一次二级菜单
      if (item.children && item.children.length === 1) {
        const child = item.children[0];
        return { key: child.key, icon: item.icon, label: item.label };
      }
      return item;
    });
  }, [user, directUnread, pendingBadge, bridgePendingBadge, billingBadge, contactBadge, pendingStartBadge]);

  const selectedKeys = useMemo(() => {
    const path = location.pathname;
    const matched = menuItems
      .map((item) => item.key)
      .filter((key) => path.startsWith(key))
      .sort((a, b) => b.length - a.length);
    return matched.length > 0 ? [matched[0]] : [];
  }, [location.pathname, menuItems]);

  const onMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    // 只允许点击菜单文字触发跳转，避免点到左侧栏空白区域也误触。
    const target = domEvent.target as HTMLElement | null;
    const titleContent = target?.closest?.('.ant-menu-title-content');
    if (!titleContent) return;

    // 只清掉对应页面的角标，避免点其他菜单误清
    if (key.includes('/review')) markSeen();
    if (key.includes('bridges')) markBridgeSeen();
    if (key.includes('/billing')) markBillingSeen();
    if (key.includes('/orders')) markPendingStartSeen();
    navigate(key);
  };

  const handleLogout = async () => {
    try { await logout(); } catch { return; } // Password required — abort if wrong
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
      <Layout style={{ height: '100vh', overflow: 'hidden' }}>
        {/* ── 浅色侧边栏 ── */}
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={null}
          width={170}
          collapsedWidth={48}
          style={{
            background: commander.background,
            borderRight: '1px solid rgba(255,255,255,0.08)',
            height: '100vh',
            position: 'sticky',
            top: 0,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* 导航菜单 */}
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            <Menu
              mode="inline"
              theme="dark"
              selectedKeys={selectedKeys}
              defaultOpenKeys={menuItems.filter((m: any) => m.children).map((m: any) => m.key)}
              items={menuItems as MenuProps['items']}
              onClick={onMenuClick}
              style={{
                background: 'transparent',
                border: 'none',
                marginTop: 8,
              }}
            />
          </div>

          {/* 底部版本号（客户端 v* / 前端构建 *）已经挪到「设置 → 版本信息」，
              这两行以前常驻在菜单底部，属于纯噪音。 */}
        </Sider>

        {/* 左侧常驻群聊消息面板 — 群聊消息不再进铃铛 */}
        <Sider
          theme="light"
          width={240}
          collapsedWidth={0}
          collapsible
          collapsed={messagePanelCollapsed}
          trigger={null}
          style={{
            background: '#FFFFFF',
            borderRight: '1px solid #E8E9EB',
            height: '100vh',
            position: 'sticky',
            top: 0,
            display: 'flex',
            flexDirection: 'column',
            zIndex: 2,
            overflow: 'hidden',
          }}
        >
          {!messagePanelCollapsed && <LeftMessagePanel onOpenChat={openGroupChat} />}
        </Sider>

        <Layout style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
          {/* 顶栏 — 白色底 */}
          <Header
            style={{
              padding: '0 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              zIndex: 1,
              height: 56,
              background: 'linear-gradient(90deg, rgba(11,16,36,0.98), rgba(19,11,46,0.98))',
            }}
          >
            <Button
              type="text"
              icon={collapsed ? IconUnfold : IconFold}
              onClick={() => setCollapsed(!collapsed)}
              style={{ color: commander.textSecondary }}
            />
            <Button
              type="text"
              icon={React.createElement(MessageOutlined)}
              onClick={() => setMessagePanelCollapsed((v) => !v)}
              title={messagePanelCollapsed ? '显示消息栏' : '隐藏消息栏'}
              style={{ color: messagePanelCollapsed ? commander.textSecondary : '#2563EB' }}
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
                    <ConversationList
                      onOpenChat={openChatFromNotification}
                      onClose={() => setNotifOpen(false)}
                      hideGroups
                    />
                  }
                >
                  <Badge
                    count={directUnread}
                    overflowCount={99}
                    size="default"
                    offset={[-2, 8]}
                    className={directUnread > 0 ? 'badge-pop-active' : undefined}
                  >
                    <div
                      style={{
                        borderRadius: 8,
                        ...(directUnread > 0
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
                          color: directUnread > 0 ? '#2563EB' : commander.textSecondary,
                          fontSize: 20,
                        }}
                        className={directUnread > 0 ? 'bell-glow-active' : ''}
                      />
                    </div>
                  </Badge>
                </Popover>
              )}
              {user?.role === 'COMPANION' && (
                <Popover
                  open={partnerInviteOpen}
                  onOpenChange={setPartnerInviteOpen}
                  trigger="click"
                  placement="bottomRight"
                  title="待处理搭档邀请"
                  content={
                    <div style={{ width: 320 }}>
                      {partnerInvites.length === 0 ? (
                        <Text type="secondary">暂无待处理邀请</Text>
                      ) : (
                        partnerInvites.map((p) => {
                          const remaining = Math.max(0, Math.ceil((p.expiresAt - Date.now()) / 1000));
                          return (
                            <div key={p.sessionId} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                              <div>
                                <Text strong>🤝 {p.inviterName} 邀请你搭档</Text>
                              </div>
                              <div style={{ fontSize: 12, color: '#666' }}>
                                {p.gameName || '订单'} · ¥{Number(p.amount || 0).toFixed(1)} · {p.duration || 1}h
                              </div>
                              <div style={{ margin: '6px 0' }}>
                                <InviteCountdown seconds={remaining} />
                              </div>
                              <Space size={8}>
                                <Button
                                  size="small"
                                  type="primary"
                                  onClick={async () => {
                                    try {
                                      await ordersApi.acceptPartnerInvite(p.sessionId);
                                      message.success('已接受搭档邀请，开始计时');
                                      removePartnerInvite(p.sessionId);
                                      (window as any).electronAPI?.sessionWatch?.(p.sessionId);
                                      window.dispatchEvent(new Event('chunlv:service-started'));
                                      setPartnerInviteOpen(false);
                                    } catch (e: any) {
                                      message.error(e?.response?.data?.message || '接受失败');
                                    }
                                  }}
                                >
                                  接受
                                </Button>
                                <Button
                                  size="small"
                                  onClick={async () => {
                                    try {
                                      await ordersApi.rejectPartnerInvite(p.sessionId);
                                    } catch {}
                                    removePartnerInvite(p.sessionId);
                                  }}
                                >
                                  拒绝
                                </Button>
                              </Space>
                            </div>
                          );
                        })
                      )}
                    </div>
                  }
                >
                  <Badge
                    count={partnerInvites.length}
                    overflowCount={99}
                    size="default"
                    offset={[-2, 8]}
                  >
                    <Button
                      type="text"
                      icon={<span style={{ fontSize: 18 }}>🤝</span>}
                      style={{ color: partnerInvites.length > 0 ? '#F59E0B' : commander.textSecondary }}
                    />
                  </Badge>
                </Popover>
              )}
              {user && (
                <>
                  <div
                    onClick={() => navigate('/profile')}
                    title="点击进入个人设置（修改头像/密码）"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      padding: '2px 8px',
                      borderRadius: 20,
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
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
                    </div>
                    <Text style={{ color: commander.textPrimary, fontWeight: 500 }}>{user.displayName || user.username}</Text>
                  </div>
                  <Text style={{ color: commander.cyan, fontSize: 12, fontWeight: 600 }}>{roleLabels[user.role]}</Text>
                  {isCsClient && (
                    <Tag color="cyan" style={{ marginInlineEnd: 0, fontWeight: 600 }}>
                      客服端
                    </Tag>
                  )}
                  {user?.role === 'CS' && myCommission != null && (
                    <Text style={{ color: '#F59E0B', fontSize: 12, fontWeight: 600 }}>
                      本月预计提成 ¥{Number(myCommission).toFixed(1)}
                    </Text>
                  )}
                  {user?.role === 'CS' && (
                    <Button
                      size="small"
                      type="link"
                      onClick={() => setSalaryOpen(true)}
                      style={{ color: '#2563EB', padding: 0, fontWeight: 600 }}
                    >
                      底薪 + 提奖
                    </Button>
                  )}
                </>
              )}
              {user?.role !== 'COMPANION' && (
                <Button type="text" icon={IconLogout} onClick={handleLogout} style={{ color: commander.textSecondary }}>
                  退出
                </Button>
              )}
            </Space>
          </Header>

          {/* 内容区 — 白色圆角容器 */}
          <Content
            className="app-content"
            style={{
              margin: isCompact ? 10 : 20,
              padding: isCompact ? 12 : 20,
              background: '#FFFFFF',
              borderRadius: 12,
              minHeight: 280,
              overflow: 'auto',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)',
            }}
          >
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </Content>
        </Layout>
      </Layout>

      <Modal
        title="💰 底薪 + 提奖"
        open={salaryOpen}
        onCancel={() => setSalaryOpen(false)}
        footer={null}
        width={720}
      >
        {mySalary?.row ? (
          <div style={{ fontSize: 13, lineHeight: 1.9 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 8 }}>
              <div>月份：<b>{mySalary.month}</b></div>
              <div>底薪：<b>¥{Number(mySalary.config.baseSalary).toFixed(2)}</b></div>
              <div>月休：<b>{mySalary.config.restDays} 天</b></div>
              <div>满勤：<b>{mySalary.fullAttendance} 天</b></div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 8 }}>
              <div>桥接单数：<b>{mySalary.row.bridgeUnits}</b> 单</div>
              <div>桥接单价：<b>¥{Number(mySalary.row.bridgePerUnitYuan).toFixed(2)}</b></div>
              <div>桥接提成：<b>¥{Number(mySalary.row.bridgeCommissionYuan).toFixed(2)}</b></div>
              <div>线下提成：<b>¥{Number(mySalary.row.offlineCommissionYuan).toFixed(2)}</b></div>
              <div>线上提成：<b>¥{Number(mySalary.row.onlineCommissionYuan).toFixed(2)}</b></div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 8 }}>
              <div>底薪实发：<b>¥{Number(mySalary.row.baseEffective).toFixed(2)}</b></div>
              <div>全勤奖：<b>¥{Number(mySalary.row.attendanceBonus).toFixed(2)}</b></div>
              <div>考勤扣款：<b>¥{Number(mySalary.row.attendanceDeduction).toFixed(2)}</b></div>
              <div>预计合计：<b style={{ color: '#1677ff' }}>¥{Number(mySalary.row.totalYuan).toFixed(2)}</b></div>
            </div>
            <div style={{ marginTop: 12, marginBottom: 4, fontWeight: 600 }}>订单明细</div>
            <div style={{ maxHeight: 260, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f5f7fa' }}>
                    <th style={{ padding: 6, border: '1px solid #e5e7eb' }}>订单</th>
                    <th style={{ padding: 6, border: '1px solid #e5e7eb' }}>类型</th>
                    <th style={{ padding: 6, border: '1px solid #e5e7eb' }}>状态</th>
                    <th style={{ padding: 6, border: '1px solid #e5e7eb' }}>微信</th>
                    <th style={{ padding: 6, border: '1px solid #e5e7eb' }}>金额</th>
                    <th style={{ padding: 6, border: '1px solid #e5e7eb' }}>单/双</th>
                    <th style={{ padding: 6, border: '1px solid #e5e7eb' }}>去向</th>
                    <th style={{ padding: 6, border: '1px solid #e5e7eb' }}>提成</th>
                  </tr>
                </thead>
                <tbody>
                  {(mySalary.orders || []).map((t: any) => (
                    <tr key={t.orderId}>
                      <td style={{ padding: 6, border: '1px solid #e5e7eb' }}>{t.orderCode || t.orderId?.slice(0, 8)}</td>
                      <td style={{ padding: 6, border: '1px solid #e5e7eb' }}>{t.type}</td>
                      <td style={{ padding: 6, border: '1px solid #e5e7eb' }}>
                        {t.status === 'DONE' ? '✅ 已打首单' : t.status === 'CONFIRMED' ? '进行中' : t.status === 'GRABBED' ? '已抢单' : t.status || '-'}
                      </td>
                      <td style={{ padding: 6, border: '1px solid #e5e7eb' }}>
                        {t.contactStatus === 'added' ? '✅ 添加成功' : t.contactStatus === 'not_accepted' ? '❌ 添加失败' : t.contactStatus === 'pending' ? '待添加' : '-'}
                      </td>
                      <td style={{ padding: 6, border: '1px solid #e5e7eb' }}>¥{Number(t.amount).toFixed(2)}</td>
                      <td style={{ padding: 6, border: '1px solid #e5e7eb' }}>{t.units === 2 ? '双陪' : '单陪'}</td>
                      <td style={{ padding: 6, border: '1px solid #e5e7eb' }}>{t.kind === 'offline' ? '线下' : t.kind === 'bridge' ? '桥接' : '线上'}</td>
                      <td style={{ padding: 6, border: '1px solid #e5e7eb' }}>
                        {t.counted ? `+¥${Number(t.commissionYuan).toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <Text type="secondary">暂无工资数据</Text>
        )}
      </Modal>

      {/* Automatic in-app partner invite popup — do not rely on Windows notification only */}
      <Modal
        open={partnerInviteModalOpen && partnerInvites.length > 0}
        title="🤝 搭档邀请"
        footer={null}
        closable={false}
        maskClosable={false}
        width={360}
        onCancel={() => setPartnerInviteModalOpen(false)}
      >
        {partnerInvites[0] &&
          (() => {
            const p = partnerInvites[0];
            const remaining = Math.max(0, Math.ceil((p.expiresAt - Date.now()) / 1000));
            return (
              <div>
                <div>
                  <Text strong>{p.inviterName} 邀请你搭档</Text>
                </div>
                <div style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
                  {p.gameName || '订单'} · ¥{Number(p.amount || 0).toFixed(1)} · {p.duration || 1}h
                </div>
                <div style={{ margin: '10px 0' }}>
                  <InviteCountdown seconds={remaining} />
                </div>
                <Space>
                  <Button
                    type="primary"
                    onClick={async () => {
                      try {
                        await ordersApi.acceptPartnerInvite(p.sessionId);
                        message.success('已接受搭档邀请，开始计时');
                        removePartnerInvite(p.sessionId);
                        (window as any).electronAPI?.sessionWatch?.(p.sessionId);
                        window.dispatchEvent(new Event('chunlv:service-started'));
                        setPartnerInviteModalOpen(false);
                      } catch (e: any) {
                        message.error(e?.response?.data?.message || '接受失败');
                      }
                    }}
                  >
                    接受
                  </Button>
                  <Button
                    onClick={async () => {
                      try {
                        await ordersApi.rejectPartnerInvite(p.sessionId);
                      } catch {}
                      removePartnerInvite(p.sessionId);
                      setPartnerInviteModalOpen(false);
                    }}
                  >
                    拒绝
                  </Button>
                </Space>
              </div>
            );
          })()}
      </Modal>

      {/* Urgent order popup + solo grab success */}
      <UrgentOrderPopup
        urgentOrder={urgentOrder}
        urgentGrabbed={urgentGrabbed}
        setUrgentOrder={setUrgentOrder}
        setUrgentGrabbed={setUrgentGrabbed}
      />

      {/* Global Grab Success Modal — survives navigation */}
      <Modal title="抢单成功" open={!!grabbedOrder} onCancel={() => setGrabbedOrder(null)} footer={null} width={480}>
        {grabbedOrder &&
          (() => {
            const g = grabbedOrder as any;
            return (
              <div style={{ fontSize: 14, lineHeight: 2 }}>
                <div>
                  📋 {g.gameName} · {orderTypeConfig[g.type]?.label || g.type} · ¥
                  {Number(g.amount).toFixed(0)} · {g.duration}h
                </div>
                {g.customer?.customerCode && <div>客户编号：{g.customer.customerCode}</div>}
                {g.customFields?.customerSource && <div>来源：{g.customFields.customerSource}</div>}
                {g.customFields?.csCultivated === true && (
                  <div style={{ color: '#1677ff', fontWeight: 500 }}>
                    ✅ 该客户已添加到客服工作微信（{g.customFields?.csWorkWechatName || '客服微信'}），请注意措辞
                  </div>
                )}
                {g.customFields?.customerWechat && (
                  <div>
                    💬 微信：<Typography.Text copyable>{g.customFields.customerWechat}</Typography.Text>
                  </div>
                )}
                {g.customFields?.customerRoomCode && (
                  <div>
                    🏠 房间码：<Typography.Text copyable>{g.customFields.customerRoomCode}</Typography.Text>
                  </div>
                )}
                {g.customFields?.customerPlatformAccount && (
                  <div>
                    🔗 平台号：
                    <Typography.Text copyable>{g.customFields.customerPlatformAccount}</Typography.Text>
                  </div>
                )}
                {g.csUser?.username && <div>发布者：{g.csUser.username}</div>}
                {g.customFields?.urgency === 'later' && <Tag color="purple">📅预约</Tag>}
                {g.customFields?.urgency !== 'later' && g.customFields?.urgency && <Tag color="green">⚡立即打</Tag>}
              </div>
            );
          })()}
      </Modal>

      {/* Global Chat Modal (opened from notification bell) */}
      <ChatModal
        open={!!globalChatPartner}
        partner={globalChatPartner as any}
        onClose={() => setGlobalChatPartner(null)}
      />

      {/* Command Palette (Ctrl+K) */}
      <VoiceCallHandler />
      <ServiceStartOverlay />
      <CommandPalette open={commandPalette} onClose={() => setCommandPalette(false)} />
    </ChatProvider>
  );
};

export default AppLayout;
