// craftsman-ignore: TS001
import { useEffect, useRef } from 'react';
import { Manager, Socket } from 'socket.io-client';
import http, { markSessionReplaced, clearStoredSession, redirectToLogin } from '../api/client';

interface UseSocketOptions {
  namespace?: string;
  onOrderPoolUpdated?: (data: any) => void;
  onOrderGrabbed?: (data: any) => void;
  onOrderNew?: (data: any) => void;
  onOrderUrgent?: (data: any) => void;
  /** 有人把订单转让给我（老板 2026-09-29：是谁抢的就是谁的，换手只能靠转让） */
  onOrderTransferred?: (data: any) => void;
  /** 有人想把订单转让给我，要我同意（老板 2026-10-03：转让要经被转让方同意） */
  onTransferRequested?: (data: any) => void;
  /** 我发起的转让，对方同意了（这时单才真正到他名下） */
  onTransferAccepted?: (data: any) => void;
  /** 我发起的转让，对方拒绝 / 撤回 / 超时作废 */
  onTransferRejected?: (data: any) => void;
  onTransferCancelled?: (data: any) => void;
  onTransferExpired?: (data: any) => void;
  /** 接单工作室被催结果（老板 2026-09-30：待反馈的单，发单客服可以「催一下」） */
  onFeedbackChase?: (data: any) => void;
  onScheduledReminder?: (data: any) => void;
  onStatusBroadcast?: (data: any) => void;
  /** 群聊广播：客服/店长在群聊里发的广播，陪玩端要弹 Windows 提醒 */
  onChatBroadcast?: (data: any) => void;
  // Legacy chat events (deprecated, remove after migration)
  onChatNotify?: (data: any) => void;
  onChatNew?: (data: any) => void;
  onChatMessage?: (data: any) => void;
  // Chat 3.0 events
  onMessageNew?: (data: any) => void;
  onMessageUpdated?: (data: any) => void;
  /** 「对方已读」推送（Chat 3.0）：用来在消息下面标「已阅读」 */
  onChatRead?: (data: any) => void;
  onMessageAcked?: (data: any) => void;
  onTypingNotify?: (data: any) => void;
  onRoomUpdated?: (data: any) => void;
  onSyncRequired?: (data: any) => void;
  onPartnerAccepted?: (data: any) => void;
  onPartnerRejected?: (data: any) => void;
  onPartnerTimeout?: (data: any) => void;
  onDualInvite?: (data: any) => void;
  onDualInviteExpired?: (data: any) => void;
  onServiceHandoff?: (data: any) => void;
  onSegmentFinished?: (data: any) => void;
  onServiceDurationReminder?: (data: any) => void;
  onWalletReviewed?: (data: any) => void;
  onUserAuthorized?: (data: any) => void;
  onUserRejected?: (data: any) => void;
  onBridgeResponded?: (data: any) => void;
  onRevenueDiff?: (data: any) => void;
  onReviewAlert?: (data: any) => void;
  onCsAccountAnomaly?: (data: any) => void;
  /** 陪玩提交了工作微信，等管理端审核（老板 2026-10-02） */
  onWorkWechatRequest?: (data: any) => void;
  /** 自己的工作微信申请被审核（通过 / 驳回），陪玩端刷新卡片 */
  onWorkWechatUpdated?: (data: any) => void;
  /** 陪玩点了「添加失败」提交补单申请，管理端实时收到（老板 2026-10-04） */
  onSupplementRequest?: (data: any) => void;
  /** 补单申请被审核（同意 / 驳回），陪玩本人实时收到（老板 2026-10-04） */
  onSupplementDecided?: (data: any) => void;
  /** 抢单后迟迟没标「添加成功 / 添加失败」，服务端定期提醒陪玩本人（老板 2026-10-04） */
  onOrderContactReminder?: (data: any) => void;
  /** 同上满 3 天仍没处理 → 提醒客服 / 店长 / 老板去核实，确认过不了就删客户 */
  onOrderContactReminderAdmin?: (data: any) => void;
  /** 抢了单一直没点「开始首单」、也没报结果 → 提醒陪玩本人（老板 2026-10-06） */
  onOrderUnstartedReminder?: (data: any) => void;
  /** 同上满 7 天仍没处理 → 提醒客服 / 店长 / 老板去核（成交核对 → 抢了没结果） */
  onOrderUnstartedReminderAdmin?: (data: any) => void;
  /** 接单方报了结果（成功 / 不成功）→ 发单客服实时收到（老板 2026-10-06：失败单先找他核对） */
  onOrderOutcomeReport?: (data: any) => void;
  /** 发单客服确认「跟接单方核对无异议」→ 推给店长 / 老板来拍板（老板 2026-10-06） */
  onOrderOutcomeCsConfirmed?: (data: any) => void;
  /** 店长把接单方报的「不成功」打回重写（老板 2026-10-06） */
  onOrderOutcomeRejected?: (data: any) => void;
  /**
   * 通用「审核 / 交互」提醒（老板 2026-10-04）——报账 / 支取 / 战绩图 / 客户删除申请 /
   * 封存解封 / 桥接申请 / 注册审核，提交方和审核方都要能实时收到提示。
   * payload.audience: 'MGMT' 只发给管理端，'COMPANION' 只发给陪玩本人。
   */
  onReviewNotice?: (data: any) => void;
}

