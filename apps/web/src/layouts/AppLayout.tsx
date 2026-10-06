// craftsman-ignore: TS001,TS002
import React, { useEffect, useMemo, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Space, Spin, Tag, Modal, Badge, Popover, message, notification, Form, Input, Alert } from 'antd';
import type { MenuProps } from 'antd';
import { useSocket } from '../hooks/useSocket';
import { usePolling } from '../hooks/usePolling';
import http from '../api/client';
import { configApi } from '../api/config';
import { ordersApi } from '../api/orders';
// useChatNotification → now handled by ChatProvider
import ErrorBoundary from '../components/ErrorBoundary';
import UrgentOrderPopup from '../components/UrgentOrderPopup';
import { ChatProvider } from '../components/chat/ChatProvider';
import { commander } from '../styles/commander';
import ChatModal from '../components/ChatModal';
import { openChatWindow } from '../utils/chatWindow';
import IncomingCallModal from '../components/IncomingCallModal';
import VoiceCallBar from '../components/VoiceCallBar';
import { useVoiceCall } from '../hooks/useVoiceCall';
import { showSystemNotification, showBannerNotification, playNotificationSound } from '../utils/notify';
import { notifyNotice, recordNotice } from '../utils/notice';
import { useNotifStore, selectUnreadNotices, noticePath } from '../stores/notifStore';
import { usePartnerInviteStore } from '../stores/partnerInviteStore';
import ServiceStartOverlay from '../components/ServiceStartOverlay';
// FloatingChatWidget removed — redundant with bell notification
import { NoticeList } from '../components/NoticeList';
import LeftMessagePanel from '../components/LeftMessagePanel';
import SalaryDetailModal from '../components/SalaryDetailModal';
import GrabSuccessModal from '../components/GrabSuccessModal';
import { BG, BORDER, BRAND, SEMANTIC, TEXT, badgeGlow } from '../styles/tokens';
import { roleMenus, roleLabels, menuBadgeLabel, decorateMenu, rolePage, IconLogout, IconFold, IconUnfold } from '../config/roleMenus';
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
    '.ant-layout-sider .ant-menu-sub, .ant-layout-sider .ant-menu-submenu > .ant-menu, .ant-layout-sider .ant-menu-inline .ant-menu-sub, .ant-menu-dark .ant-menu-sub, .ant-menu-dark .ant-menu-submenu-popup, .ant-menu-dark .ant-menu-submenu > .ant-menu { background: var(--color-bg-sider) !important; background-color: var(--color-bg-sider) !important; }';
  document.head.appendChild(s3);
}

