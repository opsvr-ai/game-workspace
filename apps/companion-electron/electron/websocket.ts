// craftsman-ignore: TS001
import { app } from 'electron';
// 注意：这里必须用 socket.io-client 的 Node 版入口，不能引 dist/socket.io.js。
// dist/socket.io.js 是浏览器构建，内部依赖 DOM 的 XMLHttpRequest；
// Electron 主进程是 Node 环境没有该 API，请求会直接抛
// "Cannot read properties of undefined (reading 'open')"，
// 表现在日志上就是每 5 秒一次的 "xhr poll error"，永远连不上服务端。
// Node 版入口会使用 xmlhttprequest-ssl / ws，由 esbuild 一起打进主进程产物。
import { io, Socket } from 'socket.io-client';
import { logger } from './logger';

let socket: Socket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// 连接失败的日志节流：以前服务端一挂，一天能刷 3700 多条 "WS connect error"，
// 光日志就把磁盘和时间浪费掉了。现在只记第 1 次、第 20 次，恢复时再汇总一次。
let connectErrorCount = 0;

const eventHandlers: Map<string, Array<(data: any) => void>> = new Map();

export function onWsEvent(event: string, handler: (data: any) => void): void {
  const handlers = eventHandlers.get(event) || [];
  handlers.push(handler);
  eventHandlers.set(event, handlers);
}

function emitEvent(event: string, data: any): void {
  const handlers = eventHandlers.get(event) || [];
  for (const h of handlers) { try { h(data); } catch { /* ignore */ } }
}

export function connectWebSocket(
  serverUrl: string,
  token: string,
  companionId: string,
  onAuthFailed?: () => void,
): void {
  disconnectWebSocket();
  const wsUrl = serverUrl.replace(/^http/, 'ws');

  socket = io(wsUrl, {
    auth: { token },
    // WebSocket 优先：轮询模式下客户端每 20~30 秒就要发一次完整 HTTP 请求，
    // 一天下来是上千次无谓的连接，CPU 和流量都白花。
    // tryAllTransports=true 是关键：万一这个网络不让用 WebSocket（中转、拦截），
    // 会自动退回 HTTP 轮询，不会像以前那样卡在 connect_timeout 一直连不上。
    transports: ['websocket', 'polling'],
    tryAllTransports: true,
    reconnection: true,
    reconnectionDelay: 5000,
    // 服务端整体挂掉时不要每 5 秒捶一次，退避到最多 60 秒一次，避免空转刷日志。
    reconnectionDelayMax: 60000,
    randomizationFactor: 0.5,
    timeout: 20000,
  });

  socket.on('connect', () => {
    if (connectErrorCount > 0) {
      logger.info('WS connected (after retries)', { failedAttempts: connectErrorCount });
      connectErrorCount = 0;
    } else {
      logger.info('WS connected');
    }
    // 先清旧的定时器：重连时 connect 会再次触发，不清就会出现多个心跳并发。
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    heartbeatTimer = setInterval(() => {
      socket?.emit('companion:heartbeat', {
        companionId,
        agentVersion: app.getVersion(),
      });
    }, 30_000);
  });

  socket.on('connect_error', (err: any) => {
    connectErrorCount += 1;
    // 令牌过期/被换密钥时，光重连是连不上的（服务端握手直接拒），
    // 这里通知主进程去换一张新令牌，换完再重连。
    const authMsg = String(err?.message || '');
    if (/invalid signature|jwt expired|Unauthorized|invalid token/i.test(authMsg)) {
      logger.warn('WS auth rejected, will refresh token', { message: authMsg });
      try { onAuthFailed?.(); } catch { /* ignore */ }
    }
    if (connectErrorCount === 1 || connectErrorCount % 20 === 0) {
      logger.warn('WS connect error', {
        message: err?.message || String(err),
        attempts: connectErrorCount,
      });
    }
  });

  socket.on('disconnect', (reason: any) => {
    logger.warn('WS disconnected', { reason: String(reason) });
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  });

  // Only listen for events we still care about
  socket.on('auth:failed' as any, () => {
    try { onAuthFailed?.(); } catch { /* ignore */ }
  });
  socket.on('order:new', (data) => emitEvent('order:new', data));
  socket.on('order:urgent', (data) => emitEvent('order:urgent', data));
  socket.on('order:pool_updated', (data) => emitEvent('order:pool_updated', data));
  socket.on('blacklist:update', (data) => emitEvent('blacklist:update', data));
  socket.on('pc:command', (data) => emitEvent('pc:command', data));
}

export function disconnectWebSocket(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (socket) { socket.disconnect(); socket = null; }
}

export function emitStatus(status: string): void {
  socket?.emit('companion:status', { status });
}

export function isConnected(): boolean {
  return socket?.connected ?? false;
}