/**
 * 事件回调可以带任意 payload：**服务端事件名与 payload 语义是冻结的**，这里不做校验，
 * 只负责把数据原样转交给调用方。
 */
type SocketHandler = (...args: any[]) => void;

/**
 * 一条「共享连接」——同一账号 + 同一 namespace 全局只有一个 Socket 实例。
 *
 * 为什么要共享（2026-10-17 性能整治）：
 *   以前 `useSocket` 每被调用一次就 `io()` 新建一条连接。AppLayout / ChatProvider /
 *   DevicesPanel / CSDispatchView 同时挂着时，同一账号会开 3~4 条连接，每条各自
 *   每 30 秒发一次 `companion:heartbeat`、各自跑一遍令牌续期，白占浏览器连接数和服务端资源。
 *
 * 现在：
 *   - 连接、心跳、断线重连、令牌刷新（relogin）、顶号处理、电子端指令：**每条连接只做一次**；
 *   - 每个 `useSocket` 调用方只是往这条连接上挂 / 摘自己的事件回调（引用计数）；
 *   - 最后一个消费者卸载后**不立刻断线**，留一个宽限窗口（见 IDLE_DISPOSE_MS），
 *     这样 React StrictMode 双挂载、路由切换不会把连接拆了重建（还会打断语音通话）。
 */
interface SharedConnection {
  /** `${baseUrl}|${namespace}` */
  key: string;
  baseUrl: string;
  namespace: string;
  socket: Socket;
  /** 最近一次已知的 accessToken（relogin 换过令牌后同步到这里） */
  token: string;
  /** 引用计数：还有几个 useSocket 消费者挂着这条连接 */
  consumers: number;
  disposed: boolean;
  /** 最后一个消费者卸载后的延迟回收定时器 */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** 连接级监听（心跳 / 重登 / 顶号 / 电子端指令），只注册一次 */
  coreHandlers: Array<[string, SocketHandler]>;
  /** 30 秒心跳定时器（只有默认命名空间那条连接负责发，服务端也只在那里收） */
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}

/** 活跃的共享连接，key = baseUrl|namespace。 */
const connections = new Map<string, SharedConnection>();
/** 底层 Manager（管 WebSocket 传输与重连）。不同 namespace 共用同一个 Manager → 同一条物理连接。 */
const managers = new Map<string, Manager>();

/**
 * 最后一个消费者卸载后，隔多久才真正断开。
 * 15 秒足够覆盖 StrictMode 双挂载 / 路由切换 / 页面级 useSocket 卸载后马上又挂回来，
 * 又不至于在「人已经离开这一页」时长期白占服务端连接。
 */
const IDLE_DISPOSE_MS = 15_000;

