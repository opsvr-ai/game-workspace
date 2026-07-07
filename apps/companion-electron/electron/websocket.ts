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
  for (const h of handlers) {
    try { h(data); } catch { /* ignore */ }
  }
}

// Wrapper: log all outgoing Socket.IO events
function wsEmit(event: string, data: any): void {
  logger.info(`WS SEND ${event}`, data);
  socket?.emit(event, data);
}

// Wrapper: log all incoming Socket.IO events
function wsOn(event: string, handler: (data: any) => void): void {
  socket?.on(event, (data: any) => {
    logger.info(`WS RECV ${event}`, data);
    handler(data);
  });
}

export function connectWebSocket(serverUrl: string, token: string, companionId: string): void {
  disconnectWebSocket();

  const wsUrl = serverUrl.replace(/^http/, 'ws');

  socket = io(wsUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 5000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    logger.info('WS CONNECTED', { serverUrl: wsUrl });

    heartbeatTimer = setInterval(() => {
      wsEmit('companion:heartbeat', {
        agentVersion: '3.0.0',
        currentMode: 'WORK',
        companionId,
      });
    }, 30_000);
  });

  socket.on('connect_error', (err: any) => {
    logger.error('WS CONNECT_ERROR', { message: err?.message || String(err) });
  });

  socket.on('disconnect', (reason: any) => {
    logger.warn('WS DISCONNECTED', { reason: reason?.toString() || String(reason) });
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  });

  wsOn('order:new', (data: any) => {
    emitEvent('order:new', data);
  });

  wsOn('order:urgent', (data: any) => {
    emitEvent('order:urgent', data);
  });

  wsOn('order:pool_updated', (data: any) => {
    emitEvent('order:pool_updated', data);
  });

  wsOn('status:broadcast', (data: any) => {
    emitEvent('status:broadcast', data);
  });

  wsOn('pc:command', (data: any) => {
    emitEvent('pc:command', data);
  });

  wsOn('blacklist:update', (data: any) => {
    emitEvent('blacklist:update', data);
  });

  wsOn('blacklist:recheck', (data: any) => {
    emitEvent('blacklist:recheck', data);
  });

  wsOn('entertainment:warning', (data: any) => {
    emitEvent('entertainment:warning', data);
  });

  wsOn('entertainment:forceIdle', (data: any) => {
    emitEvent('entertainment:forceIdle', data);
  });
}

export function disconnectWebSocket(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function emitStatus(status: string, mode?: string): void {
  wsEmit('companion:status', { status, mode });
}

export function emitBlacklistReport(processes: any[], totalCount: number): void {
  wsEmit('blacklist:report', { processes, totalCount });
}

export function emitKillResult(result: { processName: string; pid: number; success: boolean; resultText: string }): void {
  wsEmit('blacklist:kill_result', {
    processName: result.processName,
    pid: result.pid,
    success: result.success,
    resultText: result.resultText,
    triggeredBy: 'PERIODIC',
  });
}

export function emitCommandAck(command: string, success: boolean): void {
  socket?.emit('pc:command_ack', { command, success });
}

export function isConnected(): boolean {
  return socket?.connected ?? false;
}
