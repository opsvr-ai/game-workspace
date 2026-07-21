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
  roomId?: string;
  participant?: { userId: string; username: string; displayName?: string; avatar?: string; role: string };
  orderInfo?: string;
  embedded?: boolean;
  onClose?: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ roomId, participant, orderInfo, embedded, onClose }) => {
  const user = useAuthStore((s) => s.user);
  // Use selectors — never subscribe to full store (causes infinite loops)
  const conv = useChatStore((s) => (roomId ? s.conversations[roomId] : undefined));
  const messages = conv?.messages || [];
  const participantName = participant?.displayName || participant?.username || '...';

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: Message } | null>(null);
  const [, setReplyTarget] = useState<Message | null>(null);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!roomId) return;
      const s = useChatStore.getState();
      const tempId = `temp-${Date.now()}`;
      s.receiveMessage(roomId, {
        id: tempId, senderId: user?.id, text, content: text,
        type: 'TEXT', createdAt: new Date().toISOString(), status: 'pending',
      });

      try {
        const { data } = await chatApi.sendRoomMessage(roomId, {
          type: 'TEXT', content: text, replyToId,
        });
        const realMsg = data?.data?.message;
        if (realMsg) {
          // Replace temp optimistic msg with real server msg (same message, don't duplicate)
          const conv2 = useChatStore.getState().conversations[roomId];
          if (conv2) {
            const msgs = conv2.messages.map((m) =>
              m.id === tempId ? { ...realMsg, status: 'sent' as const, createdAt: new Date(realMsg.createdAt).getTime() } : m,
            );
            useChatStore.setState((prev) => ({
              conversations: { ...prev.conversations, [roomId]: { ...conv2, messages: msgs } },
            }));
          }
        }
      } catch {
        const conv2 = useChatStore.getState().conversations[roomId];
        if (conv2) {
          const msgs = conv2.messages.map((m) =>
            m.id === tempId ? { ...m, status: 'failed' as const } : m,
          );
          useChatStore.setState((prev) => ({
            conversations: { ...prev.conversations, [roomId]: { ...conv2, messages: msgs } },
          }));
        }
      }
    },
    [roomId, user?.id],
  );

  const handleUpload = useCallback(async (file: File) => {
    try {
      const { data } = await chatApi.uploadFile(file);
      const info = data?.data;
      if (info?.url) {
        const isImage = file.type.startsWith('image/');
        return isImage ? `[img]${info.url}[/img]` : `[${info.fileName}](${info.url})`;
      }
    } catch {}
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

  const handleRecall = useCallback(async (msg: Message) => {
    if (!roomId) return;
    try { await chatApi.deleteRoomMessage?.(roomId, msg.id); } catch {}
    setContextMenu(null);
  }, [roomId]);

  const handleReaction = useCallback(async (msgId: string, emoji: string) => {
    if (!roomId) return;
    try {
      await chatApi.addReaction?.(roomId, msgId, emoji);
      const s = useChatStore.getState();
      const conv2 = s.conversations[roomId];
      if (conv2) {
        const msgs = conv2.messages.map((m) =>
          m.id === msgId ? { ...m, reactions: [...(m.reactions || []), { userId: user?.id || '', emoji }] } : m,
        );
        useChatStore.setState((prev) => ({
          conversations: { ...prev.conversations, [roomId]: { ...conv2, messages: msgs } },
        }));
      }
    } catch {}
  }, [roomId, user?.id]);

  const handleRemoveReaction = useCallback(async (msgId: string, emoji: string) => {
    if (!roomId) return;
    try { await chatApi.removeReaction?.(roomId, msgId, emoji); } catch {}
  }, [roomId]);

  const handleLoadMore = useCallback(() => {
    if (!roomId || !conv?.hasMore) return;
    const oldest = conv.messages[0];
    if (!oldest) return;
    chatApi.getMessages(roomId, oldest.createdAt.toString())
      .then(({ data }) => {
        const msgs = data?.data?.messages || [];
        if (msgs.length > 0) {
          useChatStore.getState().prependMessages(roomId, msgs, data?.data?.hasMore ?? false);
        }
      }).catch(() => {});
  }, [roomId, conv]);

  if (!roomId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#949BA4', fontSize: 14 }}>
        选择一位陪玩开始聊天
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#FFF', borderLeft: embedded ? '1px solid #E8E9EB' : undefined }}>
      <ChatHeader
        name={participantName}
        role={participant?.role || ''}
        orderInfo={orderInfo || conv?.orderInfo}
        pinned={conv?.pinned}
        onClose={onClose}
        onTogglePin={() => {
          if (roomId) chatApi.updateRoom?.(roomId, { pinned: !conv?.pinned }).catch(() => {});
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
      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x} y={contextMenu.y}
          isMine={contextMenu.message.senderId === user?.id}
          canRecall={Date.now() - contextMenu.message.createdAt < 2 * 60 * 1000}
          onClose={() => setContextMenu(null)}
          onCopy={() => navigator.clipboard.writeText(contextMenu.message.text)}
          onReply={() => handleReply(contextMenu.message)}
          onRecall={() => handleRecall(contextMenu.message)}
          onDelete={() => setContextMenu(null)}
          onReaction={(emoji) => handleReaction(contextMenu.message.id, emoji)}
        />
      )}
    </div>
  );
};

export default ChatPanel;