/** 默认命名空间：服务端的业务网关 `/`（心跳、pc:command 等只在这里收发）。 */
function isMainNamespace(namespace: string): boolean {
  return namespace === '/';
}

function getBaseUrl(): string {
  // Connect to API server — dev: direct to :3001, prod: same origin
  return import.meta.env.DEV
    ? `http://${window.location.hostname}:3001`
    : `${window.location.protocol}//${window.location.host}`;
}

function normalizeNamespace(namespace?: string): string {
  if (!namespace) return '/';
  return namespace.startsWith('/') ? namespace : `/${namespace}`;
}

function connectionKey(baseUrl: string, namespace: string): string {
  return `${baseUrl}|${namespace}`;
}

/** 每个 baseUrl 只建一个 Manager：namespace 挂在它下面，共用同一条底层 WebSocket。 */
function getManager(baseUrl: string): Manager {
  let manager = managers.get(baseUrl);
  if (manager) return manager;
  manager = new Manager(baseUrl, {
    transports: ['websocket', 'polling'],
    // 连接时机由我们控制（先经 /auth/me 静默续期，再握手），别让 Manager 自己乱连
    autoConnect: false,
    // 断线自动重连（含服务器重启）：保证每次重连前都会先换新令牌，避免拿过期令牌一直连不上。
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionDelayMax: 30000,
  });
  managers.set(baseUrl, manager);
  return manager;
}

// ── 全局静默续期（所有连接共用一条定时器，不再每个连接各跑一条）────────────
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

function ensureKeepAlive(): void {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    // 静默续期：accessToken 只有 15 分钟，提前换掉，
    // 这样断线重连 / 主进程重连都不会再拿过期令牌去握手。
    void http.get('/auth/me').catch(() => {});
  }, 10 * 60 * 1000);
}