import { BellOutlined, MessageOutlined } from '@ant-design/icons';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useOrderStore } from '../stores/orderStore';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const InviteCountdown: React.FC<{ seconds: number }> = ({ seconds }) => {
  const [left, setLeft] = React.useState(seconds);
  React.useEffect(() => {
    const t = setInterval(() => setLeft((v) => (v <= 1 ? 0 : v - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span style={{ color: SEMANTIC.danger, fontWeight: 600 }}>⏳ {left} 秒后自动取消</span>
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
  // 左侧栏「工资 / 提成」后面那点比例：陪玩 / 店长 / 客服各拿流水的百分之几。
  // 和「设置 → 分账规则」是同一份配置（页面加载一次，改完设置刷新页面即同步）。
  const [shareRatios, setShareRatios] = React.useState<Record<string, number | null>>({});
  React.useEffect(() => {
    if (user?.role !== 'OWNER' && user?.role !== 'ADMIN') return;
    configApi
      .get([
        'revenue.share_tiers',
        'revenue.club_companion_share',
        'commission.cs_offline_rate_percent',
        'commission.admin_offline_rate_percent',
      ])
      .then(({ data }: any) => {
        const cfg = data?.data ?? {};
        const tiers = Array.isArray(cfg['revenue.share_tiers']) ? cfg['revenue.share_tiers'] : [];
        const companions = tiers
          .map((t: any) => Number(t?.companion))
          .filter((n: number) => Number.isFinite(n));
        setShareRatios({
          // 陪玩那一栏按流水有多个档，左侧栏显示**最高那一档**，一眼看到最好能拿到多少。
          companion: companions.length
            ? Math.max(...companions)
            : Number(cfg['revenue.club_companion_share']) || null,
          admin: Number(cfg['commission.admin_offline_rate_percent']) || 0,
          cs: Number(cfg['commission.cs_offline_rate_percent']) || 0,
        });
      })
      .catch(() => {});
  }, [user?.role]);
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
    // 这台电脑跑的是哪个客户端：客服端没有 setRole / onStatusChanged 这些陪玩端专属接口。
    // 不分开的话，老板 / 店长用陪玩端登录时也会报一条「客服端版本」，
    // 管理端看起来就是「黄浩 未更新」这种假警报（那台机器上根本没装客服端）。
    const clientKind = api.setRole ? 'companion' : 'cs';
    const report = () => {
      api.getAppVersion().then((v: string) => {
        http.post('/agent/cs-heartbeat', { agentVersion: v, clientKind }).catch(() => {});
      }).catch(() => {});
    };
    report();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') report();
    }, 60_000);
    // 老板 2026-09-21 报「hanlei1 又掉线了」：窗口最小化 / 收进托盘时浏览器不发心跳，
    // 人员列表就把他算成离线。窗口一恢复可见立刻补报一次，秒回在线。
    const onVisible = () => {
      if (document.visibilityState === 'visible') report();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
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
  // 右上角铃铛 = 只放通知（老板 2026-09-30：「铃铛那里去除聊天的信息，只保留其他的通知」）。
  // 聊天未读不再进铃铛：左侧消息面板（私聊 + 群聊）+ 导航角标 + 提示音/Windows 通知都还在。
  const unreadNotices = useNotifStore(selectUnreadNotices);
  useEffect(() => {
    useNotifStore.getState().hydrate(user?.id || null);
  }, [user?.id]);
  // 老板 2026-10-04：提醒除了「右下角弹窗 + 右上角铃铛」，左侧栏对应菜单也要挂角标。
  // 每条通知都指着一个页面（href），按归一化路径分堆，菜单项就按自己的路由领角标。
  const notifItems = useNotifStore((s) => s.items);
  const markNoticesReadByPath = useNotifStore((s) => s.markReadByPath);
  const { unreadByPath, titlesByPath } = useMemo(() => {
    const map: Record<string, number> = {};
    const titles: Record<string, string[]> = {};
    for (const it of notifItems) {
      if (it.read) continue;
      const path = noticePath(it.href);
      if (!path) continue;
      map[path] = (map[path] || 0) + 1;
      (titles[path] || (titles[path] = [])).push(it.title);
    }
    return { unreadByPath: map, titlesByPath: titles };
  }, [notifItems]);
  // 老板 2026-10-05：「工作抽查异常」的通知点进「陪玩管理」什么都没有。
  // 根因：这类通知早先的跳转地址指向泛泛的审核页（老板账号是 /owner/review），
  // 左侧栏角标和页面横幅自然都挂在那张页面上，人却按提示去「陪玩管理」找。
  // 这里按标题里的名字，把这一类老通知的 href 校正到「陪玩管理 → 这个人的工作记录」。
  const patchNotice = useNotifStore((s) => s.patch);
  const markNoticeRead = useNotifStore((s) => s.markRead);
  const workAlertBase = user?.role === 'CS' ? '/cs/employees' : '/admin/companions';
  const workAlertHref = (name: string) =>
    `${workAlertBase}?role=COMPANION&workName=${encodeURIComponent(name)}`;
  useEffect(() => {
    for (const it of notifItems) {
      const title = String(it.title || '');
      if (!title.startsWith('工作抽查异常 · ')) continue;
      if (it.href && (it.href.includes('workName') || it.href.includes('workCompanion'))) continue;
      const name = title.slice('工作抽查异常 · '.length).trim();
      if (!name) continue;
      patchNotice(it.id, { href: workAlertHref(name) });
    }
    // 校正过一条 href 就带 workName 了，下一轮不会再匹配 —— 不会打转。
  }, [notifItems, patchNotice, workAlertBase]);
  // 老板 2026-10-05：「订单管理有未读，我点进去也没看到什么变化」——
  // 点菜单只把角标数字清掉、页面里什么都不留，人根本不知道刚才那几条提醒是什么。
  // 所以「刚点掉的是哪几条」按页面路径记在这，进到那一页顶头再写一遍（见下面内容区横幅）。
  const CLEARED_TTL_MS = 10 * 60 * 1000;
  const [clearedNotices, setClearedNotices] = React.useState<
    Record<string, { titles: string[]; at: number }>
  >({});
  const rememberCleared = useCallback((path: string, titles: string[]) => {
    if (!path || !titles.length) return;
    setClearedNotices((prev) => {
      const old = prev[path];
      const fresh = old && Date.now() - old.at < CLEARED_TTL_MS ? old.titles : [];
      // 合并去重：点菜单时通知角标和「待开始订单」角标可能一起被清掉，两条提示都要留着。
      const merged = Array.from(new Set([...fresh, ...titles]));
      return { ...prev, [path]: { titles: merged, at: Date.now() } };
    });
  }, []);
  const forgetCleared = useCallback((path: string) => {
    setClearedNotices((prev) => {
      if (!prev[path]) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }, []);

  // 点左侧栏那一项 = 把指向这个页面的未读通知都消掉（跟点铃铛条目、点弹窗一个效果）。
  const clearNoticesByKey = useCallback(
    (key: string) => {
      const path = noticePath(key);
      if (!path) return;
      // 老板 2026-10-05：「点进去发现没任何变化」——角标一点就消、又不说是什么，人会懵。
      // 一边把刚标为已读的是哪几条记下来（页面顶头横幅再写一遍，不会被一闪而过的提示漏看），
      // 一边用一条轻提示念出来兜底。
      const titles = titlesByPath[path] || [];
      if (titles.length) {
        rememberCleared(path, titles);
        message.info(
          `这里刚才有 ${titles.length} 条提醒（已标已读）：${titles.slice(0, 2).join(' · ')}${
            titles.length > 2 ? ` 等 ${titles.length} 条` : ''
          }`,
          6,
        );
      }
      markNoticesReadByPath(path);
    },
    [markNoticesReadByPath, titlesByPath, rememberCleared],
  );
  const { grabbedOrder, setGrabbedOrder } = useOrderStore();

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


  // 待处理总数（老板 2026-10-06）：店长 / 老板 / 客服上班先看这个数。
  // 跟别的角标不一样 —— 这个是**真实待办条数**，不是「点过就消」的未读：活儿没干完数字就一直在。
  const [todosBadge, setTodosBadge] = React.useState(0);
  const [todosHint, setTodosHint] = React.useState('');
  React.useEffect(() => {
    if (user?.role !== 'OWNER' && user?.role !== 'ADMIN' && user?.role !== 'CS') return;
    let alive = true;
    const doFetch = async () => {
      try {
        const { data } = await http.get('/todos');
        if (!alive) return;
        const d = data?.data || {};
        setTodosBadge(Number(d.total) || 0);
        setTodosHint(
          (Array.isArray(d.groups) ? d.groups : [])
            .slice(0, 4)
            .map((g: any) => `${g.label}：${g.count} 条`)
            .join('\n'),
        );
      } catch {}
    };
    doFetch();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') doFetch();
    }, 120000);
    return () => { alive = false; clearInterval(t); };
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

  /**
   * 「成交核对」角标（老板 2026-10-06）：「最好每天要求管理端去核对」——
   * 客服 / 店长 / 老板的「订单管理 → 成交核对」上挂一个红数字，就是**待店长拍板的失败单**有几张。
   * 这不是「看过就消」的通知角标，而是真有一张没拍板就一直在（拍完自动消失）。
   */
  const [outcomeReviewBadge, setOutcomeReviewBadge] = React.useState(0);
  useEffect(() => {
    if (!user || !['OWNER', 'ADMIN', 'CS'].includes(user.role)) return;
    const doFetch = async () => {
      try {
        const { data } = await http.get('/orders/reviews/summary');
        setOutcomeReviewBadge(Number(data?.data?.waiting || 0));
      } catch {
        /* 拿不到就当作没有，别把菜单弄崩 */
      }
    };
    doFetch();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') doFetch();
    }, 60000);
    return () => clearInterval(t);
  }, [user?.role, user?.id]);

  // Chat 3.0: notification handled by ChatProvider

  // 打开一个聊天窗口：优先开成「独立的系统窗口」（陪玩端 / 客服端是真的应用窗口，任务栏有
  // 按钮、能原生最小化；浏览器里是弹窗），弹窗被浏览器拦了才退回页内那个全局浮窗。
  // 同一个人只会有一个窗口：Electron 主进程按 userId 去重，浏览器按窗口名去重。
  const openChatTarget = useCallback((target: any) => {
    setNotifOpen(false);
    if (target?.conversationId && openChatWindow(target)) return;
    setGlobalChatPartner(target);
  }, []);

  // Listen for open-chat-modal event from CSDispatchView / 订单页 / 客户页 / 订单池
  useEffect(() => {
    const handler = (e: CustomEvent) => openChatTarget(e.detail);
    window.addEventListener('open-chat-modal', handler as EventListener);
    return () => window.removeEventListener('open-chat-modal', handler as EventListener);
  }, [openChatTarget]);

  // 打开和某个人的私聊：左侧消息面板点人、订单/客户页点「沟通」都走这里
  const openDirectChat = useCallback((conversationId: string, participantName: string) => {
    const conv = useChatStore.getState().conversations[conversationId];
    setNotifOpen(false);
    openChatTarget({
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
  }, [openChatTarget]);

  // Open the studio group chat from the persistent left-side message panel.
  const openGroupChat = useCallback((conversationId: string, groupName: string) => {
    const conv = useChatStore.getState().conversations[conversationId];
    openChatTarget({
      conversationId,
      participant: conv?.participant || {
        userId: '',
        username: groupName,
        displayName: groupName,
        role: 'GROUP',
      },
    });
    useChatStore.getState().markRead(conversationId);
  }, [openChatTarget]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
  // 待处理搭档邀请（老板 2026-10-03）：状态放共享 store，右下角「客服广播那种横幅」点一下
  // → 订单管理页，在最上面那张卡片里同意 / 拒绝；不再弹软件内模态框。
  // 右上角铃铛只留作兜底入口。
  const [partnerInviteOpen, setPartnerInviteOpen] = React.useState(false);
  const partnerInvites = usePartnerInviteStore((s) => s.invites);
  const addPartnerInvite = usePartnerInviteStore((s) => s.add);
  const removePartnerInvite = usePartnerInviteStore((s) => s.remove);
  const prunePartnerInvites = usePartnerInviteStore((s) => s.prune);
  // 待我确认的订单转让申请（老板 2026-10-03：「想转让的订单，需要被转让方同意才能过来，要不然乱套了」）：
  // 主入口是**订单列表里那一行的「接手 / 拒绝」**（老板 2026-10-03 否掉了自动弹窗：
  // 「放在订单列表那一行点转让或者点接受不行么」）；顶栏这个铃铛只是再留一份，
  // 方便在别的页面也能一眼看到有几单在等我确认。
  const [transferReqs, setTransferReqs] = React.useState<any[]>([]);
  const [transferReqOpen, setTransferReqOpen] = React.useState(false);

  // 点 Windows 新单横幅 → 跳到抢单池并把这一单标出来（老板 2026-10-01：「跳转进池子再抢」）。
  // 不直接抢：正在打游戏的人万一误点了，会把不该报的单抢到手里。
  React.useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onOrderPoolFocus) return;
    const off = api.onOrderPoolFocus((p: any) => {
      const orderId = String(p?.orderId || '');
      const path = rolePage(user?.role, 'pool') || '/companion/pool';
      window.dispatchEvent(new CustomEvent('chunlv:order-focus', { detail: { orderId } }));
      navigate(path, { state: { highlightOrderId: orderId } });
    });
    return () => {
      try {
        off?.();
      } catch {
        /* 已经卸载了 */
      }
    };
  }, [navigate, user?.role]);

  // 点横幅上的动作 → 打开对应界面（老板 2026-10-03：「所有涉及弹窗或者邀请的，
  // 都给我做成客服发布订单时广播那个效果，点了能直接跳转」）。
  // 跟新单横幅那条 order-pool-focus 同一套：主进程先把窗口拉到前台，再把动作回执给界面。
  React.useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onBannerAction) return;
    const off = api.onBannerAction((msg: any) => {
      const action = String(msg?.action || '');
      const payload = msg?.payload || {};
      try {
        if (action === 'open-transfer') {
          setTransferReqOpen(true);
        } else if (action === 'open-orders') {
          navigate(rolePage(user?.role, 'orders') || '/companion/orders');
        } else if (action === 'open-billing') {
          navigate(rolePage(user?.role, 'billing') || '/companion/orders');
        } else if (action === 'open-pool') {
          navigate(rolePage(user?.role, 'pool') || '/companion/pool');
        } else if (action === 'open-chat') {
          const convId = String(payload?.conversationId || '');
          if (convId) {
            if (payload?.isGroup) openGroupChat(convId, String(payload?.groupName || '工作室群聊'));
            else openDirectChat(convId, String(payload?.participantName || '会话'));
          }
        }
      } catch {
        /* 打不开也不影响接单主流程 */
      }
    });
    return () => {
      try {
        off?.();
      } catch {
        /* 已经卸载了 */
      }
    };
  }, [navigate, user?.role, openDirectChat, openGroupChat]);

  // 右下角通知弹窗被点了一下（utils/notice.ts 派发的自定义事件）→ 跳到通知指向的页面。
  React.useEffect(() => {
    const onNoticeGoto = (e: Event) => {
      const href = (e as CustomEvent)?.detail?.href;
      if (href) navigate(String(href));
    };
    window.addEventListener('chunlv:notice-goto', onNoticeGoto as EventListener);
    return () => window.removeEventListener('chunlv:notice-goto', onNoticeGoto as EventListener);
  }, [navigate]);

  const addTransferReq = React.useCallback((req: any) => {
    setTransferReqs((prev) => {
      const key = req?.requestId || req?.id;
      if (!key || prev.some((p) => (p.requestId || p.id) === key)) return prev;
      return [...prev, req];
    });
  }, []);

  const removeTransferReq = React.useCallback((requestId: string) => {
    setTransferReqs((prev) => prev.filter((p) => (p.requestId || p.id) !== requestId));
  }, []);

  const acceptTransferReq = React.useCallback(
    async (req: any) => {
      const requestId = req?.requestId || req?.id;
      if (!requestId) return;
      try {
        await ordersApi.acceptTransfer(requestId);
        message.success('已同意转让，这张单现在归你了');
        removeTransferReq(requestId);
        window.dispatchEvent(new Event('chunlv:transfer-updated'));
        window.dispatchEvent(new Event('chunlv:order-pool-updated'));
      } catch (e: any) {
        message.error(e?.response?.data?.message || '同意失败');
      }
    },
    [removeTransferReq],
  );

  const rejectTransferReq = React.useCallback(
    async (req: any) => {
      const requestId = req?.requestId || req?.id;
      if (!requestId) return;
      try {
        await ordersApi.rejectTransfer(requestId);
        message.success('已拒绝，这张单还在对方名下');
      } catch (e: any) {
        message.error(e?.response?.data?.message || '拒绝失败');
      }
      removeTransferReq(requestId);
      window.dispatchEvent(new Event('chunlv:transfer-updated'));
    },
    [removeTransferReq],
  );

  // 转让申请有 30 分钟有效期：过期自己从铃铛里消失。
  useEffect(() => {
    const t = setInterval(() => {
      setTransferReqs((prev) => {
        const now = Date.now();
        const next = prev.filter((p) => !p.expiresAt || p.expiresAt > now);
        return next.length === prev.length ? prev : next;
      });
    }, 3000);
    return () => clearInterval(t);
  }, []);

  // 刷新 / 断线重连后把还没处理的转让申请补回来（WS 只在发生时推一次）。
  useEffect(() => {
    if (!user?.companionId) return;
    const load = () => {
      ordersApi
        .myTransferRequests()
        .then((res: any) => {
          const incoming = res?.data?.data?.incoming || [];
          setTransferReqs(incoming.filter((r: any) => r.valid !== false));
        })
        .catch(() => {});
    };
    load();
    const onUpdated = () => load();
    window.addEventListener('chunlv:transfer-updated', onUpdated);
    return () => window.removeEventListener('chunlv:transfer-updated', onUpdated);
  }, [user?.companionId]);

  // 自动清理已过期的搭档邀请，避免铃铛里残留（订单管理页那张卡片里也会兜底清理）。
  useEffect(() => {
    const t = setInterval(prunePartnerInvites, 3000);
    return () => clearInterval(t);
  }, [prunePartnerInvites]);

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
      recordNotice({
        kind: 'invite',
        icon: '🤝',
        title: `搭档邀请 · ${inviter}`,
        desc,
        dedupeKey: `partner-invite:${data.id}`,
        dedupeMs: 60_000,
      });
      // 老板 2026-10-03：删掉 Windows 弹窗，只留「客服广播那种」置顶横幅 ——
      // 点一下直接打开「订单管理」，在最上面那张卡片里同意 / 拒绝。
      showBannerNotification({
        title: '🤝 搭档邀请',
        body: desc,
        icon: '🤝',
        seconds: 20,
        hint: '点这里 → 打开订单管理，同意搭档邀请',
        action: 'open-orders',
        actionPayload: { sessionId: data.id },
      });
      playNotificationSound();
    },
    onOrderTransferred: (data: any) => {
      // 有人把单转给我（老板 2026-09-29）：弹一条提醒并刷新接单记录，
      // 别让陪玩端着电脑还不知道自己名下来了单。
      if (data?.toCompanionId && user?.companionId && data.toCompanionId !== user.companionId) return;
      notifyNotice({
        kind: 'order',
        icon: '🔁',
        title: '🔁 有人把订单转让给你',
        desc: `${data?.fromName || '同事'}把「${data?.gameName || ''}」转给了你，去「接单记录」看`,
        href: rolePage(user?.role, 'orders'),
        toast: 'info',
        duration: 6,
      });
      try {
        playNotificationSound();
      } catch {
        /* 声音播不出来不影响提醒 */
      }
      window.dispatchEvent(new Event('chunlv:order-pool-updated'));
    },
    onTransferRequested: (data: any) => {
      // 有人想把单转给我：先问我要不要（老板 2026-10-03，转让必须经被转让方同意）。
      if (!user?.companionId || !data?.requestId) return;
      const fromName = data.fromName || '同事';
      const expiresAt = Date.now() + (Number(data.expiresInSec) || 1800) * 1000;
      addTransferReq({ ...data, fromName, expiresAt });
      const desc = `${data.orderCode || ''} ${data.gameName || ''} · ¥${Number(data.amount || 0).toFixed(1)}${
        data.reason ? ` · ${data.reason}` : ''
      }`;
      recordNotice({
        kind: 'invite',
        icon: '🔁',
        title: `🔁 ${fromName} 想把订单转给你`,
        desc,
        dedupeKey: `transfer-req:${data.requestId}`,
        dedupeMs: 60_000,
      });
      showBannerNotification({
        title: '🔁 订单转让',
        body: `${fromName} 想把「${data.gameName || '订单'}」转给你`,
        icon: '🔁',
        seconds: 20,
        hint: '点这里 → 打开「待我确认的转让」',
        action: 'open-transfer',
        actionPayload: { requestId: data.requestId },
      });
      playNotificationSound();
    },
    onTransferAccepted: (data: any) => {
      notifyNotice({
        kind: 'order',
        icon: '✅',
        title: '✅ 转让已被同意',
        desc: `${data?.toName || '对方'} 同意了，这张单已经转到他名下`,
        href: rolePage(user?.role, 'orders'),
        toast: 'success',
        duration: 5,
      });
      window.dispatchEvent(new Event('chunlv:transfer-updated'));
      window.dispatchEvent(new Event('chunlv:order-pool-updated'));
    },
    onTransferRejected: (data: any) => {
      notifyNotice({
        kind: 'order',
        icon: '🙅',
        title: '🙅 转让被拒绝',
        desc: `${data?.byName || '对方'} 没接这张单${data?.reason ? `（${data.reason}）` : ''}，单还在你名下`,
        href: rolePage(user?.role, 'orders'),
        toast: 'warning',
        duration: 6,
      });
      window.dispatchEvent(new Event('chunlv:transfer-updated'));
    },
    onTransferCancelled: (data: any) => {
      // 两条路都走这里：对方撤回了申请，或我重新发起把旧申请顶掉了。
      if (data?.requestId) removeTransferReq(data.requestId);
      window.dispatchEvent(new Event('chunlv:transfer-updated'));
    },
    onTransferExpired: (data: any) => {
      if (data?.requestId) removeTransferReq(data.requestId);
      notifyNotice({
        kind: 'order',
        icon: '⏰',
        title: '⏰ 转让申请已作废',
        desc: data?.message || '这条转让申请长时间没人确认，已自动作废',
        toast: 'info',
        duration: 5,
      });
      window.dispatchEvent(new Event('chunlv:transfer-updated'));
    },
    onFeedbackChase: (data: any) => {
      // 发单那边的客服在催这一单的结果（老板 2026-09-30：「待反馈……看得见、催得动」）。
      // 这条推给**接单工作室**（桥接店 / 线上俱乐部）的客服和店长：提醒他们去「接单看板」记结果。
      notification.warning({
        message: '📣 对方在催这一单的结果',
        description: `${data?.fromName || '发单客服'} 催「${data?.orderCode || ''} ${data?.gameName || ''}」的接单结果${
          data?.chaseCount ? `（已催 ${data.chaseCount} 次）` : ''
        }，去「客服提成 · 今日看板 → 今天我们店接的单」记一下成功 / 不成功`,
        placement: 'bottomRight',
        duration: 10,
      });
      try {
        playNotificationSound();
      } catch {
        /* 声音播不出来不影响提醒 */
      }
      window.dispatchEvent(new Event('chunlv:received-board-updated'));
    },
    onPartnerAccepted: (data: any) => {
      notifyNotice({
        kind: 'invite',
        icon: '✅',
        title: '✅ 搭档已同意',
        desc: '开始计时，进入接单中，用心服务',
        toast: 'success',
        duration: 4,
      });
      (window as any).electronAPI?.sessionWatch?.(data.sessionId);
      window.dispatchEvent(new Event('chunlv:service-started'));
    },
    onPartnerRejected: (data: any) => {
      notifyNotice({
        kind: 'invite',
        icon: '🙅',
        title: '🙅 搭档已拒绝',
        desc: `${data?.partnerName || '搭档'} 拒绝了你的搭档邀请`,
        toast: 'warning',
        duration: 4,
      });
      window.dispatchEvent(new Event('chunlv:dual-invite-expired'));
    },
    onPartnerTimeout: (data: any) => {
      notifyNotice({
        kind: 'invite',
        icon: '⏰',
        title: '⏰ 搭档未回应',
        desc: '搭档在倒计时内未回应，邀请已自动取消',
        toast: 'info',
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
      recordNotice({
        kind: 'invite',
        icon: '📣',
        title: '📣 广播找搭档',
        desc,
        dedupeKey: `dual-invite:${data.sessionId}`,
        dedupeMs: 60_000,
      });
      showBannerNotification({
        title: '📣 广播找搭档',
        body: desc,
        icon: '📣',
        seconds: 20,
        hint: '点这里 → 打开订单管理，同意搭档邀请',
        action: 'open-orders',
        actionPayload: { sessionId: data.sessionId },
      });
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
      notifyNotice({
        kind: 'order',
        icon: '🤝',
        title: '🤝 有陪玩把订单交给你',
        desc: '已进入接单中，用心服务',
        href: rolePage(user?.role, 'orders'),
        toast: 'success',
        duration: 4,
      });
      (window as any).electronAPI?.sessionWatch?.(data?.sessionId);
      window.dispatchEvent(new Event('chunlv:service-started'));
    },
    onSegmentFinished: (data: any) => {
      const amount = Number(data?.amount || 0).toFixed(1);
      const desc = data?.message || `你这一段服务已结束，本段计入流水 ¥${amount}`;
      notifyNotice({
        kind: 'order',
        icon: '🏁',
        title: '🏁 这一段服务已结束',
        desc,
        href: rolePage(user?.role, 'orders'),
        toast: 'info',
        duration: 6,
      });
      showBannerNotification({
        title: '🏁 这一段服务已结束',
        body: desc,
        icon: '🏁',
        seconds: 12,
        hint: '点这里 → 去接单记录看',
        action: 'open-orders',
      });
    },
    onServiceDurationReminder: (data: any) => {
      // 老板 2026-10-05：「不点结束不会计入影响评分增加，让他们主动点」——
      // 这条提醒现在带「不点结束不计流水/不算分」，而且服务端每 30 分钟会再推一次（没结束就一直提醒）。
      const desc =
        data?.message ||
        '服务时间已到，请引导客户续单；打完记得点「结束服务」，不点结束这一单不算流水也不算分';
      const overdue = Number(data?.overdueMin) || 0;
      const title = overdue >= 5 ? '⏰ 还没点「结束服务」' : '⏰ 时间到了';
      notifyNotice({
        kind: 'order',
        icon: '⏰',
        title,
        desc,
        href: rolePage(user?.role, 'orders'),
        toast: 'warning',
        duration: 8,
        // 同一段服务 30 分钟内只在铃铛里留一条，别把通知中心刷满
        dedupeKey: `duration-reminder:${data?.sessionId || ''}`,
        dedupeMs: 30 * 60 * 1000,
      });
      showBannerNotification({
        title,
        body: desc,
        icon: '⏰',
        seconds: 20,
        hint: '点这里 → 去接单记录点「结束服务」',
        action: 'open-orders',
      });
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
        // 老板 2026-10-01：新单只弹 Windows 桌面横幅（15 秒），软件里那张右下角卡片不再弹。
        // 横幅只在陪玩客户端里有；浏览器里打开时没有横幅，保留卡片兑底，免得什么都看不见。
        if (!(window as any).electronAPI?.orderBannerClick) setUrgentOrder(data);
        window.dispatchEvent(new Event('chunlv:order-pool-updated'));
        // 老板 2026-09-22 报「邵泽慧发广播单，所有人都没弹窗提示」：
        // 以前只有窗口里那张右下角卡片，窗口被游戏挡住 / 缩到托盘时看不到也听不到，
        // 一单就这么错过了。这里补上提示音 + Windows 系统通知，后台也能被叫到。
        playNotificationSound();
        const urgentDesc = `${data?.gameName || '新订单'} · ¥${Number(data?.amount || 0).toFixed(0)} · ${
          data?.duration || 1
        }h · ${data?._createdBy || '系统'} 发布，快去抢`;
        recordNotice({
          kind: 'order',
          icon: data?._direct ? '🎯' : '⚡',
          title: data?._direct ? '🎯 客服指定给你接单' : `⚡ 新订单 · ${data?.gameName || ''}`,
          desc: urgentDesc,
          href: '/companion/pool',
          dedupeKey: `urgent:${data?.id || data?.orderCode || urgentDesc}`,
          dedupeMs: 5 * 60_000,
        });
        // 陪玩客户端里，主进程收到 order:urgent 已经画了那张能点的桌面横幅（见 electron/main.ts），
        // 这里不再补一条「点了没反应、还容易被系统吞掉」的系统通知；只有浏览器里打开时才兜底。
        if (!(window as any).electronAPI?.broadcastPopup) {
          showBannerNotification({
            title: data?._direct ? '🎯 客服指定给你接单' : `⚡ 新订单 · ${data?.gameName || ''}`,
            body: urgentDesc,
            icon: data?._direct ? '🎯' : '⚡',
            seconds: 15,
            hint: '点这里 → 去抢单池看这单',
            action: 'open-pool',
          });
        }
      }
    },
    onScheduledReminder: (data: any) => {
      if (user?.role === 'CS' || user?.role === 'ADMIN' || user?.role === 'OWNER') {
        const text = data.message || '你发布的预约单已超时未接，请跟进对接客户';
        message.warning({ content: text, duration: 10 });
        recordNotice({
          kind: 'order',
          icon: '⏰',
          title: '预约单超时未接',
          desc: text,
          href: rolePage(user?.role, 'orders'),
        });
      }
    },
    onWalletReviewed: (data: any) => {
      const text = data.message || `支取 ¥${data.amount} ${data.status === 'APPROVED' ? '已通过' : '已拒绝'}`;
      message.info(text);
      recordNotice({
        kind: 'finance',
        icon: '💰',
        title: data.status === 'APPROVED' ? '支取已通过' : '支取被拒绝',
        desc: text,
        href: rolePage(user?.role, 'billing'),
      });
    },
    onUserAuthorized: (data: any) => {
      const text = data.message || '注册申请已通过审核';
      message.success(text, 6);
      recordNotice({ kind: 'audit', icon: '✅', title: '注册申请已通过审核', desc: text });
    },
    onUserRejected: (data: any) => {
      const text = data.message || '注册申请未通过审核';
      message.warning(text, 6);
      recordNotice({ kind: 'audit', icon: '⛔', title: '注册申请未通过审核', desc: text });
    },
    onWorkWechatRequest: (data: any) => {
      // 陪玩自己填了工作微信，等管理端审核（老板 2026-10-02）
      const text = data?.wechatId
        ? `有陪玩提交了工作微信「${data.wechatId}」，待审核`
        : '有陪玩提交了工作微信，待审核';
      message.info(text, 8);
      recordNotice({
        kind: 'audit',
        icon: '📱',
        title: '待审核：陪玩提交的工作微信',
        desc: text,
        href: rolePage(user?.role, 'work-wechats'),
      });
    },
    onSupplementRequest: (data: any) => {
      // 陪玩点了「添加失败」提交补单申请（老板 2026-10-04：这种交互双方都要有提示）
      const isMgmt = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS';
      if (!isMgmt) return;
      const text = data?.message || '有陪玩提交了补单申请，待审核';
      message.info(text, 8);
      recordNotice({
        kind: 'audit',
        icon: '🧾',
        title: '待审核：补单申请',
        desc: text,
        href: rolePage(user?.role, 'orders'),
        dedupeKey: `supplement-req-${data?.orderId || data?.companionId || ''}`,
        dedupeMs: 60 * 1000,
      });
      // 让「订单管理 → 补单审核」的红点立刻刷新（否则要等它自己的 60 秒轮询）
      window.dispatchEvent(new CustomEvent('supplement:refresh'));
    },
    onSupplementDecided: (data: any) => {
      // 管理端同意 / 驳回补单 → 实时告诉陪玩本人（老板 2026-10-04）
      if (user?.role !== 'COMPANION') return;
      const approved = data?.approved !== false;
      const text =
        data?.message || (approved ? '管理端已同意补单，你的抢单次数 +1' : '管理端驳回了补单申请');
      if (approved) message.success(text, 8);
      else message.warning(text, 8);
      recordNotice({
        kind: 'audit',
        icon: approved ? '✅' : '⛔',
        title: approved ? '补单已同意：抢单次数 +1' : '补单被驳回',
        desc: data?.note ? `${text}（备注：${data.note}）` : text,
        href: rolePage(user?.role, 'orders'),
      });
    },
    onOrderContactReminder: (data: any) => {
      // 抢单后迟迟没标「添加成功 / 添加失败」→ 定期提醒陪玩本人（老板 2026-10-04）
      const text = data?.message || '订单还没标记「添加成功 / 添加失败」，记得处理';
      const stage = Number(data?.stage) || 1;
      const title = stage > 1 ? `🔔 再次提醒（第 ${stage} 次）` : '🔔 记得标记客户微信';
      notifyNotice({
        kind: 'order',
        icon: '🔔',
        title,
        desc: text,
        href: rolePage(user?.role, 'orders'),
        toast: 'warning',
        duration: 8,
      });
      showBannerNotification({
        title,
        body: text,
        icon: '🔔',
        seconds: 15,
        hint: '点这里 → 去订单管理标记',
        action: 'open-orders',
      });
    },
    onReviewNotice: (data: any) => {
      // 通用「审核 / 交互」提醒（老板 2026-10-04）：
      // 报账 / 支取 / 战绩图 / 客户删除申请 / 封存解封 / 桥接 / 注册 —— 提交方和审核方双方都能收到。
      const isMgmt = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS';
      const isCompanion = user?.role === 'COMPANION';
      const audience = data?.audience;
      if (audience === 'MGMT' && !isMgmt) return;
      if (audience === 'COMPANION' && !isCompanion) return;
      notifyNotice({
        kind: data?.kind || 'audit',
        icon: data?.icon || '🔔',
        title: data?.title || '有新的待办',
        desc: data?.desc || '',
        href: rolePage(user?.role, data?.hrefKey || 'orders'),
        toast: data?.toast || 'info',
        duration: 8,
        dedupeKey: data?.dedupeKey,
        dedupeMs: data?.dedupeMs || 60 * 1000,
      });
    },
    onOrderContactReminderAdmin: (data: any) => {
      // 客户微信满 3 天 / 满 7 天没处理（老板 2026-10-04）：
      // 只落进「待办」（右上角铃铛，带红点角标），不弹窗打扰；
      // 人工去对应的小红书账号私信问问客户还加不加，客户也不回就把客户封存起来。
      const isMgmt = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS';
      if (!isMgmt) return;
      const long = data?.kind === 'LONG_PENDING';
      const count = Number(data?.count) || 0;
      const text =
        data?.message ||
        (long ? '有客户挂满 7 天还没通过，请核实' : '有客户 3 天没标记「添加成功 / 添加失败」，请核实');
      recordNotice({
        kind: 'order',
        icon: long ? '🧊' : '🧹',
        title: long
          ? `长期挂起客户${count ? ` ${count} 个` : ''}：去小红书问问 / 该封存了`
          : `客户微信没标记${count ? ` ${count} 个` : ''}：去核实`,
        desc: text,
        href: rolePage(user?.role, 'customers'),
        dedupeKey: `contact-reminder-${data?.kind || 'unknown'}`,
        dedupeMs: 12 * 60 * 60 * 1000,
      });
    },
    onOrderUnstartedReminder: (data: any) => {
      // 老板 2026-10-06：「次日弹一次、后边第七天弹一次，然后进历史记录。」
      // 抢了单一直没点「开始首单」、也没报结果的，服务端只在满 24 小时、满 7 天各催一次（共 2 次）。
      const text =
        data?.message ||
        '你有订单抢到手还没点「开始首单」也没报结果：打成了就点「开始首单」；没打成请点「报结果」，选原因 + 贴截图';
      const count = Number(data?.count) || 0;
      const stage = Number(data?.stage) || 1;
      const maxReminders = Number(data?.maxReminders) || 2;
      const what = count > 1 ? `有 ${count} 单抢了还没点「开始首单」` : '抢了单还没点「开始首单」';
      const title = stage >= maxReminders ? `🔔 最后一次提醒：${what}` : `🔔 ${what}`;
      notifyNotice({
        kind: 'order',
        icon: '🔔',
        title,
        desc: text,
        href: rolePage(user?.role, 'orders'),
        toast: 'warning',
        duration: 8,
        // 同一个人半天内只在铃铛里留一条，别把通知中心刷满
        dedupeKey: `unstarted-reminder:${user?.id || 'me'}`,
        dedupeMs: 12 * 60 * 60 * 1000,
      });
      showBannerNotification({
        title,
        body: text,
        icon: '🔔',
        seconds: 15,
        hint: '点这里 → 去订单管理点「报结果」',
        action: 'open-orders',
      });
    },
    onOrderOutcomeReport: (data: any) => {
      // 接单方报了结果（老板 2026-10-06）：成功 → 计入考核；不成功 → 先由发单客服跟接单方核对，
      // 核对完才轮到店长拍板。所以失败这条只找发单客服（服务端就只推给他）。
      const failed = data?.outcome === 'FAILED';
      const code = data?.orderCode || '这一单';
      const text =
        data?.message ||
        (failed ? `接单方报了「不成功」（${code}），先跟接单方核对一下` : `接单方报了「成功」（${code}）`);
      const title = failed ? `🔔 先跟接单方核对：${code}` : `✅ 接单方报了成功：${code}`;
      notifyNotice({
        kind: 'order',
        icon: failed ? '🔔' : '✅',
        title,
        desc: text,
        href: rolePage(user?.role, 'orders'),
        toast: failed ? 'warning' : 'success',
        duration: 8,
        dedupeKey: `outcome-report:${data?.orderId || code}`,
        dedupeMs: 6 * 60 * 60 * 1000,
      });
      if (failed && user?.role !== 'COMPANION') {
        // 陪玩没有「成交核对」页（发单人不是他时不该弹），所以横幅只给客服 / 店长 / 老板。
        showBannerNotification({
          title,
          body: text,
          icon: '🔔',
          seconds: 15,
          hint: '点这里 → 去「订单管理 → 成交核对」核对',
          action: 'open-orders',
        });
      }
    },
    onOrderOutcomeCsConfirmed: (data: any) => {
      // 客服核对完 → 该店长 / 老板拍板了（老板 2026-10-06）。接单方那边只留一条通知，不弹窗。
      const code = data?.orderCode || '这一单';
      const isReviewer = user?.role === 'OWNER' || user?.role === 'ADMIN';
      notifyNotice({
        kind: 'audit',
        icon: '🧾',
        title: `可以拍板了：${code}`,
        desc: data?.message || '发单客服已跟接单方核对完（双方无异议），等店长拍板',
        href: rolePage(user?.role, 'orders'),
        toast: isReviewer ? 'info' : 'none',
        duration: 8,
        dedupeKey: `outcome-cs-confirmed:${data?.orderId || code}`,
        dedupeMs: 6 * 60 * 60 * 1000,
      });
    },
    onOrderOutcomeRejected: (data: any) => {
      // 店长 / 老板把接单方的「不成功」说明打回了（老板 2026-10-06：乱写就驳回）：
      // 接单方要重新填原因 + 重贴截图再报一次；发单客服先不用核对这张，只留个通知。
      const code = data?.orderCode || '这一单';
      const note = (data?.note || '').toString().trim();
      const isCompanion = user?.role === 'COMPANION';
      notifyNotice({
        kind: 'order',
        icon: '↩️',
        title: isCompanion ? `店长把你的说明打回了：${code}` : `接单方说明被打回：${code}`,
        desc:
          data?.message ||
          (isCompanion
            ? `店长把这张单的「不成功」说明打回了${note ? `（${note}）` : ''}，请重新填清楚原因、重新贴截图再报一次`
            : `店长把接单方的「不成功」说明打回了${note ? `（${note}）` : ''}，让他重填，你先不用核对这张`),
        href: rolePage(user?.role, 'orders'),
        toast: isCompanion ? 'warning' : 'none',
        duration: 10,
        dedupeKey: `outcome-rejected:${data?.orderId || code}`,
        dedupeMs: 6 * 60 * 60 * 1000,
      });
      if (isCompanion) {
        showBannerNotification({
          title: `↩️ 店长打回了 ${code} 的说明`,
          body: (note ? `${note}
` : '') + '请重新填清楚原因、重新贴截图，再报一次结果',
          icon: '↩️',
          seconds: 20,
          hint: '点这里 → 去「订单管理」重新报结果',
          action: 'open-orders',
        });
      }
    },
    onOrderUnstartedReminderAdmin: (data: any) => {
      // 满 7 天还没处理 → 只落进「待办」（右上角铃铛），不弹窗打扰；人工去「成交核对 → 抢了没结果」核。
      const isMgmt = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS';
      if (!isMgmt) return;
      const count = Number(data?.count) || 0;
      recordNotice({
        kind: 'order',
        icon: '🧾',
        title: `抢了没结果的单${count ? ` ${count} 个` : ''}：满 7 天了，去核一下`,
        desc:
          data?.message ||
          '有订单抢走满 7 天还没点「开始首单」也没报结果，去「订单管理 → 成交核对 → 抢了没结果」处理',
        href: rolePage(user?.role, 'orders'),
        dedupeKey: 'unstarted-reminder-admin',
        dedupeMs: 12 * 60 * 60 * 1000,
      });
    },
    onBridgeResponded: (data: any) => {
      const text = data.message || (data.accepted ? '对方已同意桥接申请' : '对方已拒绝桥接申请');
      message.info(text);
      recordNotice({
        kind: 'system',
        icon: data.accepted ? '🔗' : '🚫',
        title: data.accepted ? '桥接申请已同意' : '桥接申请被拒绝',
        desc: text,
      });
    },
    onRevenueDiff: (data: any) => {
      const isMgmt = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS';
      if (isMgmt && data.message) {
        message.warning({ content: data.message, duration: 10 });
        recordNotice({ kind: 'finance', icon: '📉', title: '营收差异提醒', desc: data.message });
      }
    },
    onReviewAlert: (data: any) => {
      const isMgmt = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS';
      if (isMgmt) {
        setReviewBadge((p) => p + 1);
        const text = `工作抽查：${data.companionName} 存在异常（${data.reason || data.level || '异常'}），请到陪玩管理工作记录核查`;
        message.warning({ content: text, duration: 10 });
        // 「查看」直接落到这个人的工作记录，并把异常那一条高亮出来（老板 2026-10-05：
        // 以前只跳到陪玩列表 / 实名审核，什么都没标出来，根本找不到是哪一条）。
        const base = user?.role === 'CS' ? '/cs/employees' : '/admin/companions';
        const params = new URLSearchParams({ role: 'COMPANION' });
        if (data.companionId) params.set('workCompanion', data.companionId);
        if (data.sessionId) params.set('workSession', data.sessionId);
        if (data.companionName) params.set('workName', data.companionName);
        recordNotice({
          kind: 'audit',
          icon: '🛡️',
          title: `工作抽查异常 · ${data.companionName || ''}`,
          desc: text,
          href: data.companionId ? `${base}?${params.toString()}` : rolePage(user?.role, 'audits'),
        });
      }
    },
    onCsAccountAnomaly: (data: any) => {
      if (user?.role === 'CS' && data.message) {
        message.warning({ content: data.message, duration: 12 });
        showBannerNotification({
          title: '⚠️ 账目异常',
          body: data.message,
          icon: '⚠️',
          seconds: 15,
          hint: '点这里 → 去账目看',
          action: 'open-billing',
        });
        recordNotice({
          kind: 'finance',
          icon: '⚠️',
          title: '账目异常',
          desc: data.message,
          href: rolePage(user?.role, 'billing'),
        });
      }
    },
  });

  // 通知自检入口：排查「铃铛里没收到通知」时不用去造真实订单，
  // 在控制台执行 window.__chunlvNotice({ title: '测试', desc: '随便写' }) 就能验证铃铛。
  useEffect(() => {
    (window as any).__chunlvNotice = notifyNotice;
  });

  // Voice call handler — uses the same WebSocket from useSocket
  const vc = useVoiceCall(voiceSocketRef);
  // 语音自检入口：排查「打语音没声音」时不用让陪玩反复试，
  // 在控制台执行 window.__chunlvVoice.startCall('<对方userId>', '对方名字') 就能自己发起一通。
  useEffect(() => {
    (window as any).__chunlvVoice = vc;
  });
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
    const orCount = outcomeReviewBadge;
    const REVIEW_LABELS = ['工作室管理', '实名审核'];
    const CHAT_LABELS = ['陪玩管理', '员工管理', '首页'];
    const CONTACT_LABELS = ['派单工作台'];
    const PENDING_START_LABELS = ['订单管理'];
    const OUTCOME_REVIEW_LABELS = ['成交核对'];
    const REVIEW_WORK_LABELS = ['陪玩管理', '陪玩'];
    const badged = items.map((item) => {
      // Check children (group items) for badge targets
      if (item.children) {
        const hasPending = item.children.some((c: any) => REVIEW_LABELS.includes(c.label) && pCount > 0);
        const hasBridgePending = item.children.some((c: any) => c.label === '工作室桥接' && bpCount > 0);
        const hasBilling = item.children.some((c: any) => c.label === '报账系统' && bCount > 0);
        const hasUnread = item.children.some((c: any) => CHAT_LABELS.includes(c.label) && directUnread > 0);
        const hasReview = item.children.some((c: any) => REVIEW_WORK_LABELS.includes(c.label) && rvCount > 0);
        const hasContact = item.children.some((c: any) => CONTACT_LABELS.includes(c.label) && cCount > 0);
        const hasPendingStart = item.children.some((c: any) => PENDING_START_LABELS.includes(c.label) && psCount > 0);
        const hasOutcomeReview = item.children.some(
          (c: any) => OUTCOME_REVIEW_LABELS.includes(c.label) && orCount > 0,
        );
        if (
          hasPending ||
          hasBridgePending ||
          hasBilling ||
          hasUnread ||
          hasReview ||
          hasContact ||
          hasPendingStart ||
          hasOutcomeReview
        ) {
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
                        clearNoticesByKey(child.key);
                        navigate(child.key);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      {child.label}
                      <Badge count={pCount} size="small" overflowCount={99} style={{ boxShadow: badgeGlow(SEMANTIC.danger) }} />
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
                        clearNoticesByKey(child.key);
                        navigate(child.key);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      {child.label}
                      <Badge
                        count={bpCount}
                        size="small"
                        overflowCount={99}
                        style={{ boxShadow: badgeGlow(SEMANTIC.danger) }}
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
                        clearNoticesByKey(child.key);
                        navigate(child.key);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      {child.label}
                      <Badge count={bCount} size="small" overflowCount={99} style={{ boxShadow: badgeGlow(SEMANTIC.danger) }} />
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
                        clearNoticesByKey(child.key);
                        navigate(child.key);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      {child.label}
                      <Badge
                        count={rvCount}
                        size="small"
                        overflowCount={99}
                        style={{ boxShadow: badgeGlow(SEMANTIC.warning) }}
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
                        clearNoticesByKey(child.key);
                        navigate(child.key);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      {child.label}
                      <Badge
                        count={directUnread}
                        size="small"
                        overflowCount={99}
                        style={{ boxShadow: directUnread > 0 ? badgeGlow(SEMANTIC.danger) : undefined }}
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
                        clearNoticesByKey(child.key);
                        // 「客服跟进台账」已并进「管理端直添客户流转明细」（老板 2026-09-30），
                        // 待跟进角标点进去就是那一页
                        navigate(`${child.key}?tab=converted`);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      {child.label}
                      <Badge
                        count={cCount}
                        size="small"
                        overflowCount={99}
                        style={{ boxShadow: badgeGlow(SEMANTIC.warning) }}
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
                        // 陪玩的「订单管理」红点 = 有几张单已抢到/已确认但还没点「开始首单」，
                        // 原来点掉就没了、页面里什么都不说 —— 一并记进「刚清掉」，进页面顶头写清。
                        rememberCleared(
                          noticePath(child.key),
                          [`${psCount} 张单已抢到/已确认，还没点「开始首单」`],
                        );
                        markPendingStartSeen();
                        clearNoticesByKey(child.key);
                        navigate(child.key);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      {child.label}
                      <Badge
                        count={psCount}
                        size="small"
                        overflowCount={99}
                        style={{ boxShadow: badgeGlow(SEMANTIC.warning) }}
                      />
                    </span>
                  ),
                };
              }
              if (!child.children && OUTCOME_REVIEW_LABELS.includes(child.label) && orCount > 0) {
                return {
                  ...child,
                  label: (
                    <span
                      onClick={(e: any) => {
                        e.stopPropagation();
                        clearNoticesByKey(child.key);
                        navigate(child.key);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
                      title={`${orCount} 张报「不成功」的单还没拍板 —— 去定责：谁的问题找谁`}
                    >
                      {child.label}
                      <Badge
                        count={orCount}
                        size="small"
                        overflowCount={99}
                        style={{ boxShadow: badgeGlow(SEMANTIC.danger) }}
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
              <Badge count={pCount} size="small" overflowCount={99} style={{ boxShadow: badgeGlow(SEMANTIC.danger) }} />
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
              <Badge count={bpCount} size="small" overflowCount={99} style={{ boxShadow: badgeGlow(SEMANTIC.danger) }} />
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
              <Badge count={bCount} size="small" overflowCount={99} style={{ boxShadow: badgeGlow(SEMANTIC.danger) }} />
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
                style={{ boxShadow: directUnread > 0 ? badgeGlow(SEMANTIC.danger) : undefined }}
              />
            </span>
          ),
        };
      }
      return item;
    });
    // 先把「模块图标色 + 流水比例小字」挂好，再平铺单子菜单 ——
    // 平铺时父级的图标/文字会被搬到子项上，顺序反了颜色就丢了。
    const decorated = decorateMenu(badged, shareRatios);
    const flattened = decorated.map((item) => {
      // 单子菜单直接平铺：点击父级直接跳转，省掉再点一次二级菜单
      if (item.children && item.children.length === 1) {
        const child = item.children[0];
        return { key: child.key, icon: item.icon, label: item.label, ratioKey: (item as any).ratioKey };
      }
      return item;
    });
    // 最后一道：把「通知」未读角标挂到对应菜单项上。
    //   叶子（跟具体页面一一对应）：挂这个页面自己的未读数；
    //   父级（有子菜单）：挂**子树汇总** —— 店长把子菜单手动收起时，一级菜单上的角标照样看得到还有几条没读。
    const withNoticeBadges = (list: any[]): { items: any[]; count: number } => {
      let total = 0;
      const items = list.map((item) => {
        if (Array.isArray(item.children) && item.children.length > 0) {
          const sub = withNoticeBadges(item.children);
          total += sub.count;
          if (!sub.count) return { ...item, children: sub.items };
          // 父级（店长 / 老板收起子菜单时）：悬停写清是哪个子页面有几条。
          const parentHint = item.children
            .map((ch: any) => {
              const cp = noticePath(ch.key);
              const ts = cp ? titlesByPath[cp] || [] : [];
              // ch.label 可能已被 decorateMenu 换成节点（带流水比例那种），只对字符串拼提示。
              const name = typeof ch.label === 'string' ? ch.label : '';
              return ts.length ? `${name ? name + '：' : ''}${ts[0]}${ts.length > 1 ? ` 等 ${ts.length} 条` : ''}` : '';
            })
            .filter(Boolean)
            .join('\n');
          return {
            ...item,
            children: sub.items,
            label: menuBadgeLabel(item.label, sub.count, parentHint || undefined),
          };
        }
        const path = noticePath(item.key);
        const n = path ? unreadByPath[path] || 0 : 0;
        total += n;
        if (!n) return item;
        const ts = (path ? titlesByPath[path] : []) || [];
        const hint = ts.slice(0, 3).join('\n') + (ts.length > 3 ? `\n… 等 ${ts.length} 条` : '');
        return { ...item, label: menuBadgeLabel(item.label, n, hint || undefined) };
      });
      return { items, count: total };
    };
    // 上面「徽标那一段」是拿 label 字符串比对的，所以这层装饰必须放在它之后。
    const finalItems = withNoticeBadges(flattened).items;
    // 「待处理」那一项挂真实待办条数（不是未读），鼠标停上去写清是哪几类有几条。
    return finalItems.map((it: any) =>
      it.key === '/todos' && todosBadge > 0
        ? { ...it, label: menuBadgeLabel(it.label, todosBadge, todosHint || undefined) }
        : it,
    );
  }, [user, directUnread, pendingBadge, bridgePendingBadge, billingBadge, contactBadge, pendingStartBadge, shareRatios, unreadByPath, titlesByPath, clearNoticesByKey, rememberCleared, todosBadge, todosHint]);

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
    clearNoticesByKey(key);
    if (key.includes('/review')) markSeen();
    if (key.includes('bridges')) markBridgeSeen();
    if (key.includes('/billing')) markBillingSeen();
    if (key.includes('/orders')) {
      // 同上：从左侧栏点进来（红点没走自定义 label 那条路时）也要把「还剩几张单没开始」写进横幅。
      if (pendingStartBadge > 0) {
        rememberCleared(noticePath(key), [
          `${pendingStartBadge} 张单已抢到/已确认，还没点「开始首单」`,
        ]);
      }
      markPendingStartSeen();
    }
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
      {/* .app-shell = 整页淡紫/淡青晕染底色，.app-content = 白色内容卡（见 styles/global.css） */}
      <Layout className="app-shell" style={{ height: '100vh', overflow: 'hidden' }}>
        {/* ── 浅色侧边栏 ── */}
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={null}
          width={216}
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
              inlineIndent={16}
              selectedKeys={selectedKeys}
              defaultOpenKeys={menuItems.filter((m: any) => m.children).map((m: any) => m.key)}
              items={menuItems as MenuProps['items']}
              onClick={onMenuClick}
              style={{
                background: 'transparent',
                border: 'none',
                marginTop: 8,
                // 菜单比窗口高时可以往下滚（外层是 flex:1 + overflow:auto），底部留点空隙
                paddingBottom: 12,
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
            background: BG.container,
            borderRight: `1px solid ${BORDER.base}`,
            height: '100vh',
            position: 'sticky',
            top: 0,
            display: 'flex',
            flexDirection: 'column',
            zIndex: 2,
            overflow: 'hidden',
          }}
        >
          {!messagePanelCollapsed && (
            <LeftMessagePanel onOpenChat={openGroupChat} onOpenDirectChat={openDirectChat} />
          )}
        </Sider>

        <Layout style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
          {/* 顶栏 — 白色底 */}
          <Header
            className="app-header"
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
            {/* 当前门店 / 俱乐部：混店操作时一眼知道自己在哪家（老板自己没绑店，就不显示） */}
            {studioBrand?.name && <span className="app-brand-chip">{studioBrand.name}</span>}
            {/* 消息入口：有未读就把条数挂在图标上并闪红。以前未读只在左侧消息栏里，
                栏一收起就完全看不到有私信（老板 2026-10-05）。 */}
            <Badge
              count={totalUnread}
              overflowCount={99}
              offset={[-2, 6]}
              className={totalUnread > 0 ? 'badge-pop-active' : undefined}
            >
              <div
                style={{
                  borderRadius: 8,
                  ...(totalUnread > 0
                    ? { animation: 'bell-glow 2s ease-in-out infinite', boxShadow: '0 0 12px rgba(255, 77, 79, 0.5)' }
                    : {}),
                }}
              >
                <Button
                  type="text"
                  icon={React.createElement(MessageOutlined)}
                  onClick={() => setMessagePanelCollapsed((v) => !v)}
                  title={
                    totalUnread > 0
                      ? `消息未读 ${totalUnread} 条 · ${messagePanelCollapsed ? '点这里显示消息栏' : '点这里隐藏消息栏'}`
                      : messagePanelCollapsed ? '显示消息栏' : '隐藏消息栏'
                  }
                  style={{ color: totalUnread > 0 ? SEMANTIC.danger : (messagePanelCollapsed ? commander.textSecondary : BRAND.primary) }}
                />
              </div>
            </Badge>
            <Space size="middle">
              {/* Notification bell */}
              {user && (
                <Popover
                  open={notifOpen}
                  onOpenChange={setNotifOpen}
                  trigger="click"
                  placement="bottomRight"
                  title="通知"
                  content={
                    <NoticeList
                      onClose={() => setNotifOpen(false)}
                      onNavigate={(href, item) => {
                        // 「工作抽查异常」的老通知：href 里没带陪玩 id，点进去只到陪玩列表、
                        // 什么都没标出来。按标题里的名字补一次，直接落到那个人的工作记录
                        // （老板 2026-10-05）。
                        const title = String(item?.title || '');
                        const PREFIX = '工作抽查异常 · ';
                        if (
                          title.startsWith(PREFIX) &&
                          href &&
                          !href.includes('workCompanion') &&
                          !href.includes('workName')
                        ) {
                          const name = title.slice(PREFIX.length).trim();
                          if (name) {
                            const base = user?.role === 'CS' ? '/cs/employees' : '/admin/companions';
                            navigate(`${base}?role=COMPANION&workName=${encodeURIComponent(name)}`);
                            return;
                          }
                        }
                        navigate(href);
                      }}
                    />
                  }
                >
                  <Badge
                    count={unreadNotices}
                    overflowCount={99}
                    size="default"
                    offset={[-2, 8]}
                    className={unreadNotices > 0 ? 'badge-pop-active' : undefined}
                  >
                    <div
                      style={{
                        borderRadius: 8,
                        ...(unreadNotices > 0
                          ? {
                              animation: 'bell-glow 2s ease-in-out infinite',
                              boxShadow: '0 0 12px rgba(255, 77, 79, 0.5)',
                            }
                          : {}),
                      }}
                    >
                      <Button
                        type="text"
                        icon={React.createElement(BellOutlined)}
                        style={{
                          color: unreadNotices > 0 ? SEMANTIC.danger : commander.textSecondary,
                          fontSize: 20,
                        }}
                        className={unreadNotices > 0 ? 'bell-glow-active' : ''}
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
                            <div key={p.sessionId} style={{ padding: '8px 0', borderBottom: `1px solid ${BORDER.secondary}` }}>
                              <div>
                                <Text strong>🤝 {p.inviterName} 邀请你搭档</Text>
                              </div>
                              <div style={{ fontSize: 12, color: TEXT.secondary }}>
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
                      style={{ color: partnerInvites.length > 0 ? SEMANTIC.warning : commander.textSecondary }}
                    />
                  </Badge>
                </Popover>
              )}
              {user?.role === 'COMPANION' && (
                <Popover
                  open={transferReqOpen}
                  onOpenChange={setTransferReqOpen}
                  trigger="click"
                  placement="bottomRight"
                  title="待我确认的转让"
                  content={
                    <div style={{ width: 320 }}>
                      {transferReqs.length === 0 ? (
                        <Text type="secondary">暂无待确认的转让</Text>
                      ) : (
                        transferReqs.map((p) => (
                          <div key={p.requestId || p.id} style={{ padding: '8px 0', borderBottom: `1px solid ${BORDER.secondary}` }}>
                            <div>
                              <Text strong>🔁 {p.fromName} 想把订单转给你</Text>
                            </div>
                            <div style={{ fontSize: 12, color: TEXT.secondary }}>
                              {p.orderCode ? `${p.orderCode} · ` : ''}
                              {p.gameName || '订单'} · ¥{Number(p.amount || 0).toFixed(1)}
                              {p.reason ? ` · ${p.reason}` : ''}
                            </div>
                            <div style={{ margin: '6px 0' }}>
                              <InviteCountdown
                                seconds={Math.max(0, Math.ceil(((p.expiresAt || 0) - Date.now()) / 1000))}
                              />
                            </div>
                            <Space size={8}>
                              <Button
                                size="small"
                                type="primary"
                                onClick={async () => {
                                  await acceptTransferReq(p);
                                  setTransferReqOpen(false);
                                }}
                              >
                                同意
                              </Button>
                              <Button
                                size="small"
                                onClick={async () => {
                                  await rejectTransferReq(p);
                                }}
                              >
                                拒绝
                              </Button>
                            </Space>
                          </div>
                        ))
                      )}
                    </div>
                  }
                >
                  <Badge count={transferReqs.length} overflowCount={99} size="default" offset={[-2, 8]}>
                    <Button
                      type="text"
                      icon={<span style={{ fontSize: 18 }}>🔁</span>}
                      style={{ color: transferReqs.length > 0 ? SEMANTIC.warningDeep : commander.textSecondary }}
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
                            : BRAND.primary,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {!user.avatar && (
                          <span style={{ color: TEXT.inverse, fontSize: 14, fontWeight: 700 }}>
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
                    <Text style={{ color: SEMANTIC.warning, fontSize: 12, fontWeight: 600 }}>
                      本月预计提成 ¥{Number(myCommission).toFixed(1)}
                    </Text>
                  )}
                  {user?.role === 'CS' && (
                    <Button
                      size="small"
                      type="link"
                      onClick={() => setSalaryOpen(true)}
                      style={{ color: BRAND.primary, padding: 0, fontWeight: 600 }}
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
              background: BG.container,
              borderRadius: 12,
              minHeight: 280,
              overflow: 'auto',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)',
            }}
          >
            {/* 老板 2026-10-05：「有未读，点进去发现没任何变化」——进到这一页顶头就直接写清
                这条路由上挂着几条提醒、分别是什么。
                ① 还有没读的：蓝色横幅 + 「全部已读」（角标 / 铃铛同步）；
                ② 刚从左侧栏点进来、角标已经被点掉的：橙色横幅把「刚才清掉的是哪几条」再写一遍，
                   数字一没也知道刚才那条提醒是啥（点「知道了」才收）。 */}
            {(() => {
              // 必须带上 query：`陪玩工作微信` / `客服工作微信` 是**同一个路径**下按
              // `type` 区分的两个菜单，只看 pathname 的话这两页的横幅永远匹配不上（老板 2026-10-05）。
              const curPath = noticePath(location.pathname + (location.search || ''));
              if (!curPath) return null;
              const titles = titlesByPath[curPath] || [];
              const just = clearedNotices[curPath];
              const justTitles = just && Date.now() - just.at < CLEARED_TTL_MS ? just.titles : [];
              if (!titles.length && !justTitles.length) return null;
              const unread = titles.length > 0;
              const list = unread ? titles : justTitles;
              // 「订单管理」这一页的提醒八成是「待审核：补单申请」——给个按钮直接打开补单审核，
              // 别让老板在一长串订单里自己找（那个按钮在订单页右上角）。
              const ordersPath = rolePage(user?.role, 'orders');
              const canGoSupplement =
                user?.role !== 'COMPANION' &&
                !!ordersPath &&
                curPath === noticePath(ordersPath) &&
                list.some((t) => t.includes('补单'));
              // 「工作抽查异常」的横幅里直接把人的名字做成按钮 —— 点一下就到他的工作记录，
              // 不用再让人从一长串提醒里猜「具体是哪一条」（老板 2026-10-05）。
              const workNames = Array.from(
                new Set(
                  list
                    .filter((t) => t.startsWith('工作抽查异常 · '))
                    .map((t) => t.slice('工作抽查异常 · '.length).trim())
                    .filter(Boolean),
                ),
              );
              return (
                <Alert
                  type={unread ? 'info' : 'warning'}
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={
                    unread
                      ? `这里还有 ${titles.length} 条未读提醒`
                      : `刚才这里清掉了 ${justTitles.length} 条提醒（已标已读）`
                  }
                  description={`${list.slice(0, 5).join(' · ')}${
                    list.length > 5 ? ` … 等 ${list.length} 条` : ''
                  }`}
                  action={
                    <Space size={8}>
                      {workNames.slice(0, 3).map((n) => (
                        <Button
                          key={n}
                          size="small"
                          danger
                          onClick={() => {
                            notifItems
                              .filter((it) => !it.read && String(it.title).slice('工作抽查异常 · '.length).trim() === n && String(it.title).startsWith('工作抽查异常 · '))
                              .forEach((it) => markNoticeRead(it.id));
                            navigate(workAlertHref(n));
                          }}
                        >
                          🔎 {n} 的工作记录
                        </Button>
                      ))}
                      {canGoSupplement && (
                        <Button
                          size="small"
                          onClick={() => window.dispatchEvent(new CustomEvent('supplement:open'))}
                        >
                          🧾 去补单审核
                        </Button>
                      )}
                      {unread ? (
                        <Button
                          size="small"
                          onClick={() => {
                            rememberCleared(curPath, titles);
                            markNoticesReadByPath(curPath);
                          }}
                        >
                          全部已读
                        </Button>
                      ) : (
                        <Button size="small" onClick={() => forgetCleared(curPath)}>
                          知道了
                        </Button>
                      )}
                    </Space>
                  }
                />
              );
            })()}
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </Content>
        </Layout>
      </Layout>

      <SalaryDetailModal open={salaryOpen} onClose={() => setSalaryOpen(false)} salary={mySalary} />

      {/* Urgent order popup + solo grab success */}
      <UrgentOrderPopup
        urgentOrder={urgentOrder}
        urgentGrabbed={urgentGrabbed}
        setUrgentOrder={setUrgentOrder}
        setUrgentGrabbed={setUrgentGrabbed}
      />

      {/* Global Grab Success Modal — survives navigation */}
      <GrabSuccessModal order={grabbedOrder} onClose={() => setGrabbedOrder(null)} />

      {/* Global Chat Modal (opened from notification bell) */}
      <ChatModal
        open={!!globalChatPartner}
        partner={globalChatPartner as any}
        onClose={() => setGlobalChatPartner(null)}
      />

      <VoiceCallHandler />
      <ServiceStartOverlay />
    </ChatProvider>
  );
};

export default AppLayout;
