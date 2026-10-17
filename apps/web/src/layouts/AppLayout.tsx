// craftsman-ignore: TS001,TS002
import React, { useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Space, Tag, Badge } from 'antd';
import type { MenuProps } from 'antd';
import { useMenuBadges } from '../hooks/useMenuBadges';
import http from '../api/client';
import { configApi } from '../api/config';
// useChatNotification → now handled by ChatProvider
import ErrorBoundary from '../components/ErrorBoundary';
import LoadingState from '../components/LoadingState';
import { ChatProvider } from '../components/chat/ChatProvider';
import { commander } from '../styles/commander';
import { decideBuildRefresh } from '../utils/buildRefresh';
import { installUnloadGuard, isAnyBusy } from '../utils/busyGuard';
// FloatingChatWidget removed — redundant with bell notification
import NotificationPanel from '../components/shell/NotificationPanel';
import NoticePathBanner from '../components/shell/NoticePathBanner';
import VoiceCallHost from '../components/shell/VoiceCallHost';
import { MessageDock, ChatModalHost } from '../components/shell/ChatDock';
import { PartnerInvitePopover, TransferRequestPopover, ShellBanners } from '../components/shell/ShellBanners';
import { useShellChat } from '../hooks/useShellChat';
import { useShellBanners } from '../hooks/useShellBanners';
import { useShellRealtime } from '../hooks/useShellRealtime';
import { useVoiceCall } from '../hooks/useVoiceCall';
import SalaryDetailModal from '../components/SalaryDetailModal';
import GrabSuccessModal from '../components/GrabSuccessModal';
import { noticePath } from '../stores/notifStore';
import { BG, BRAND, SEMANTIC, TEXT, badgeGlow } from '../styles/tokens';
import { installWindowNavListener } from '../utils/windowNav';
import { notifyNotice } from '../utils/notice';
import { roleMenus, roleLabels, menuBadgeLabel, decorateMenu, makeTitlesClickable, rolePage, IconLogout, IconFold, IconUnfold } from '../config/roleMenus';
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