function stopKeepAliveIfIdle(): void {
  if (connections.size > 0) return;
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

// 用已连通的网页 Socket 上报陪玩端心跳和客户端版本，
// 避免依赖 Electron 主进程那条独立的 WebSocket 连接。
function emitHeartbeat(socket: Socket): void {
  const api = (window as any).electronAPI;
  const fallback = '0.0.0';
  if (api?.getAppVersion) {
    api
      .getAppVersion()
      .then((v: string) => socket.emit('companion:heartbeat', { agentVersion: v || fallback }))
      .catch(() => socket.emit('companion:heartbeat', { agentVersion: fallback }));
  } else {
    socket.emit('companion:heartbeat', { agentVersion: fallback });
  }
}

// 挂载前先经 /auth/me 让 axios 拦截器续期，避免拿过期令牌握手。
// 同一时刻只发一次（多个 namespace / 多个页面同时挂载时不重复打接口）。
let sessionTokenPromise: Promise<string | null> | null = null;

function ensureSessionToken(): Promise<string | null> {
  if (sessionTokenPromise) return sessionTokenPromise;
  const p = (async () => {
    try {
      await http.get('/auth/me');
    } catch {
      // 续期失败时仍尝试用旧 token 连接；最坏情况保持现有行为。
    }
    return sessionStorage.getItem('accessToken');
  })();
  sessionTokenPromise = p;
  void p.finally(() => {
    if (sessionTokenPromise === p) sessionTokenPromise = null;
  });
  return p;
}

// ── 令牌刷新（relogin）：全局单飞，一条连接换到新令牌后同步给所有连接 ────────
let reloginPromise: Promise<void> | null = null;

/**
 * 令牌过期 / 被换过密钥时，用 refreshToken 换一张新令牌再连，
 * 不然客户端会拿着废令牌一直重连失败，那段时间收不到任何弹窗。
 *
 * 注意：refreshToken 是**会轮换**的，N 条连接各换一次会互相把对方顶掉，
 * 所以这里全局只允许一次在飞，换到的令牌一次性同步给所有共享连接。
 */
function reloginShared(): Promise<void> {
  if (reloginPromise) return reloginPromise;
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return Promise.resolve();
  reloginPromise = (async () => {
    try {
      const { data } = await http.post('/auth/refresh', { refreshToken });
      const next = (data as any)?.data?.accessToken;
      if (!next) return;
      const nextRefresh = (data as any)?.data?.refreshToken;
      sessionStorage.setItem('accessToken', next);
      if (nextRefresh) localStorage.setItem('refreshToken', nextRefresh);
      // 同步给陪玩端主进程（主进程那条 WebSocket 就是靠这里存的令牌连的）
      try {
        (window as any).electronAPI?.storeSet?.('token', next);
        if (nextRefresh) (window as any).electronAPI?.storeSet?.('refreshToken', nextRefresh);
      } catch {
        /* 网页版没有 electronAPI，忽略 */
      }
      for (const conn of connections.values()) {
        if (conn.disposed) continue;
        conn.token = next;
        conn.socket.auth = { token: next };
        if (!conn.socket.connected) conn.socket.connect();
      }
    } catch {
      /* 换不到就等下一次重连 */
    } finally {
      reloginPromise = null;
    }
  })();
  return reloginPromise;
}

// ── 顶号处理：全局只处理一次（以前每条连接都会跑一遍）─────────────────────
let replacedHandled = false;

/**
 * 被别的电脑顶号（客服 / 管理）：服务端主动告诉我们「你已被顶下去」。
 * 不要再拿 refreshToken 去换新令牌（那样会把对面反过来顶掉），直接回登录页。
 */
function handleAuthReplaced(): void {
  if (replacedHandled) return;
  replacedHandled = true;
  markSessionReplaced();
  clearStoredSession();
  redirectToLogin();
}

function offCoreHandlers(conn: SharedConnection): void {
  for (const [event, handler] of conn.coreHandlers) {
    try {
      conn.socket.off(event as any, handler as any);
    } catch {
      /* 已经断开的 socket 上摘监听失败不影响后续 */
    }
  }
  conn.coreHandlers = [];
}

function clearHeartbeat(conn: SharedConnection): void {
  if (conn.heartbeatTimer) {
    clearInterval(conn.heartbeatTimer);
    conn.heartbeatTimer = null;
  }
}

/** 建一条新的共享连接，并把「只该做一次」的那部分挂上。 */
function createConnection(namespace: string, token: string): SharedConnection {
  const baseUrl = getBaseUrl();
  const manager = getManager(baseUrl);
  const socket = manager.socket(namespace, { auth: { token } });
  // 复用 Manager 里同 namespace 的旧 Socket 时，manager.socket() 会忽略新的 opts，
  // 所以令牌在这里显式同步一次（relogin 之后重新挂载的调用方也能拿到新令牌）。
  socket.auth = { token };

  const conn: SharedConnection = {
    key: connectionKey(baseUrl, namespace),
    baseUrl,
    namespace,
    socket,
    token,
    consumers: 1,
    disposed: false,
    idleTimer: null,
    coreHandlers: [],
    heartbeatTimer: null,
  };

  const on = (event: string, handler: SocketHandler) => {
    socket.on(event as any, handler as any);
    conn.coreHandlers.push([event, handler]);
  };

  // 服务端接受「过期但我们自己签发的」令牌时会推这个事件，让我们后台把令牌换成新的
  on('auth:stale_token', () => {
    void reloginShared();
  });
  on('connect_error', (err: any) => {
    const msg = String(err?.message || '');
    if (/invalid signature|jwt expired|Unauthorized|invalid token/i.test(msg)) {
      void reloginShared();
    }
  });
  on('auth:failed', () => {
    void reloginShared();
  });
  on('auth:replaced', () => {
    // 同一台机器「退出 → 重新登录」时，登录接口会先 kickUser 再返回新令牌：
    // 旧连接可能先收到这条通知。等一拍再看令牌 —— 已经换成新令牌 / 已清空，
    // 说明被顶掉的是上一个会话，不要把刚登进来的新会话一起清掉。
    const tokenAtEvent = sessionStorage.getItem('accessToken');
    if (tokenAtEvent && tokenAtEvent !== conn.token) return;
    setTimeout(() => {
      if (sessionStorage.getItem('accessToken') !== conn.token) return;
      handleAuthReplaced();
    }, 800);
  });

  on('connect', () => {
    // 心跳只在「连接建立」时挂一次（每条连接一个定时器），默认命名空间才发：
    // 服务端的 companion:heartbeat 处理器只挂在 `/` 网关上。
    if (!isMainNamespace(namespace)) return;
    emitHeartbeat(socket);
    clearHeartbeat(conn);
    conn.heartbeatTimer = setInterval(() => {
      if (socket.connected) emitHeartbeat(socket);
    }, 30_000);
  });
  on('disconnect', (reason: any) => {
    if (isMainNamespace(namespace)) clearHeartbeat(conn);
    // 被服务端断开（令牌不认 / 连接被踢）时 socket.io 不会自动重连，
    // 这里手动换令牌再连，避免「人在线但收不到弹窗」。
    if (String(reason) === 'io server disconnect') void reloginShared();
  });

  // 电子端指令：服务端只往默认命名空间发，这里也只挂一次。
  if (isMainNamespace(namespace)) {
    on('pc:command', (data: any) => {
      if (data?.command === 'test_watchdog') {
        (window as any).electronAPI?.testWatchdog?.();
      } else if (data?.command === 'collect_processes') {
        (async () => {
          // 先走 axios 触发一次鉴权，若 access token 已过期会自动续期，
          // 避免把过期的 token 交给主进程导致上报 401。
          try {
            await http.get('/auth/me');
          } catch {
            /* 续期失败也照样把当前令牌交给主进程 */
          }
          const next = sessionStorage.getItem('accessToken');
          if (next) {
            (window as any).electronAPI?.collectProcesses?.(next);
          }
        })();
      }
    });
  }

  // 页面级 useSocket 可能在 accessToken 已过期后才挂载（例如陪玩先登录，
  // 过一会儿再切到订单池）。这个连接若直接拿过期 token 握手，会被服务端连接后
  // 立刻断开，导致 order:pool_updated 收不到。这里先续期再连。
  void (async () => {
    const nextToken = (await ensureSessionToken()) || token;
    if (conn.disposed) return;
    conn.token = nextToken;
    socket.auth = { token: nextToken };
    socket.connect();
  })();

  return conn;
}

/**
 * 拿一条共享连接（已有的就 +1 引用计数，没有就新建）。
 * 同一账号 + 同一 namespace 永远只会有一条。
 */
function acquireConnection(namespace: string, token: string): SharedConnection {
  const key = connectionKey(getBaseUrl(), namespace);
  const existing = connections.get(key);
  if (existing && !existing.disposed) {
    existing.consumers += 1;
    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = null;
    }
    if (existing.token !== token) {
      // 同一 SPA 里换过账号 / 换过令牌（「退出登录 → 马上登另一个号」就是这条路：
      // AppLayout 是 navigate('/login') 软跳转，不会整页 reload，连接还在 15s 宽限期内）。
      // 只改 socket.auth 不会重新握手 —— 服务端仍按**上一个账号**的身份推送，
      // 新账号收不到自己的事件、还会看到别人的。所以这里强制断开重连一次，按新令牌重新鉴权。
      existing.token = token;
      existing.socket.auth = { token };
      try {
        existing.socket.disconnect();
      } catch {
        /* 已经断了就直接连 */
      }
      existing.socket.connect();
      return existing;
    }
    return existing;
  }
  const conn = createConnection(namespace, token);
  connections.set(key, conn);
  ensureKeepAlive();
  return conn;
}

