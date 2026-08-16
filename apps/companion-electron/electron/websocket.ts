// craftsman-ignore: TS001
import { app } from 'electron';
import { io, Socket } from 'socket.io-client/dist/socket.io.js';
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
    transports: ['websocket', 'polling'],
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
