import { io, Socket } from 'socket.io-client';

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
    console.log('[WS] Connected');

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
    console.log('[WS] Disconnected');
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  });

  // Listen for orders
  socket.on('order:new', (data: any) => {
    emitEvent('order:new', data);
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
  socket?.emit('companion:status', { status, mode });
}

export function isConnected(): boolean {
  return socket?.connected ?? false;
}