function disposeConnection(conn: SharedConnection): void {
  if (conn.disposed) return;
  conn.disposed = true;
  clearHeartbeat(conn);
  offCoreHandlers(conn);
  try {
    conn.socket.disconnect();
  } catch {
    /* 已经断了就算了 */
  }
  connections.delete(conn.key);
  stopKeepAliveIfIdle();
  // 这个 Manager 下已经没有任何共享连接了 → 一起回收（下次重新建，避免复用到旧 nsps 里的死 socket）
  const stillUsed = Array.from(connections.values()).some((c) => c.baseUrl === conn.baseUrl);
  if (!stillUsed) {
    managers.delete(conn.baseUrl);
  }
}

/**
 * 消费者卸载：引用计数 -1。
 * 减到 0 时**不立刻断线**，先留 IDLE_DISPOSE_MS 的宽限窗口：
 * React StrictMode 双挂载 / 页面切换会瞬间卸载再挂载，立刻 disconnect 会白白重建连接。
 */
function releaseConnection(namespace: string): void {
  const key = connectionKey(getBaseUrl(), namespace);
  const conn = connections.get(key);
  if (!conn || conn.disposed) return;
  conn.consumers = Math.max(0, conn.consumers - 1);
  if (conn.consumers > 0) return;
  // 退出登录（令牌已被清掉）时必须立刻断，不能留宽限：
  // 同账号 15 秒内重新登录时，服务端单点登录会把这条「上一个会话」的连接踢掉，
  // 顶号通知可能把刚登进来的新会话一起清掉。只有「没退出、只是换页面」才享受宽限。
  if (!sessionStorage.getItem('accessToken')) {
    if (conn.idleTimer) {
      clearTimeout(conn.idleTimer);
      conn.idleTimer = null;
    }
    disposeConnection(conn);
    return;
  }
  if (conn.idleTimer) return;
  conn.idleTimer = setTimeout(() => {
    conn.idleTimer = null;
    if (conn.consumers > 0 || conn.disposed) return;
    disposeConnection(conn);
  }, IDLE_DISPOSE_MS);
}

