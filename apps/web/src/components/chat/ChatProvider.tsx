// craftsman-ignore: TS001,TS002
import React, { createContext, useContext, useEffect } from 'react';
import { useSocket } from '../../hooks/useSocket';
import { useChatSync } from '../../hooks/useChatSync';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { chatApi } from '../../api/chat';

interface ChatContextValue {
  wsConnected: boolean;
}

const ChatContext = createContext<ChatContextValue>({ wsConnected: false });
export const useChatContext = () => useContext(ChatContext);

/**
 * Global Chat 3.0 Provider — manages WebSocket connection,
 * sync fallback, and initial conversation list loading.
 * Mount once at AppLayout level.
 *
 * IMPORTANT: Use getState() for mutations inside effects/callbacks,
 * NOT subscribe hooks — subscribing to the full store causes
 * infinite re-render loops when effects update the store.
 */
export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const user = useAuthStore((s) => s.user);
  const [wsConnected] = React.useState(true);

  // Initialize myUserId — only on user change, no store dependency
  useEffect(() => {
    if (user?.id) {
      useChatStore.getState().setMyUserId(user.id);
    }
  }, [user?.id]);

  // Load conversation list — only on user change, no store dependency
  useEffect(() => {
    if (!user?.id) return;
    chatApi
      .listConversations()
      .then(({ data }) => {
        const list = data?.data?.conversations || [];
        if (list.length > 0) {
          useChatStore.getState().setConversations(list);
        }
      })
      .catch(() => {});
  }, [user?.id]);

  // WebSocket: handle incoming messages — use getState() to avoid stale closures
  useSocket({
    onChatMessage: (data: any) => {
      if (data?.conversationId && data?.message) {
        useChatStore.getState().receiveMessage(
          data.conversationId, data.message, data.orderInfo,
        );
      }
    },
    onMessageNew: (data: any) => {
      if (data?.roomId && data?.message) {
        useChatStore.getState().receiveMessage(data.roomId, data.message);
      }
    },
    onMessageUpdated: (data: any) => {
      if (data?.roomId && data?.message) {
        useChatStore.getState().receiveMessage(data.roomId, data.message);
      }
    },
  });

  // HTTP polling fallback when WS is disconnected
  useChatSync(wsConnected);

  return <ChatContext.Provider value={{ wsConnected }}>{children}</ChatContext.Provider>;
};
