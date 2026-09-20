// craftsman-ignore: TS001,TS002
import React, { createContext, useContext, useEffect } from 'react';
import { useSocket } from '../../hooks/useSocket';
import { useChatSync } from '../../hooks/useChatSync';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { chatApi } from '../../api/chat';
import { playMessageSound } from '../../utils/notificationSound';
import { showSystemNotification, playNotificationSound } from '../../utils/notify';

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
    namespace: '/chat',
    onChatMessage: (data: any) => {
      if (data?.conversationId && data?.message) {
        useChatStore.getState().receiveMessage(
          data.conversationId, data.message, data.orderInfo,
        );
      }
    },
    onMessageNew: (data: any) => {
      if (data?.roomId && data?.message) {
        const state = useChatStore.getState();
        const isMine = data.message.senderId === state.myUserId;
        const isActive = state.activeConversationId === data.roomId;
        if (!isMine && !isActive) playMessageSound();
        if (!isMine && data.message.mentions?.includes(state.myUserId)) {
          showSystemNotification(
            '蠢驴电竞 · 有人@你',
            (data.sender?.displayName || data.sender?.username || '有人') +
              '：' +
              (data.message.content || data.message.text || '[消息]'),
          );
          playNotificationSound();
        }
        useChatStore.getState().receiveMessage(
          data.roomId,
          data.message,
          undefined,
          data.sender,
          data.isGroup
            ? { isGroup: true, groupName: data.groupName || '工作室群聊' }
            : undefined,
        );
        // 正开着这个会话 = 人就在看，直接标已读，让对方立刻看到「已阅读」。
        if (!isMine && isActive) {
          chatApi.markRoomRead(data.roomId).catch(() => {});
        }
      }
    },
    onMessageUpdated: (data: any) => {
      if (data?.roomId && data?.message) {
        useChatStore.getState().receiveMessage(data.roomId, data.message);
      }
    },
    onChatRead: (data: any) => {
      // 对方看到我发的消息了：把「对方读到哪一条」记下来，界面上的「未读」立刻变「已阅读」。
      if (data?.roomId && typeof data?.readSeq === 'number') {
        useChatStore.getState().setPeerReadSeq(data.roomId, data.readSeq);
      }
    },
  });

  // HTTP polling fallback when WS is disconnected
  useChatSync(wsConnected);

  return <ChatContext.Provider value={{ wsConnected }}>{children}</ChatContext.Provider>;
};
