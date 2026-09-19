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
    // 挂载时先对一次账
    sync();
    // 长连接正常时用不着每 30 秒问一次：一发一收就是一次 HTTP 往返，
    // 一天白跑两千多次。连着的时候只留一个 2 分钟的兜底对账；
    // 真断了才降回 30 秒一次快速补齐。
    const period = wsConnected ? 120000 : 30000;
    intervalRef.current = setInterval(sync, period);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [wsConnected, sync]);
}
