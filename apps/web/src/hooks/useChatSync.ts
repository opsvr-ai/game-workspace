// craftsman-ignore: TS001,TS002
import { useEffect, useRef, useCallback } from 'react';
import { chatApi } from '../api/chat';
import { useChatStore } from '../stores/chatStore';

/**
 * HTTP polling fallback for WebSocket disconnection.
 * Automatically switches to periodic sync when WS is unavailable.
 */
export function useChatSync(wsConnected: boolean) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const store = useChatStore();

  const sync = useCallback(async () => {
    const state = useChatStore.getState();
    const rooms = Object.values(state.conversations)
      .filter((c) => c.lastKnownSeq !== undefined)
      .map((c) => ({ roomId: c.id, lastKnownSeq: c.lastKnownSeq || 0 }));

    if (rooms.length === 0) return;

    try {
      const { data } = await chatApi.syncRooms(rooms);
      const result = data?.data;
      if (result?.missedMessages?.length) {
        useChatStore.getState().setSyncing(true);
        for (const msg of result.missedMessages) {
          useChatStore.getState().receiveMessage(msg.roomId || msg.conversationId, msg);
        }
        useChatStore.getState().setSyncing(false);
      }
    } catch {
      // silent — will retry next interval
    }
  }, []);

  useEffect(() => {
    // Start polling when WS is disconnected
    if (!wsConnected) {
      intervalRef.current = setInterval(sync, 30000); // 30s fallback
    } else {
      // Sync once on reconnect
      sync();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [wsConnected, sync]);
}