import { MessageOutlined } from '@ant-design/icons';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useOrderStore } from '../stores/orderStore';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

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
  // 左侧栏「工资 / 提成」后面那点比例：陪玩 / 店长 / 客服各拿业绩的百分之几。
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
          // 陪玩那一栏按业绩有多个档，左侧栏显示**最高那一档**，一眼看到最好能拿到多少。
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
  // 有没提交的内容时，拦下整页刷新（老板 2026-10-08）：
  // 陪玩端主进程每次发现「网页版号变了」就 webContents.reload()、休眠唤醒也会 reload 一次 ——
  // 正在打字也照刷，输入全没了。网页拦不住主进程主动发起的 reload，但 Electron 默认会**因为
  // 页面的 beforeunload 取消这次 reload**（实测 Electron 30：有过用户交互的页面会被拦下）。
  // 想彻底不刷，等客户端那一版（刷前先问页面 / 唤醒不再硬刷）发出去，见 CHANGELOG。
  useEffect(() => installUnloadGuard(), []);

  useEffect(() => {
    const pageStartedAt = Date.now();
    const send = () => {
      http
        .post('/agent/heartbeat', { agentVersion: appVersion || undefined })
        .then((res: any) => {
          const id = res?.data?.data?.webBuildId;
          if (!id) return;
          setWebBuild(id);
          // 有新版本前端页面要不要现在刷：判定收在 utils/buildRefresh.ts（老板 2026-10-08）。
          // 规则：服务中不刷、刚打开页面先等 2 分钟、5 分钟内只刷一次，**有人在写东西（有没提交的
          // 内容）也不刷** —— 以前漏了最后这条，打字打一半被整页刷掉、输入全没了。
          const decision = decideBuildRefresh({
            prev: localStorage.getItem('webBuildId'),
            next: id,
            pageAgeMs: Date.now() - pageStartedAt,
            lastReloadAt: Number(localStorage.getItem('webBuildReloadAt') || 0),
            inService: !!res?.data?.data?.inService,
            busy: isAnyBusy(),
          });
          if (!decision.remember) return;
          localStorage.setItem('webBuildId', id);
          if (!decision.reload) return;
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
  // ── 菜单角标（9 组）+ 通知 → 菜单角标 ──
  // state / 拉取 / 轮询 / 可见性判断 / 实时事件触发刷新，全部在 hooks/useMenuBadges（原样搬出，行为不变）。
  const {
    pendingBadge,
    todosBadge,
    todosHint,
    bridgePendingBadge,
    billingBadge,
    workWechatBadge,
    reviewBadge,
    setReviewBadge,
    contactBadge,
    pendingStartBadge,
    outcomeReviewBadge,
    markSeen,
    markBridgeSeen,
    markBillingSeen,
    markReviewSeen,
    markContactSeen,
    markPendingStartSeen,
    notifItems,
    unreadByPath,
    titlesByPath,
    clearedNotices,
    clearNoticesByKey,
    rememberCleared,
    forgetCleared,
    markNoticesReadByPath,
    markNoticeRead,
    workAlertHref,
  } = useMenuBadges(user);

  const { grabbedOrder, setGrabbedOrder } = useOrderStore();

  // Notification bell
  const [notifOpen, setNotifOpen] = React.useState(false);
  // 聊天浮窗系统（全局聊天弹窗 / 私聊·群聊打开 / 独立聊天窗口编排）在 hooks/useShellChat。
  const closeNotif = React.useCallback(() => setNotifOpen(false), []);
  const {
    globalChatPartner,
    setGlobalChatPartner,
    openDirectChat,
    openGroupChat,
  } = useShellChat({ closeNotif });
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
  // 2026-10-07 修两处：
  //   ① 以前是**单向**的 —— 窄到 768 以下把侧栏收起来，之后再拉宽也不会展开；挂载那一瞬间
  //      如果 innerWidth 还没量出来，也会被当成「窄屏」，侧栏就永远卡在半折叠。
  //      现在只认「跨过断点」这一件事：变窄收、变宽放。
  //   ② 加一道「不合理宽度直接忽略」的护栏（见下）：否则窗口最小化 / 截图动作里浏览器
  //      瞬时报的个位数宽度会让侧栏收起再弹回，看着就像界面坏了。
  const narrowRef = React.useRef(false);
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      // 小得不像真实窗口的宽度一律当「没量到」（截图时 Chrome 会瞬时报 1x1，真机最小化时也会报个位数）
      if (w < 320) return;
      const compact = w <= 1080;
      setIsCompact(compact);
      if (compact) setMessagePanelCollapsed(true);
      const narrow = w <= 768;
      if (narrow !== narrowRef.current) {
        narrowRef.current = narrow;
        setCollapsed(narrow);
      }
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const navigate = useNavigate();
  const location = useLocation();

  // ── 横幅 / 搭档邀请 / 转让申请（UrgentOrderPopup、顶栏两个 Popover、主进程横幅动作）──
  // state / 拉取 / 轮询 / 主进程事件，全部在 hooks/useShellBanners（原样搬出，行为不变）。
  const {
    urgentOrder,
    urgentGrabbed,
    setUrgentOrder,
    setUrgentGrabbed,
    partnerInviteOpen,
    setPartnerInviteOpen,
    partnerInvites,
    removePartnerInvite,
    addPartnerInvite,
    transferReqOpen,
    setTransferReqOpen,
    transferReqs,
    acceptTransferReq,
    rejectTransferReq,
    addTransferReq,
    removeTransferReq,
  } = useShellBanners({ user, navigate, openDirectChat, openGroupChat });

  // 「独立聊天窗口」里点「查看订单」→ 让**主程序这个窗口**跳到订单管理并把那一单标出来
  // （老板 2026-10-08：「直接跳到订单管理不行？为啥还得搞窗口？」）。跨窗口用的是
  // localStorage + storage 事件（同源窗口一定收得到，而且是事件、不受后台节流），
  // 见 utils/windowNav.ts —— 独立系统窗口没有 opener，只能靠这条。
  React.useEffect(() => installWindowNavListener((url) => navigate(url)), [navigate]);
  // 右下角通知弹窗被点了一下（utils/notice.ts 派发的自定义事件）→ 跳到通知指向的页面。
  React.useEffect(() => {
    const onNoticeGoto = (e: Event) => {
      const href = (e as CustomEvent)?.detail?.href;
      if (href) navigate(String(href));
    };
    window.addEventListener('chunlv:notice-goto', onNoticeGoto as EventListener);
    return () => window.removeEventListener('chunlv:notice-goto', onNoticeGoto as EventListener);
  }, [navigate]);

  useEffect(() => {
    if (!user && isAuthenticated) {
      fetchUser();
    }
  }, []);

  // WebSocket 实时推送（订单 / 转让 / 搭档 / 审核 / 通知音 / 横幅）全部在 hooks/useShellRealtime（原样搬出）。
  const voiceSocketRef = useShellRealtime({
    user,
    addPartnerInvite,
    removePartnerInvite,
    addTransferReq,
    removeTransferReq,
    setUrgentOrder,
    setReviewBadge,
  });
  // 语音通话：必须和 useSocket 在同一个组件里、按「先连 socket 再注册来电监听」的原顺序调用。
  const vc = useVoiceCall(voiceSocketRef);

  // 通知自检入口：排查「铃铛里没收到通知」时不用去造真实订单，
  // 在控制台执行 window.__chunlvNotice({ title: '测试', desc: '随便写' }) 就能验证铃铛。
  useEffect(() => {
    (window as any).__chunlvNotice = notifyNotice;
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
    // 老板 2026-10-10：左侧菜单改成按「人」分（陪玩管理 / 客服管理），原来挂在「员工管理」
    // 上的未读聊天角标跟着挪过去，两个子菜单各挂一份（同一个未读总数）。
    const CHAT_LABELS = ['陪玩管理', '客服管理', '首页'];
    const CONTACT_LABELS = ['派单工作台'];
    const PENDING_START_LABELS = ['订单管理'];
    const OUTCOME_REVIEW_LABELS = ['成交核对'];
    // 工作抽查异常挂在「陪玩列表 / 人员管理」上（以前挂在折叠的「陪玩管理」上，点不动）。
    const REVIEW_WORK_LABELS = ['陪玩列表', '人员管理'];
    // 「陪玩工作微信」这条路由（带 type，避免和客服工作微信串台）：
    // 服务端待审数也挂到这条菜单上，漏掉 socket 消息也不会漏提示。
    const workWechatPath = noticePath(rolePage(user.role, 'work-wechats'));
    // ── 菜单角标 ──
    // 表驱动：命中 label 的菜单项就在后面挂一个红点 / 黄点（一级、二级、分组标题都能挂）。
    // 老板 2026-10-08 起左侧菜单最多两级，第三级变成不折叠的分组标题，所以这里按 label 递归找。
    const BADGE_RULES: Array<{
      labels: string[];
      count: number;
      color: string;
      /** 点掉角标时顺手标记「看过了」 */
      markSeen?: () => void;
      /** 点击时改跳哪儿（默认跳这个菜单项自己的页面） */
      to?: (key: string) => string;
      /** 点进去之前先记一笔「刚清掉了什么」（陪玩「订单管理」用） */
      onOpen?: (key: string) => void;
      title?: string;
    }> = [
      { labels: REVIEW_LABELS, count: pCount, color: SEMANTIC.danger, markSeen },
      { labels: ['工作室桥接'], count: bpCount, color: SEMANTIC.danger, markSeen: markBridgeSeen },
      { labels: ['报账系统'], count: bCount, color: SEMANTIC.danger, markSeen: markBillingSeen },
      // 工作抽查异常（/admin/review-queue-count，见上面 reviewBadge）挂在「陪玩列表」上：
      // 点进去就是陪玩列表，能看到那个人的工作记录。以前挂在折叠的「陪玩管理」上，点不动。
      { labels: REVIEW_WORK_LABELS, count: rvCount, color: SEMANTIC.warning, markSeen: markReviewSeen },
      { labels: CHAT_LABELS, count: directUnread, color: SEMANTIC.danger },
      {
        labels: CONTACT_LABELS, count: cCount, color: SEMANTIC.warning, markSeen: markContactSeen,
        // 「客服跟进台账」已并进「管理端直添客户流转明细」（老板 2026-09-30）
        to: (key) => key + '?tab=converted',
      },
      {
        labels: PENDING_START_LABELS, count: psCount, color: SEMANTIC.warning, markSeen: markPendingStartSeen,
        onOpen: (key) =>
          rememberCleared(noticePath(key), [`${psCount} 张单已抢到/已确认，还没点「开始首单」`]),
      },
      {
        labels: OUTCOME_REVIEW_LABELS, count: orCount, color: SEMANTIC.danger,
        title: `${orCount} 张报「不成功」的单还没拍板 —— 去定责：谁的问题找谁`,
      },
    ];

    /** 这个菜单项点了要跳哪：自己就是页面就用自己；是分组 / 折叠项就跳进去第一个能点的页面。 */
    const jumpKeyOf = (node: any): string | null => {
      if (typeof node?.key === 'string' && node.key.startsWith('/')) return node.key;
      for (const kid of node?.children || []) {
        const found = jumpKeyOf(kid);
        if (found) return found;
      }
      return null;
    };

    const applyBadges = (list: any[]): any[] =>
      list.map((node: any) => {
        const next: any = Array.isArray(node.children) && node.children.length
          ? { ...node, children: applyBadges(node.children) }
          : { ...node };
        const rule = BADGE_RULES.find((r) => r.count > 0 && r.labels.includes(next.label));
        if (!rule) return next;
        const label = (
          <span
            onClick={(e: any) => {
              e.stopPropagation();
              rule.onOpen?.(next.key);
              rule.markSeen?.();
              const jump = jumpKeyOf(next);
              if (jump) {
                clearNoticesByKey(next.key);
                navigate(rule.to ? rule.to(jump) : jump);
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
            title={rule.title}
          >
            {next.label}
            <Badge
              count={rule.count}
              size="small"
              overflowCount={99}
              style={{ boxShadow: badgeGlow(rule.color) }}
            />
          </span>
        );
        return { ...next, label };
      });

    const badged = applyBadges(items);
    // 先把「模块图标色 + 业绩比例小字」挂好，再平铺单子菜单 ——
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
              // ch.label 可能已被 decorateMenu 换成节点（带业绩比例那种），只对字符串拼提示。
              const name = typeof ch.label === 'string' ? ch.label : '';
              const parts: string[] = [];
              if (ts.length) parts.push(`${ts[0]}${ts.length > 1 ? ` 等 ${ts.length} 条` : ''}`);
              if (cp && cp === workWechatPath && workWechatBadge > 0) {
                parts.push(`${workWechatBadge} 条陪玩提交的工作微信待审核`);
              }
              return parts.length ? `${name ? name + '：' : ''}${parts.join('；')}` : '';
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
        // 同一条菜单只挂一个角标：通知未读和服务端待审数取大的那个。
        const pending = path && path === workWechatPath ? workWechatBadge : 0;
        const count = Math.max(n, pending);
        total += count;
        if (!count) return item;
        const ts = (path ? titlesByPath[path] : []) || [];
        let hint = ts.slice(0, 3).join('\n') + (ts.length > 3 ? `\n… 等 ${ts.length} 条` : '');
        if (pending > n) {
          hint += (hint ? '\n' : '') + `${pending} 条陪玩提交的工作微信待审核`;
        }
        return { ...item, label: menuBadgeLabel(item.label, count, hint || undefined) };
      });
      return { items, count: total };
    };
    // 上面「徽标那一段」是拿 label 字符串比对的，所以这层装饰必须放在它之后。
    const finalItems = withNoticeBadges(flattened).items;
    // 「待处理」那一项挂真实待办条数（不是未读），鼠标停上去写清是哪几类有几条。
    const withTodosBadge = finalItems.map((it: any) =>
      it.key === '/todos' && todosBadge > 0
        ? { ...it, label: menuBadgeLabel(it.label, todosBadge, todosHint || undefined) }
        : it,
    );
    // 最后一步：把标题包成可点 —— 点一下直接进它里面第一个页面。
    //   ① 一级菜单（陪玩管理 / 客服管理…）：老板 2026-10-16「点一下，再动鼠标点右侧的二级标题，
    //      很不顺手」—— 以前点一级的文字只是展开 / 收起，得再点一次二级才进得去。
    //   ② 分组标题（type: 'group'，如「陪玩工资 70%」）：老板 2026-10-10「点不开？」，
    //      它本来只做视觉分段，但长得跟能点的菜单项一模一样。
    // 「最多两级」这条规矩不变（老板 2026-10-08），展开 / 收起改由那一行右边的箭头管。
    // 必须放在徽标 / 业绩比例之后：那些是按 label 字符串比对的，先换成节点就比不中了。
    return makeTitlesClickable(withTodosBadge, (key) => navigate(key));
  }, [user, directUnread, pendingBadge, bridgePendingBadge, billingBadge, contactBadge, pendingStartBadge, reviewBadge, outcomeReviewBadge, shareRatios, unreadByPath, titlesByPath, workWechatBadge, clearNoticesByKey, rememberCleared, navigate, markSeen, markBridgeSeen, markBillingSeen, markReviewSeen, markContactSeen, markPendingStartSeen, todosBadge, todosHint]);

  const selectedKeys = useMemo(() => {
    // 高亮当前页。菜单 key 有的一级直接就是页面（单子菜单会被平铺），有的藏在二级 / 分组里，
    // 所以先把整棵树里「能点的页面 key」全收集起来，再取最长前缀命中的那一个。
    // （以前只看一级菜单的 key，于是除了「待处理」，点进任何页面左侧都不高亮 —— 2026-10-08 修。）
    const pageKeys: string[] = [];
    const collect = (list: any[]) => {
      for (const node of list) {
        if (Array.isArray(node.children) && node.children.length) collect(node.children);
        else if (typeof node.key === 'string') pageKeys.push(node.key.split('?')[0]);
      }
    };
    collect(menuItems);
    const path = location.pathname;
    const matched = pageKeys
      .filter((key) => key.startsWith('/') && (path === key || path.startsWith(key + '/')))
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
        <LoadingState size="large" minHeight={240} />
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

        {/* 左侧常驻群聊消息面板 — 群聊消息不再进铃铛（渲染在 components/shell/ChatDock） */}
        <MessageDock collapsed={messagePanelCollapsed} openGroupChat={openGroupChat} openDirectChat={openDirectChat} />
        <Layout style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
          {/* 顶栏 — 白色底 */}
          <Header
            className="app-header"
            style={{
              padding: '0 16px',
              display: 'flex',
              alignItems: 'center',
              // 左侧（折叠 / 门店名 / 消息）自然并排，右侧那一组靠 marginLeft:auto 顶到最右。
              // 以前用 space-between，中间那个「消息」按钮会被甩到整条栏的正中间悬着。
              gap: 12,
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
            <Space size="middle" style={{ marginLeft: 'auto' }}>
              {/* Notification bell */}
              {user && <NotificationPanel open={notifOpen} onOpenChange={setNotifOpen} />}
              {user?.role === 'COMPANION' && (
                <PartnerInvitePopover
                  open={partnerInviteOpen}
                  onOpenChange={setPartnerInviteOpen}
                  partnerInvites={partnerInvites}
                  removePartnerInvite={removePartnerInvite}
                />
              )}
              {user?.role === 'COMPANION' && (
                <TransferRequestPopover
                  open={transferReqOpen}
                  onOpenChange={setTransferReqOpen}
                  transferReqs={transferReqs}
                  acceptTransferReq={acceptTransferReq}
                  rejectTransferReq={rejectTransferReq}
                />
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
            {/* 老板 2026-10-05：进到这一页顶头直接写清这条路由上挂着几条提醒、刚清掉的是哪几条。
                渲染在 components/shell/NoticePathBanner，数据来自 useMenuBadges。 */}
            <NoticePathBanner
              role={user?.role}
              titlesByPath={titlesByPath}
              clearedNotices={clearedNotices}
              notifItems={notifItems}
              onRememberCleared={rememberCleared}
              onForgetCleared={forgetCleared}
              onMarkNoticesReadByPath={markNoticesReadByPath}
              onMarkNoticeRead={markNoticeRead}
              workAlertHref={workAlertHref}
            />
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </Content>
        </Layout>
      </Layout>

      <SalaryDetailModal open={salaryOpen} onClose={() => setSalaryOpen(false)} salary={mySalary} />

      {/* Urgent order popup（渲染在 components/shell/ShellBanners） */}
      <ShellBanners
        urgentOrder={urgentOrder}
        urgentGrabbed={urgentGrabbed}
        setUrgentOrder={setUrgentOrder}
        setUrgentGrabbed={setUrgentGrabbed}
      />
      {/* Global Grab Success Modal — survives navigation */}
      <GrabSuccessModal order={grabbedOrder} onClose={() => setGrabbedOrder(null)} />

      {/* Global Chat Modal (opened from notification bell) — 渲染在 components/shell/ChatDock */}
      <ChatModalHost partner={globalChatPartner} onClose={() => setGlobalChatPartner(null)} />
      <VoiceCallHost vc={vc} />
    </ChatProvider>
  );
};

export default AppLayout;
