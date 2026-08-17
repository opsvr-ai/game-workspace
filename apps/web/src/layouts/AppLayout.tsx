// craftsman-ignore: TS001,TS002
import React, { useEffect, useMemo, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Space, Spin, Tag, Modal, Badge, Popover, message, Form, Input } from 'antd';
import type { MenuProps } from 'antd';
import { useSocket } from '../hooks/useSocket';
import http from '../api/client';
// useChatNotification → now handled by ChatProvider
import ErrorBoundary from '../components/ErrorBoundary';
import UrgentOrderPopup from '../components/UrgentOrderPopup';
import DualCompanionModal from '../components/DualCompanionModal';
import { ChatProvider } from '../components/chat';
import CommandPalette from '../components/CommandPalette';
import ChatModal from '../components/ChatModal';
import IncomingCallModal from '../components/IncomingCallModal';
import VoiceCallBar from '../components/VoiceCallBar';
import { useVoiceCall } from '../hooks/useVoiceCall';
import { PartnerCallNotification } from '../components/PartnerCallNotification';
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
      key: 'owner-dispatch', icon: IconDispatch, label: '派单管理',
      children: [{ key: '/admin/traffic', label: '派单工作台' }],
    },
    {
      key: 'owner-orders', icon: IconOrders, label: '订单管理',
      children: [{ key: '/owner/orders', label: '全部订单' }],
    },
    {
      key: 'owner-customers', icon: IconCustomers, label: '客户管理',
      children: [{ key: '/owner/customers', label: '客户列表' }],
    },
    {
      key: 'owner-finance', icon: IconRevenue, label: '财务管理',
      children: [
        { key: '/admin/billing', label: '报账系统' },
        { key: '/owner/stats', label: '每日统计' },
        { key: '/admin/finance/risk', label: '风险工作台' },
        { key: '/admin/finance/reconciliation', label: '到账对账' },
        { key: '/admin/finance/expenses', label: '支出/支取审核' },
        { key: '/admin/finance/settlement', label: '月度分成' },
        { key: '/admin/finance/commission', label: '提成结算' },
        { key: '/admin/finance/price-rules', label: '价格规则' },
        { key: '/admin/payroll', label: '工资管理' },
        { key: '/admin/profit-split', label: '利润分成' },
      ],
    },
      {
        key: 'owner-other', icon: IconDashboard, label: '其他',
        children: [
          { key: '/admin', label: '数据看板' },
          { key: '/admin/analytics', label: '动态分析' },
          { key: '/admin/attendance', label: '考勤管理' },
          { key: '/owner/review', label: '实名审核' },
          { key: '/owner/employees?role=ADMIN', label: '员工管理' },
          { key: '/admin/traffic-accounts', label: '引流账号管理' },
          { key: '/admin/pc-control', label: '远程控制' },
        { key: '/admin/managed-pcs', label: '电脑管理' },
      ],
    },
    {
      key: 'owner-settings', icon: IconAuth, label: '设置',
      children: [
        { key: '/owner/settings', label: '系统配置' },
        { key: '/owner/studios', label: '工作室管理' },
        { key: '/owner/authorizations', label: '客户端授权' },
        { key: '/owner/work-wechats', label: '工作微信' },
        { key: '/admin/blacklist', label: '进程黑名单' },
        { key: '/admin/whitelist', label: '进程白名单' },
        { key: '/admin/process-kill-log', label: '杀进程日志' },
        { key: '/admin/agent-version', label: '客户端版本' },
      ],
    },
  ],
  [UserRole.ADMIN]: [
    {
      key: 'admin-dispatch', icon: IconDispatch, label: '派单管理',
      children: [{ key: '/admin/dispatch', label: '派单工作台' }],
    },
    {
      key: 'admin-orders', icon: IconOrders, label: '订单管理',
      children: [{ key: '/admin/orders', label: '全部订单' }],
    },
    {
      key: 'admin-customers', icon: IconCustomers, label: '客户管理',
      children: [{ key: '/admin/customers', label: '客户列表' }],
    },
    {
      key: 'admin-finance', icon: IconRevenue, label: '财务管理',
      children: [
        { key: '/admin/billing', label: '报账系统' },
        { key: '/admin/stats', label: '每日统计' },
        { key: '/admin/finance/risk', label: '风险工作台' },
        { key: '/admin/finance/reconciliation', label: '到账对账' },
        { key: '/admin/finance/expenses', label: '支出/支取审核' },
        { key: '/admin/finance/settlement', label: '月度分成' },
        { key: '/admin/finance/commission', label: '提成结算' },
        { key: '/admin/finance/price-rules', label: '价格规则' },
        { key: '/admin/payroll', label: '工资管理' },
        { key: '/admin/profit-split', label: '利润分成' },
      ],
    },
      {
        key: 'admin-other', icon: IconDashboard, label: '其他',
        children: [
          { key: '/admin', label: '数据看板' },
          { key: '/admin/analytics', label: '动态分析' },
          { key: '/admin/attendance', label: '考勤管理' },
          { key: '/admin/review', label: '实名审核' },
          { key: '/admin/employees?role=CS', label: '员工管理' },
          { key: '/admin/traffic-accounts', label: '引流账号管理' },
          { key: '/admin/pc-control', label: '远程控制' },
        { key: '/admin/managed-pcs', label: '电脑管理' },
      ],
    },
    {
      key: 'admin-settings', icon: IconAuth, label: '设置',
      children: [
        { key: '/admin/settings', label: '系统配置' },
        { key: '/owner/bridges', label: '工作室桥接' },
        { key: '/admin/work-wechats', label: '工作微信' },
        { key: '/admin/blacklist', label: '进程黑名单' },
        { key: '/admin/whitelist', label: '进程白名单' },
        { key: '/admin/process-kill-log', label: '杀进程日志' },
        { key: '/admin/agent-version', label: '客户端版本' },
      ],
    },
  ],
  [UserRole.CS]: [
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
      children: [{ key: '/cs/employees', label: '陪玩管理' }],
    },
    {
      key: 'cs-finance', icon: IconRevenue, label: '财务管理',
      children: [
        { key: '/cs/billing', label: '报账系统' },
        { key: '/cs/stats', label: '每日统计' },
        { key: '/cs/finance/risk', label: '风险工作台' },
        { key: '/cs/finance/reconciliation', label: '到账对账' },
      ],
    },
      {
        key: 'cs-other', icon: IconDashboard, label: '其他',
        children: [
          { key: '/cs/traffic-accounts', label: '引流账号管理' },
          { key: '/admin/pc-control', label: '远程控制' },
        { key: '/admin/managed-pcs', label: '电脑管理' },
        { key: '/admin/analytics', label: '动态分析' },
        { key: '/admin/payroll', label: '工资管理' },
        { key: '/admin/attendance', label: '考勤管理' },
      ],
    },
    {
      key: 'cs-settings', icon: IconAuth, label: '设置',
      children: [
        { key: '/cs/work-wechats', label: '工作微信' },
        { key: '/admin/blacklist', label: '进程黑名单' },
        { key: '/admin/whitelist', label: '进程白名单' },
        { key: '/admin/process-kill-log', label: '杀进程日志' },
        { key: '/admin/agent-version', label: '客户端版本' },
      ],
    },
  ],
  [UserRole.COMPANION]: [
    { key: '/companion', icon: IconDashboard, label: '首页' },
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
      key: 'companion-finance', icon: IconRevenue, label: '财务管理',
      children: [
        { key: '/companion/billing', label: '报账系统' },
        { key: '/companion/stats', label: '每日统计' },
      ],
    },
  ],
};

