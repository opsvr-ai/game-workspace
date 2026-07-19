import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface UseSocketOptions {
  onOrderPoolUpdated?: (data: any) => void;
  onOrderGrabbed?: (data: any) => void;
  onOrderNew?: (data: any) => void;
  onOrderUrgent?: (data: any) => void;
  onStatusBroadcast?: (data: any) => void;
  onChatNotify?: (data: any) => void;
}

export function useSocket(opts: UseSocketOptions = {}) {
  const socketRef = useRef<Socket | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const token = sessionStorage.getItem('accessToken');
    if (!token) return;

    // In dev: Vite serves on :8000, API on :3001 — connect directly to API server
    const wsUrl = import.meta.env.DEV ? `http://${window.location.hostname}:3001` : '/';
    const socket = io(wsUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('order:pool_updated', (data: any) => {
      optsRef.current.onOrderPoolUpdated?.(data);
    });

    socket.on('order:grabbed', (data: any) => {
      optsRef.current.onOrderGrabbed?.(data);
    });

    socket.on('status:broadcast', (data: any) => {
      optsRef.current.onStatusBroadcast?.(data);
    });

    socket.on('chat:notify', (data: any) => {
      optsRef.current.onChatNotify?.(data);
    });

    socket.on('chat:new', (data: any) => {
      optsRef.current.onChatNotify?.(data);
    });

    socket.on('order:new', (data: any) => {
      optsRef.current.onOrderNew?.(data);
    });

    socket.on('order:urgent', (data: any) => {
      optsRef.current.onOrderUrgent?.(data);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return socketRef;
}
