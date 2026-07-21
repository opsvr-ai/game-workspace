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
 */
export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const user = useAuthStore((s) => s.user);
  const store = useChatStore();
  const [wsConnected, setWsConnected] = React.useState(false);

  // Initialize myUserId
  useEffect(() => {
    if (user?.id) store.setMyUserId(user.id);
  }, [user?.id, store]);

  // Load conversation list on mount
  useEffect(() => {
    if (!user?.id) return;
    chatApi
      .listConversations()
      .then(({ data }) => {
        const list = data?.data?.conversations || [];
        if (list.length > 0) store.setConversations(list);
      })
      .catch(() => {});
  }, [user?.id, store]);

  // WebSocket: handle incoming messages
  useSocket({
    onChatMessage: (data: any) => {
      if (data?.conversationId && data?.message) {
        store.receiveMessage(data.conversationId, data.message, data.orderInfo);
      }
    },
    onMessageNew: (data: any) => {
      if (data?.roomId && data?.message) {
        store.receiveMessage(data.roomId, data.message);
      }
    },
    onMessageUpdated: (data: any) => {
      if (data?.roomId && data?.message) {
        store.receiveMessage(data.roomId, data.message);
      }
    },
  });

  // Track WS connection state
  useEffect(() => {
    setWsConnected(true);
    return () => setWsConnected(false);
  }, []);

  // HTTP polling fallback when WS is disconnected
  useChatSync(wsConnected);

  return <ChatContext.Provider value={{ wsConnected }}>{children}</ChatContext.Provider>;
};

export default ChatProvider;