export function useSocket(opts: UseSocketOptions = {}) {
  const socketRef = useRef<Socket | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const token = sessionStorage.getItem('accessToken');
    if (!token) return;
    const namespace = normalizeNamespace(opts.namespace);
    const conn = acquireConnection(namespace, token);
    const socket = conn.socket;
    socketRef.current = socket;

    // 每个消费者只挂/摘「自己的」回调，并且都从 optsRef 里取最新回调
    // （调用方每次渲染传新对象也没关系，事件触发时永远用最新的闭包）。
    const handlers: Array<[string, SocketHandler]> = [
      ['order:pool_updated', (data: any) => optsRef.current.onOrderPoolUpdated?.(data)],
      ['order:grabbed', (data: any) => optsRef.current.onOrderGrabbed?.(data)],
      ['order:scheduled_reminder', (data: any) => optsRef.current.onScheduledReminder?.(data)],
      ['status:broadcast', (data: any) => optsRef.current.onStatusBroadcast?.(data)],
      ['chat:notify', (data: any) => optsRef.current.onChatNotify?.(data)],
      ['chat:broadcast', (data: any) => optsRef.current.onChatBroadcast?.(data)],
      ['chat:new', (data: any) => optsRef.current.onChatNew?.(data)],
      [
        'chat:message',
        (data: any) => {
          optsRef.current.onChatMessage?.(data);
          // Also handle as Chat 3.0 message:new for backward compatibility
          optsRef.current.onMessageNew?.(data);
        },
      ],
      // Chat 3.0 events
      ['message:new', (data: any) => optsRef.current.onMessageNew?.(data)],
      ['message:updated', (data: any) => optsRef.current.onMessageUpdated?.(data)],
      ['chat:read', (data: any) => optsRef.current.onChatRead?.(data)],
      ['message:acked', (data: any) => optsRef.current.onMessageAcked?.(data)],
      ['typing:notify', (data: any) => optsRef.current.onTypingNotify?.(data)],
      ['room:updated', (data: any) => optsRef.current.onRoomUpdated?.(data)],
      ['sync:required', (data: any) => optsRef.current.onSyncRequired?.(data)],
      ['order:new', (data: any) => optsRef.current.onOrderNew?.(data)],
      ['order:urgent', (data: any) => optsRef.current.onOrderUrgent?.(data)],
      ['order:transferred', (data: any) => optsRef.current.onOrderTransferred?.(data)],
      ['order:transfer_requested', (data: any) => optsRef.current.onTransferRequested?.(data)],
      ['order:transfer_accepted', (data: any) => optsRef.current.onTransferAccepted?.(data)],
      ['order:transfer_rejected', (data: any) => optsRef.current.onTransferRejected?.(data)],
      ['order:transfer_cancelled', (data: any) => optsRef.current.onTransferCancelled?.(data)],
      ['order:transfer_expired', (data: any) => optsRef.current.onTransferExpired?.(data)],
      ['order:feedback_chase', (data: any) => optsRef.current.onFeedbackChase?.(data)],
      ['order:partner_accepted', (data: any) => optsRef.current.onPartnerAccepted?.(data)],
      ['order:partner_rejected', (data: any) => optsRef.current.onPartnerRejected?.(data)],
      ['order:partner_timeout', (data: any) => optsRef.current.onPartnerTimeout?.(data)],
      ['order:dual_invite', (data: any) => optsRef.current.onDualInvite?.(data)],
      ['order:dual_invite_expired', (data: any) => optsRef.current.onDualInviteExpired?.(data)],
      ['order:service_handoff', (data: any) => optsRef.current.onServiceHandoff?.(data)],
      ['order:segment_finished', (data: any) => optsRef.current.onSegmentFinished?.(data)],
      ['service:duration_reminder', (data: any) => optsRef.current.onServiceDurationReminder?.(data)],
      ['order:contact_reminder', (data: any) => optsRef.current.onOrderContactReminder?.(data)],
      ['order:contact_reminder_admin', (data: any) => optsRef.current.onOrderContactReminderAdmin?.(data)],
      ['order:unstarted_reminder', (data: any) => optsRef.current.onOrderUnstartedReminder?.(data)],
      ['order:unstarted_reminder_admin', (data: any) => optsRef.current.onOrderUnstartedReminderAdmin?.(data)],
      ['order:outcome_failed', (data: any) => optsRef.current.onOrderOutcomeReport?.(data)],
      ['order:outcome_success', (data: any) => optsRef.current.onOrderOutcomeReport?.(data)],
      ['order:outcome_cs_confirmed', (data: any) => optsRef.current.onOrderOutcomeCsConfirmed?.(data)],
      ['order:outcome_rejected', (data: any) => optsRef.current.onOrderOutcomeRejected?.(data)],
      ['review:notice', (data: any) => optsRef.current.onReviewNotice?.(data)],
      ['wallet:reviewed', (data: any) => optsRef.current.onWalletReviewed?.(data)],
      ['user:authorized', (data: any) => optsRef.current.onUserAuthorized?.(data)],
      ['user:rejected', (data: any) => optsRef.current.onUserRejected?.(data)],
      ['bridge:responded', (data: any) => optsRef.current.onBridgeResponded?.(data)],
      ['billing:revenue_diff', (data: any) => optsRef.current.onRevenueDiff?.(data)],
      ['review:alert', (data: any) => optsRef.current.onReviewAlert?.(data)],
      ['cs:account_anomaly', (data: any) => optsRef.current.onCsAccountAnomaly?.(data)],
      ['work-wechat:request', (data: any) => optsRef.current.onWorkWechatRequest?.(data)],
      ['work-wechat:updated', (data: any) => optsRef.current.onWorkWechatUpdated?.(data)],
      ['order:supplement_request', (data: any) => optsRef.current.onSupplementRequest?.(data)],
      ['order:supplement', (data: any) => optsRef.current.onSupplementDecided?.(data)],
    ];
    for (const [event, handler] of handlers) socket.on(event as any, handler as any);

    return () => {
      // 注册与注销必须成对：否则一次事件会触发多次刷新（StrictMode 双挂载最容易踩）。
      for (const [event, handler] of handlers) {
        try {
          socket.off(event as any, handler as any);
        } catch {
          /* socket 已经销毁，摘不到也无所谓 */
        }
      }
      if (socketRef.current === socket) socketRef.current = null;
      releaseConnection(namespace);
    };
    // 和改造前一致：namespace 只在挂载时读一次（现有 4 个调用方都是常量 namespace）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return socketRef;
}
