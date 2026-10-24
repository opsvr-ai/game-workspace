// craftsman-ignore: TS001,TS002
import React, { useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Space, Tag, Badge } from 'antd';
import type { MenuProps } from 'antd';
import { useMenuBadges } from '../hooks/useMenuBadges';
import { useShellMenu } from '../hooks/useShellMenu';
import { useShellBranding } from '../hooks/useShellBranding';
// useChatNotification → now handled by ChatProvider
import ErrorBoundary from '../components/ErrorBoundary';
import LoadingState from '../components/LoadingState';
import { ChatProvider } from '../components/chat/ChatProvider';
import { commander } from '../styles/commander';
import { installShellMenuCss } from '../styles/shellMenuCss';
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
import { BG, BRAND, SEMANTIC, TEXT } from '../styles/tokens';
import { installWindowNavListener } from '../utils/windowNav';
import { notifyNotice } from '../utils/notice';
import { roleLabels, IconLogout, IconFold, IconUnfold } from '../config/roleMenus';
// Chat 3.0: playMessageSound + chatApi now handled by ChatProvider

import { MessageOutlined } from '@ant-design/icons';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useOrderStore } from '../stores/orderStore';

// 三段外壳全局样式（原 AppLayout 顶部内联注入，逐字搬出）
installShellMenuCss();

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = React.useState(false);
  const [isCompact, setIsCompact] = React.useState(() => typeof window !== 'undefined' && window.innerWidth <= 1080);
  const [pendingWebVersion, setPendingWebVersion] = React.useState('');
  const [messagePanelCollapsed, setMessagePanelCollapsed] = React.useState(true);
  const { user, isAuthenticated, fetchUser, logout } = useAuthStore();
  // 门店品牌 / 客户端版本 / 前端构建 / 提成底薪 / 分账比例：状态与拉取都在 hooks/useShellBranding。
  const { studioBrand, myCommission, mySalary, salaryOpen, setSalaryOpen, shareRatios } = useShellBranding(user);
  const isCsClient = typeof window !== 'undefined'
    && !!(window as any).electronAPI
    && !(window as any).electronAPI?.getSavedCredentials
    && !(window as any).electronAPI?.onStatusChanged;
  // 有没提交的内容时，拦下整页刷新（老板 2026-10-08）：
  // 陪玩端主进程每次发现「网页版号变了」就 webContents.reload()、休眠唤醒也会 reload 一次 ——
  // 正在打字也照刷，输入全没了。网页拦不住主进程主动发起的 reload，但 Electron 默认会**因为
  // 页面的 beforeunload 取消这次 reload**（实测 Electron 30：有过用户交互的页面会被拦下）。
  // 想彻底不刷，等客户端那一版（刷前先问页面 / 唤醒不再硬刷）发出去，见 CHANGELOG。
  useEffect(() => installUnloadGuard(), []);

  // 浏览器/网页端自动跟进前端版本：登录后每分钟问一次，版号变了自动刷新。
  // 以前只有陪玩端主进程会 reload，管理员在浏览器里开着旧 tab 会一直看到旧页面。
  // 有没提交的内容（busyGuard）时先不刷，等提交/清空后再刷。
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const check = async () => {
      try {
        const res = await fetch('/api/agent/frontend-version', { cache: 'no-store' });
        const json = (await res.json()) as any;
        const version = json?.data?.version;
        if (!version) return;
        const key = 'chunlv.webFrontendVersion';
        const prev = localStorage.getItem(key);
        if (!prev) {
          localStorage.setItem(key, version);
          return;
        }
        if (prev !== version && !isAnyBusy()) {
          // 可见时不再强行 reload（老板 2026-10-25：动不动加载一下很晃眼）；
          // 只挂一个小按钮，等人自己点。页面在后台时直接换版，看不见闪烁。
          if (document.visibilityState === 'hidden') {
            localStorage.setItem(key, version);
            window.location.reload();
            return;
          }
          setPendingWebVersion(version);
        }
      } catch {
        /* 断网 / 登录页异常不打扰 */
      }
    };
    void check();
    timer = setInterval(check, 60_000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, []);

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
  // ── 菜单角标（9 组）+ 通知 → 菜单角标：全部在 hooks/useMenuBadges ──
  // 菜单树怎么挂角标在 hooks/useShellMenu；这里只留 AppLayout 自己还要用的几项。
  const badges = useMenuBadges(user);
  const {
    setReviewBadge,
    notifItems,
    titlesByPath,
    clearedNotices,
    rememberCleared,
    forgetCleared,
    markNoticesReadByPath,
    markNoticeRead,
    workAlertHref,
  } = badges;

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

  // 左侧导航菜单（roleMenus + 角标 decoration + 点一级进第一个页面）在 hooks/useShellMenu。
  const { menuItems, onMenuClick } = useShellMenu({ user, navigate, directUnread, shareRatios, badges });

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

      {pendingWebVersion && (
        <Button
          type="primary"
          size="small"
          style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 3000, boxShadow: '0 4px 14px rgba(22,119,255,.35)' }}
          onClick={() => {
            localStorage.setItem('chunlv.webFrontendVersion', pendingWebVersion);
            window.location.reload();
          }}
        >
          新版本已就绪，点此刷新
        </Button>
      )}

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
