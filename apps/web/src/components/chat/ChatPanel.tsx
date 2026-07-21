// craftsman-ignore: TS001,TS002
import React, { useState, useCallback } from 'react';
import { useChatStore, type Message } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { chatApi } from '../../api/chat';
import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import ChatComposer from './ChatComposer';
import MessageContextMenu from './MessageContextMenu';

interface ChatPanelProps {
  roomId?: string; // external room control
  participant?: { userId: string; username: string; displayName?: string; avatar?: string; role: string };
  orderInfo?: string;
  embedded?: boolean; // embedded mode: no close button, compact header
  onClose?: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ roomId, participant, orderInfo, embedded, onClose }) => {
  const user = useAuthStore((s) => s.user);
  const store = useChatStore();
  const conv = roomId ? store.conversations[roomId] : undefined;
  const messages = conv?.messages || [];
  const participantName = participant?.displayName || participant?.username || '...';

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: Message } | null>(null);
  const [, setReplyTarget] = useState<Message | null>(null);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!roomId) return;
      // Optimistic add
      const tempId = `temp-${Date.now()}`;
      store.receiveMessage(roomId, {
        id: tempId,
        senderId: user?.id,
        text,
        content: text,
        type: 'TEXT',
        createdAt: new Date().toISOString(),
        status: 'pending',
      });

      try {
        const { data } =
          (await (chatApi.sendRoomMessage as any)(roomId, {
            type: 'TEXT',
            content: text,
            replyToId,
          })) || (await chatApi.sendMessage(roomId, text));

        // Replace temp with real message
        const realMsg = data?.data?.message || data?.data;
        if (realMsg) {
          store.receiveMessage(roomId, realMsg);
        }
      } catch {
        // Mark as failed
        const conv2 = useChatStore.getState().conversations[roomId];
        if (conv2) {
          const msgs = conv2.messages.map((m) => (m.id === tempId ? { ...m, status: 'failed' as const } : m));
          useChatStore.setState((s) => ({
            conversations: { ...s.conversations, [roomId]: { ...conv2, messages: msgs } },
          }));
        }
      }
    },
    [roomId, user?.id, store],
  );

  const handleUpload = useCallback(async (file: File) => {
    try {
      const { data } = await chatApi.uploadFile(file);
      const info = data?.data;
      if (info?.url) {
        const isImage = file.type.startsWith('image/');
        return isImage ? `[img]${info.url}[/img]` : `[${info.fileName}](${info.url})`;
      }
    } catch {
      // upload failed, continue without attachment
    }
    return undefined;
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, msg: Message) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, message: msg });
  }, []);

  const handleReply = useCallback((msg: Message) => {
    setReplyTarget(msg);
    setContextMenu(null);
  }, []);

  const handleRecall = useCallback(
    async (msg: Message) => {
      if (!roomId) return;
      try {
        await (chatApi as any).recallRoomMessage?.(roomId, msg.id);
      } catch {}
      setContextMenu(null);
    },
    [roomId],
  );

  const handleReaction = useCallback(
    async (msgId: string, emoji: string) => {
      if (!roomId) return;
      try {
        await (chatApi as any).addReaction?.(roomId, msgId, emoji);
        // Optimistic update
        const conv2 = useChatStore.getState().conversations[roomId];
        if (conv2) {
          const msgs = conv2.messages.map((m) =>
            m.id === msgId ? { ...m, reactions: [...(m.reactions || []), { userId: user?.id || '', emoji }] } : m,
          );
          useChatStore.setState((s) => ({
            conversations: { ...s.conversations, [roomId]: { ...conv2, messages: msgs } },
          }));
        }
      } catch {}
    },
    [roomId, user?.id],
  );

  const handleRemoveReaction = useCallback(
    async (msgId: string, emoji: string) => {
      if (!roomId) return;
      try {
        await (chatApi as any).removeReaction?.(roomId, msgId, emoji);
      } catch {}
    },
    [roomId],
  );

  const handleLoadMore = useCallback(() => {
    if (!roomId || !conv?.hasMore) return;
    const oldest = conv.messages[0];
    if (!oldest) return;
    chatApi
      .getMessages(roomId, oldest.createdAt.toString())
      .then(({ data }) => {
        const msgs = data?.data?.messages || [];
        if (msgs.length > 0) {
          useChatStore.getState().prependMessages(roomId, msgs, data?.data?.hasMore ?? false);
        }
      })
      .catch(() => {});
  }, [roomId, conv]);

  if (!roomId) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#949BA4',
          fontSize: 14,
        }}
      >
        选择一位陪玩开始聊天
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#FFF',
        borderLeft: embedded ? '1px solid #E8E9EB' : undefined,
      }}
    >
      <ChatHeader
        name={participantName}
        role={participant?.role || ''}
        orderInfo={orderInfo || conv?.orderInfo}
        pinned={conv?.pinned}
        onClose={onClose}
        onTogglePin={() => {
          if (roomId) {
            chatApi.updateRoom?.(roomId, { pinned: !conv?.pinned }).catch(() => {});
          }
        }}
      />

      <MessageList
        messages={messages}
        myUserId={user?.id || null}
        participantName={participantName}
        typing={false}
        hasMore={conv?.hasMore ?? false}
        onLoadMore={handleLoadMore}
        onReply={handleReply}
        onRecall={handleRecall}
        onReaction={handleReaction}
        onRemoveReaction={handleRemoveReaction}
        onContextMenu={handleContextMenu}
      />

      <ChatComposer onSend={handleSend} onUpload={handleUpload} />

      {/* Context menu */}
      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isMine={contextMenu.message.senderId === user?.id}
          canRecall={Date.now() - contextMenu.message.createdAt < 2 * 60 * 1000}
          onClose={() => setContextMenu(null)}
          onCopy={() => navigator.clipboard.writeText(contextMenu.message.text)}
          onReply={() => handleReply(contextMenu.message)}
          onRecall={() => handleRecall(contextMenu.message)}
          onDelete={() => setContextMenu(null)} // soft-delete local only
          onReaction={(emoji) => handleReaction(contextMenu.message.id, emoji)}
        />
      )}
    </div>
  );
};

export default ChatPanel;
