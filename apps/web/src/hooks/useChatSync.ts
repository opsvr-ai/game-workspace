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
          useChatStore.getState().receiveMessage((msg as any).roomId || (msg as any).conversationId, msg);
        }
        useChatStore.getState().setSyncing(false);
      }
    } catch {
      // silent — will retry next interval
    }
  }, []);

  useEffect(() => {
    // Always sync on mount
    sync();
    // Always run polling as safety net (30s), WS is still primary for real-time
    intervalRef.current = setInterval(sync, 30000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [wsConnected, sync]);
}
