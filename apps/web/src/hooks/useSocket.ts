// craftsman-ignore: TS001
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import http from '../api/client';

interface UseSocketOptions {
  namespace?: string;
  onOrderPoolUpdated?: (data: any) => void;
  onOrderGrabbed?: (data: any) => void;
  onOrderNew?: (data: any) => void;
  onOrderUrgent?: (data: any) => void;
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
}

export function useSocket(opts: UseSocketOptions = {}) {
  const socketRef = useRef<Socket | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const token = sessionStorage.getItem('accessToken');
    if (!token) return;
    let disposed = false;

    // Connect to API server — dev: direct to :3001, prod: same origin
    const baseWsUrl = import.meta.env.DEV
      ? `http://${window.location.hostname}:3001`
      : `${window.location.protocol}//${window.location.host}`;
    const wsUrl = opts.namespace ? `${baseWsUrl}${opts.namespace}` : baseWsUrl;
    const socket = io(wsUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      autoConnect: false,
      // 断线自动重连（含服务器重启）：以前默认就没关，但这里显式写出来，
      // 并保证每次重连前都会先换新令牌，避免拿过期令牌一直连不上。
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 30000,
    });
    socketRef.current = socket;
    let reloginInFlight = false;

    // 用已连通的网页 Socket 上报陪玩端心跳和客户端版本，
    // 避免依赖 Electron 主进程那条独立的 WebSocket 连接。
    const emitHeartbeat = () => {
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
    };
    // 令牌过期 / 被换过密钥时，用 refreshToken 换一张新令牌再连，
    // 不然客户端会拿着废令牌一直重连失败，那段时间收不到任何弹窗。
    const relogin = async () => {
      if (disposed) return;
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) return;
      if (reloginInFlight) return;
      reloginInFlight = true;
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
        } catch {}
        (socket as any).auth = { token: next };
        if (!socket.connected) socket.connect();
      } catch {
        /* 换不到就等下一次重连 */
      } finally {
        reloginInFlight = false;
      }
    };
    // 服务端接受「过期但我们自己签发的」令牌时会推这个事件，让我们后台把令牌换成新的
    socket.on('auth:stale_token' as any, () => {
      void relogin();
    });
    socket.on('connect_error', (err: any) => {
      const msg = String(err?.message || '');
      if (/invalid signature|jwt expired|Unauthorized|invalid token/i.test(msg)) {
        void relogin();
      }
    });
    socket.on('auth:failed' as any, () => {
      void relogin();
    });

    socket.on('connect', () => {
      emitHeartbeat();
      const timer = setInterval(emitHeartbeat, 30_000);
      (socket as any).__hbTimer = timer;
    });
    socket.on('disconnect', (reason: any) => {
      // 被服务端断开（令牌不认/连接被踢）时 socket.io 不会自动重连，
      // 这里手动换令牌再连，避免「人在线但收不到弹窗」。
      if (String(reason) === 'io server disconnect') void relogin();
    });
    socket.on('disconnect', () => {
      if ((socket as any).__hbTimer) {
        clearInterval((socket as any).__hbTimer);
        (socket as any).__hbTimer = null;
      }
    });

    socket.on('order:pool_updated', (data: any) => {
      optsRef.current.onOrderPoolUpdated?.(data);
    });

    socket.on('pc:command', (data: any) => {
      if (data?.command === 'test_watchdog') {
        (window as any).electronAPI?.testWatchdog?.();
      } else if (data?.command === 'collect_processes') {
        (async () => {
          // 先走 axios 触发一次鉴权，若 access token 已过期会自动续期，
          // 避免把过期的 token 交给主进程导致上报 401。
          try { await http.get('/auth/me'); } catch {}
          const token = sessionStorage.getItem('accessToken');
          if (token) {
            (window as any).electronAPI?.collectProcesses?.(token);
          }
        })();
      }
    });

    socket.on('order:grabbed', (data: any) => {
      optsRef.current.onOrderGrabbed?.(data);
    });

    socket.on('order:scheduled_reminder', (data: any) => {
      optsRef.current.onScheduledReminder?.(data);
    });

    socket.on('status:broadcast', (data: any) => {
      optsRef.current.onStatusBroadcast?.(data);
    });

    socket.on('chat:notify', (data: any) => {
      optsRef.current.onChatNotify?.(data);
    });

    socket.on('chat:broadcast', (data: any) => {
      optsRef.current.onChatBroadcast?.(data);
    });

    socket.on('chat:new', (data: any) => {
      optsRef.current.onChatNew?.(data);
    });

    socket.on('chat:message', (data: any) => {
      optsRef.current.onChatMessage?.(data);
      // Also handle as Chat 3.0 message:new for backward compatibility
      optsRef.current.onMessageNew?.(data);
    });

    // Chat 3.0 events
    socket.on('message:new', (data: any) => {
      optsRef.current.onMessageNew?.(data);
    });

    socket.on('message:updated', (data: any) => {
      optsRef.current.onMessageUpdated?.(data);
    });

    socket.on('chat:read', (data: any) => {
      optsRef.current.onChatRead?.(data);
    });

    socket.on('message:acked', (data: any) => {
      optsRef.current.onMessageAcked?.(data);
    });

    socket.on('typing:notify', (data: any) => {
      optsRef.current.onTypingNotify?.(data);
    });

    socket.on('room:updated', (data: any) => {
      optsRef.current.onRoomUpdated?.(data);
    });

    socket.on('sync:required', (data: any) => {
      optsRef.current.onSyncRequired?.(data);
    });

    socket.on('order:new', (data: any) => {
      optsRef.current.onOrderNew?.(data);
    });

    socket.on('order:urgent', (data: any) => {
      optsRef.current.onOrderUrgent?.(data);
    });

    socket.on('order:partner_accepted', (data: any) => {
      optsRef.current.onPartnerAccepted?.(data);
    });

    socket.on('order:partner_rejected', (data: any) => {
      optsRef.current.onPartnerRejected?.(data);
    });

    socket.on('order:partner_timeout', (data: any) => {
      optsRef.current.onPartnerTimeout?.(data);
    });

    socket.on('order:dual_invite', (data: any) => {
      optsRef.current.onDualInvite?.(data);
    });

    socket.on('order:dual_invite_expired', (data: any) => {
      optsRef.current.onDualInviteExpired?.(data);
    });

    socket.on('order:service_handoff', (data: any) => {
      optsRef.current.onServiceHandoff?.(data);
    });

    socket.on('order:segment_finished', (data: any) => {
      optsRef.current.onSegmentFinished?.(data);
    });

    socket.on('service:duration_reminder', (data: any) => {
      optsRef.current.onServiceDurationReminder?.(data);
    });

    socket.on('wallet:reviewed', (data: any) => {
      optsRef.current.onWalletReviewed?.(data);
    });

    socket.on('user:authorized', (data: any) => {
      optsRef.current.onUserAuthorized?.(data);
    });

    socket.on('user:rejected', (data: any) => {
      optsRef.current.onUserRejected?.(data);
    });

    socket.on('bridge:responded', (data: any) => {
      optsRef.current.onBridgeResponded?.(data);
    });

    socket.on('billing:revenue_diff', (data: any) => {
      optsRef.current.onRevenueDiff?.(data);
    });

    socket.on('review:alert', (data: any) => {
      optsRef.current.onReviewAlert?.(data);
    });

    socket.on('cs:account_anomaly', (data: any) => {
      optsRef.current.onCsAccountAnomaly?.(data);
    });

    // 页面级 useSocket 可能在 accessToken 已过期后才挂载（例如陪玩先登录，
    // 过一会儿再切到订单池）。AppLayout 的旧连接仍能收到 order:urgent 弹窗，
    // 但新页面连接若直接拿过期 token 握手，会被服务端连接后立刻断开，
    // 导致 order:pool_updated 收不到。这里先经 /auth/me 让 axios 拦截器续期，
    // 再开始 Socket.IO 连接，避免“弹窗先到、订单池必须手动刷新”。
    const keepAliveTimer = setInterval(() => {
      // 静默续期：accessToken 只有 15 分钟，提前换掉，
      // 这样断线重连/主进程重连都不会再拿过期令牌去握手。
      void http.get('/auth/me').catch(() => {});
    }, 10 * 60 * 1000);
    (socket as any).__keepAliveTimer = keepAliveTimer;

    void (async () => {
      try {
        await http.get('/auth/me');
      } catch {
        // 续期失败时仍尝试用旧 token 连接；最坏情况保持现有行为。
      }
      if (disposed) return;
      const nextToken = sessionStorage.getItem('accessToken') || token;
      (socket as any).auth = { token: nextToken };
      socket.connect();
    })();

    return () => {
      disposed = true;
      clearInterval(keepAliveTimer);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return socketRef;
}
