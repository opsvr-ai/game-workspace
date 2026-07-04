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
    logger.info('WebSocket connected');

    // Heartbeat every 30s
    heartbeatTimer = setInterval(() => {
      socket?.emit('companion:heartbeat', {
        agentVersion: '3.0.0',
        currentMode: 'WORK',
        companionId,
      });
    }, 30_000);
  });

  socket.on('disconnect', () => {
    logger.warn('WebSocket disconnected');
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  });

  // Listen for orders
  socket.on('order:new', (data: any) => {
    emitEvent('order:new', data);
  });

  // Blacklist process management
  socket.on('blacklist:update', (data: any) => {
    emitEvent('blacklist:update', data);
  });

  socket.on('blacklist:recheck', (data: any) => {
    emitEvent('blacklist:recheck', data);
  });


  socket.on('order:urgent', (data: any) => {
    emitEvent('order:urgent', data);
  });

  socket.on('order:pool_updated', (data: any) => {
    emitEvent('order:pool_updated', data);
  });

  socket.on('status:broadcast', (data: any) => {
    emitEvent('status:broadcast', data);
  });

  socket.on('pc:command', (data: any) => {
    emitEvent('pc:command', data);
  });

  socket.on('order:new', (data: any) => {
    emitEvent('order:new', data);
  });

  // Blacklist process management
  socket.on('blacklist:update', (data: any) => {
    emitEvent('blacklist:update', data);
  });

  socket.on('blacklist:recheck', (data: any) => {
    emitEvent('blacklist:recheck', data);
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
  logger.info('Electron emit companion:status', { status, mode, connected: socket?.connected });
  socket?.emit('companion:status', { status, mode });
}


/** Emit a process report to the server. */
export function emitBlacklistReport(processes: any[], totalCount: number): void {
  socket?.emit('blacklist:report', { processes, totalCount });
}

/** Emit a kill result to the server. */
export function emitKillResult(result: { processName: string; pid: number; success: boolean; resultText: string }): void {
  socket?.emit('blacklist:kill_result', {
    processName: result.processName,
    pid: result.pid,
    success: result.success,
    resultText: result.resultText,
    triggeredBy: 'PERIODIC',
  });
}
export function isConnected(): boolean {
  return socket?.connected ?? false;
}
