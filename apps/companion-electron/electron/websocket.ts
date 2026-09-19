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

export function connectWebSocket(serverUrl: string, token: string, companionId: string): void {
  disconnectWebSocket();
  const wsUrl = serverUrl.replace(/^http/, 'ws');

  socket = io(wsUrl, {
    auth: { token },
    // 轮询优先（HTTP 长轮询最稳），连接成功后再升级到 WebSocket；
    // 若直接 websocket 优先，网络对 WebSocket 升级不友好时会卡在 connect_timeout，导致一直掉线。
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionDelay: 10000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    logger.info('WS connected');
    heartbeatTimer = setInterval(() => {
      socket?.emit('companion:heartbeat', {
        companionId,
        agentVersion: app.getVersion(),
      });
    }, 30_000);
  });

  socket.on('connect_error', (err: any) => {
    logger.warn('WS connect error', { message: err?.message || String(err) });
  });

  socket.on('disconnect', (reason: any) => {
    logger.warn('WS disconnected', { reason: String(reason) });
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  });

  // Only listen for events we still care about
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
