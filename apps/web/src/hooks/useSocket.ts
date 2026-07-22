// craftsman-ignore: TS001
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface UseSocketOptions {
  onOrderPoolUpdated?: (data: any) => void;
  onOrderGrabbed?: (data: any) => void;
  onOrderNew?: (data: any) => void;
  onOrderUrgent?: (data: any) => void;
  onStatusBroadcast?: (data: any) => void;
  // Legacy chat events (deprecated, remove after migration)
  onChatNotify?: (data: any) => void;
  onChatNew?: (data: any) => void;
  onChatMessage?: (data: any) => void;
  // Chat 3.0 events
  onMessageNew?: (data: any) => void;
  onMessageUpdated?: (data: any) => void;
  onMessageAcked?: (data: any) => void;
  onTypingNotify?: (data: any) => void;
  onRoomUpdated?: (data: any) => void;
  onSyncRequired?: (data: any) => void;
  onPartnerCall?: (data: any) => void;
  onWalletReviewed?: (data: any) => void;
  onUserAuthorized?: (data: any) => void;
  onUserRejected?: (data: any) => void;
  onBridgeResponded?: (data: any) => void;
}

export function useSocket(opts: UseSocketOptions = {}) {
  const socketRef = useRef<Socket | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const token = sessionStorage.getItem('accessToken');
    if (!token) return;

    // Always connect directly to API server on :3001 (Vite preview doesn't proxy WS)
    const wsUrl = import.meta.env.DEV
      ? `http://${window.location.hostname}:3001`
      : `http://${window.location.hostname}:3001`;
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

    socket.on('order:partner_call', (data: any) => {
      optsRef.current.onPartnerCall?.(data);
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

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return socketRef;
}