const roleLabels: Record<UserRole, string> = {
  [UserRole.OWNER]: '老板',
  [UserRole.ADMIN]: '店长',
  [UserRole.CS]: '客服',
  [UserRole.COMPANION]: '陪玩',
};

const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = React.useState(false);
  const { user, isAuthenticated, fetchUser, logout } = useAuthStore();
  const [studioBrand, setStudioBrand] = React.useState<{ name: string; logo?: string } | null>(null);
  const [appVersion, setAppVersion] = React.useState('');
  const [myCommission, setMyCommission] = React.useState<number | null>(null);
  const isCsClient = typeof window !== 'undefined'
    && !!(window as any).electronAPI
    && !(window as any).electronAPI?.getSavedCredentials
    && !(window as any).electronAPI?.onStatusChanged;
  useEffect(() => {
    const api = (window as any).electronAPI;
    api?.getAppVersion?.().then((v: string) => setAppVersion(v || '')).catch(() => {});
  }, []);
  useEffect(() => {
    const send = () => {
      http
        .post('/agent/heartbeat', { agentVersion: appVersion || undefined })
        .then((res: any) => {
          const id = res?.data?.data?.webBuildId;
          if (!id) return;
          const prev = localStorage.getItem('webBuildId');
          if (prev && prev !== id) {
            localStorage.setItem('webBuildId', id);
            window.location.reload();
          } else if (!prev) {
            localStorage.setItem('webBuildId', id);
          }
        })
        .catch(() => {});
    };
    send();
    const timer = setInterval(send, 30_000);
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
    const api = (window as any).electronAPI;
    if (!api?.getAppVersion) return;
    const report = () => {
      api.getAppVersion().then((v: string) => {
        http.post('/agent/cs-heartbeat', { agentVersion: v }).catch(() => {});
      }).catch(() => {});
    };
    report();
    const timer = setInterval(report, 60_000);
    return () => clearInterval(timer);
  }, [user?.id]);
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
  // Badge: raw count from API, with seen-tracking via ref (not state)
  const [pendingBadge, setPendingBadge] = React.useState(0);
  const seenRef = React.useRef(0); // start fresh — old localStorage values cause bugs

  useEffect(() => {
    if (user?.role !== 'OWNER' && user?.role !== 'ADMIN') return;
    const doFetch = async () => {
      try {
        const { data } = await http.get('/users/pending-review');
        const total = (data.data || []).length;
        if (seenRef.current > total) {
          seenRef.current = total;
          localStorage.setItem('pending-seen', String(total));
        }
        setPendingBadge(Math.max(0, total - seenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(doFetch, 30000);
    return () => clearInterval(t);
  }, [user?.role]);

  // Bridge pending badge for ADMIN (same pattern as pendingBadge above)
  const [bridgePendingBadge, setBridgePendingBadge] = React.useState(0);
  const bridgeSeenRef = React.useRef(0);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    const doFetch = async () => {
      try {
        const { data } = await http.get('/bridges');
        const pending = data.data?.pending || [];
        const total = pending.length;
        if (bridgeSeenRef.current > total) {
          bridgeSeenRef.current = total;
          localStorage.setItem('bridge-pending-seen', String(total));
        }
        setBridgePendingBadge(Math.max(0, total - bridgeSeenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(doFetch, 30000);
    return () => clearInterval(t);
  }, [user?.role]);

  // Billing pending badge (报账审核 + 支出审批 + 支取审批)
  const [billingBadge, setBillingBadge] = React.useState(0);
  const billingSeenRef = React.useRef(0);

  useEffect(() => {
    if (user?.role !== 'OWNER' && user?.role !== 'ADMIN' && user?.role !== 'CS') return;
    const doFetch = async () => {
      try {
        const { data } = await http.get('/billing/pending-count');
        const total = data.data?.total || 0;
        if (billingSeenRef.current > total) {
          billingSeenRef.current = total;
          localStorage.setItem('billing-pending-seen', String(total));
        }
        setBillingBadge(Math.max(0, total - billingSeenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(doFetch, 30000);
    return () => clearInterval(t);
  }, [user?.role]);

  // 工作抽查 badge（ADMIN/OWNER）
  const [reviewBadge, setReviewBadge] = React.useState(0);
  useEffect(() => {
    if (user?.role !== 'OWNER' && user?.role !== 'ADMIN') return;
    const doFetch = async () => {
      try {
        const { data } = await http.get('/admin/review-queue-count');
        const count = data.data?.count || 0;
        setReviewBadge((prev) => Math.max(prev, count));
      } catch {}
    };
    doFetch();
    const t = setInterval(doFetch, 30000);
    return () => clearInterval(t);
  }, [user?.role]);

  const markBillingSeen = () => {
    setBillingBadge((prev) => {
      const total = prev + billingSeenRef.current;
      billingSeenRef.current = total;
      localStorage.setItem('billing-pending-seen', String(total));
      return 0;
    });
  };

  const markBridgeSeen = () => {
    setBridgePendingBadge((prev) => {
      const total = prev + bridgeSeenRef.current;
      bridgeSeenRef.current = total;
      localStorage.setItem('bridge-pending-seen', String(total));
      return 0;
    });
  };

  const markSeen = () => {
    // Read current total from state to set seen
    setPendingBadge((prev) => {
      const total = prev + seenRef.current; // reconstruct: badge + seen = total
      seenRef.current = total;
      localStorage.setItem('pending-seen', String(total));
      return 0;
    });
  };

  // Contact pending badge (联系状态待处理 — for CS/ADMIN/OWNER)
  const [contactBadge, setContactBadge] = React.useState(0);
  const contactSeenRef = React.useRef(0);

  useEffect(() => {
    if (user?.role !== 'OWNER' && user?.role !== 'ADMIN' && user?.role !== 'CS') return;
    const doFetch = async () => {
      try {
        const { data } = await http.get('/orders/pending-contact-count');
        const total = data?.data || 0;
        if (contactSeenRef.current > total) {
          contactSeenRef.current = total;
          localStorage.setItem('contact-pending-seen', String(total));
        }
        setContactBadge(Math.max(0, total - contactSeenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(doFetch, 30000);
    return () => clearInterval(t);
  }, [user?.role]);

  const markContactSeen = () => {
    setContactBadge((prev) => {
      const total = prev + contactSeenRef.current;
      contactSeenRef.current = total;
      localStorage.setItem('contact-pending-seen', String(total));
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
  const voiceSocketRef = useSocket({
    onOrderUrgent: (data: any) => {
      if (user?.role === 'COMPANION') setUrgentOrder(data);
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
        CS: '/cs/dispatch',
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
    const rvCount = reviewBadge;
    const REVIEW_LABELS = ['工作室管理', '实名审核'];
    const CHAT_LABELS = ['陪玩管理', '员工管理', '首页'];
    const CONTACT_LABELS = ['订单管理'];
    const REVIEW_WORK_LABELS = ['陪玩管理', '陪玩'];
    return items.map((item) => {
      // Check children (group items) for badge targets
      if (item.children) {
        const hasPending = item.children.some((c: any) => REVIEW_LABELS.includes(c.label) && pCount > 0);
        const hasBridgePending = item.children.some((c: any) => c.label === '工作室桥接' && bpCount > 0);
        const hasBilling = item.children.some((c: any) => c.label === '报账系统' && bCount > 0);
        const hasUnread = item.children.some((c: any) => CHAT_LABELS.includes(c.label) && totalUnread > 0);
        const hasReview = item.children.some((c: any) => REVIEW_WORK_LABELS.includes(c.label) && rvCount > 0);
        if (hasPending || hasBridgePending || hasBilling || hasUnread || hasReview) {
          return {
            ...item,
            children: item.children.map((child: any) => {
              if (REVIEW_LABELS.includes(child.label) && pCount > 0) {
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
                      <Badge count={pCount} size="small" overflowCount={99} style={{ boxShadow: '0 0 10px #FF4757' }} />
                    </span>
                  ),
                };
              }
              if (child.label === '工作室桥接' && bpCount > 0) {
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
                        count={bpCount}
                        size="small"
                        overflowCount={99}
                        style={{ boxShadow: '0 0 10px #FF4757' }}
                      />
                    </span>
                  ),
                };
              }
              if (child.label === '报账系统' && bCount > 0) {
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
                      <Badge count={bCount} size="small" overflowCount={99} style={{ boxShadow: '0 0 10px #FF4757' }} />
                    </span>
                  ),
                };
              }
              if (REVIEW_WORK_LABELS.includes(child.label) && rvCount > 0) {
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
                        count={rvCount}
                        size="small"
                        overflowCount={99}
                        style={{ boxShadow: '0 0 10px #FAAD14' }}
                      />
                    </span>
                  ),
                };
              }
              if (CHAT_LABELS.includes(child.label) && totalUnread > 0) {
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
                        count={totalUnread}
                        size="small"
                        overflowCount={99}
                        style={{ boxShadow: totalUnread > 0 ? '0 0 10px #FF4757' : undefined }}
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
      if (CONTACT_LABELS.includes(item.label as string) && cCount > 0) {
        return {
          ...item,
          label: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {item.label}
              <Badge count={cCount} size="small" overflowCount={99} style={{ boxShadow: '0 0 10px #F59E0B' }} />
            </span>
          ),
        };
      }
      if (CHAT_LABELS.includes(item.label as string) && totalUnread > 0) {
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
  }, [user, totalUnread, pendingBadge, bridgePendingBadge, billingBadge, contactBadge]);

  const selectedKeys = useMemo(() => {
    const path = location.pathname;
    const matched = menuItems
      .map((item) => item.key)
      .filter((key) => path.startsWith(key))
      .sort((a, b) => b.length - a.length);
    return matched.length > 0 ? [matched[0]] : [];
  }, [location.pathname, menuItems]);

  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    markSeen();
    markBridgeSeen();
    markBillingSeen();
    markContactSeen();
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
      <Layout style={{ minHeight: '100vh' }}>
        {/* ── 浅色侧边栏 ── */}
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={null}
          width={170}
          collapsedWidth={48}
          style={{
            background: '#FFFFFF',
            borderRight: '1px solid #E2E8F0',
            overflow: 'auto',
            height: '100vh',
            position: 'sticky',
            top: 0,
          }}
        >
          {/* 导航菜单 */}
          <Menu
            mode="inline"
            theme="light"
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
            {appVersion && (
              <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>
                客户端 v{appVersion}
              </div>
            )}
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
                  <Badge
                    count={totalUnread}
                    overflowCount={99}
                    size="default"
                    offset={[-2, 8]}
                    className={totalUnread > 0 ? 'badge-pop-active' : undefined}
                  >
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
                        className={totalUnread > 0 ? 'bell-glow-active' : ''}
                      />
                    </div>
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
                  {isCsClient && (
                    <Tag color="cyan" style={{ marginInlineEnd: 0, fontWeight: 600 }}>
                      客服端
                    </Tag>
                  )}
                  {user?.role === 'CS' && myCommission != null && (
                    <Text style={{ color: '#F59E0B', fontSize: 12, fontWeight: 600 }}>
                      本月预计提成 ¥{Number(myCommission).toFixed(2)}
                    </Text>
                  )}
                </>
              )}
              {user?.role !== 'COMPANION' && (
                <Button type="text" icon={IconLogout} onClick={handleLogout} style={{ color: '#64748B' }}>
                  退出
                </Button>
              )}
            </Space>
          </Header>

          {/* 内容区 — 白色圆角容器 */}
          <Content
            style={{
              margin: '20px 20px 20px 0',
              padding: 20,
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
      <CommandPalette open={commandPalette} onClose={() => setCommandPalette(false)} />
      <PartnerCallNotification />
    </ChatProvider>
  );
};

export default AppLayout;
