// craftsman-ignore: TS001,TS002
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Message } from '../../stores/chatStore';
import MessageBubble from './MessageBubble';
import DateDivider from './DateDivider';
import TypingIndicator from './TypingIndicator';

const SHOULD_SHOW_TIME_THRESHOLD = 3 * 60 * 1000;

interface MessageListProps {
  messages: Message[];
  myUserId: string | null;
  participantName?: string;
  participantAvatarUrl?: string;
  myAvatarUrl?: string;
  typing?: boolean;
  onReply?: (msg: Message) => void;
  onRecall?: (msg: Message) => void;
  onReaction?: (msgId: string, emoji: string) => void;
  onRemoveReaction?: (msgId: string, emoji: string) => void;
  onContextMenu?: (e: React.MouseEvent, msg: Message) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

const MessageList: React.FC<MessageListProps> = ({
  messages,
  myUserId,
  participantName,
  participantAvatarUrl,
  myAvatarUrl,
  typing,
  onReply: _onReply,
  onRecall: _onRecall,
  onReaction,
  onRemoveReaction,
  onContextMenu,
  onLoadMore,
  hasMore,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [showNewMessageBtn, setShowNewMessageBtn] = useState(false);

  const virtualizer = useVirtualizer({
    count: messages.length + (typing ? 1 : 0),
    getScrollElement: () => containerRef.current,
    estimateSize: () => 80,
    overscan: 10,
  });

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      setShowNewMessageBtn(false);
    });
  }, []);

  // Auto-scroll to bottom on new messages（微信式：在底部才自动滚，否则显示“新消息”按钮）
  const prevLengthRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevLengthRef.current) {
      const lastIdx = messages.length - 1;
      const lastMsg = messages[lastIdx];
      if (lastMsg?.senderId === myUserId || nearBottomRef.current || prevLengthRef.current === 0) {
        scrollToBottom();
      } else {
        setShowNewMessageBtn(true);
      }
    }
    prevLengthRef.current = messages.length;
  }, [messages.length, myUserId, scrollToBottom]);

  // Scroll to bottom on mount
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, []); // eslint-disable-line

  // Load more when scrolling to top
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = distanceFromBottom < 80;
    if (nearBottomRef.current && showNewMessageBtn) setShowNewMessageBtn(false);
    if (el.scrollTop < 60 && onLoadMore && hasMore) onLoadMore();
  }, [onLoadMore, hasMore, showNewMessageBtn]);

  return (
    <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', background: '#FFF' }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vi) => {
            if (vi.index >= messages.length) {
              // Typing indicator row
              return (
                <div
                  key="typing"
                  data-index={vi.index}
                  style={{ position: 'absolute', top: vi.start, width: '100%' }}
                  ref={virtualizer.measureElement}
                >
                  <TypingIndicator />
                </div>
              );
            }

            const msg = messages[vi.index];
            const prev = vi.index > 0 ? messages[vi.index - 1] : null;
            const isMe = msg.senderId === myUserId;
            const sameSender = prev && prev.senderId === msg.senderId;
            const withinTimeGap = prev && msg.createdAt - prev.createdAt < SHOULD_SHOW_TIME_THRESHOLD;
            const showAvatar = !sameSender || !withinTimeGap;
            const showTime =
              vi.index === messages.length - 1 ||
              (messages[vi.index + 1]
                ? messages[vi.index + 1].createdAt - msg.createdAt >= SHOULD_SHOW_TIME_THRESHOLD
                : true);
            const showDivider = prev && msg.createdAt - prev.createdAt >= SHOULD_SHOW_TIME_THRESHOLD;

            return (
              <div
                key={msg.id}
                data-index={vi.index}
                style={{ position: 'absolute', top: vi.start, width: '100%' }}
                ref={virtualizer.measureElement}
              >
                {showDivider && <DateDivider timestamp={msg.createdAt} />}
                <MessageBubble
                  message={msg}
                  isMe={isMe}
                  showAvatar={showAvatar}
                  showTime={showTime}
                  participantName={isMe ? undefined : participantName}
                  avatarUrl={isMe ? myAvatarUrl : participantAvatarUrl}
                  onReaction={(emoji) => onReaction?.(msg.id, emoji)}
                  onRemoveReaction={(emoji) => onRemoveReaction?.(msg.id, emoji)}
                  onContextMenu={(e) => onContextMenu?.(e, msg)}
                  myUserId={myUserId}
                />
              </div>
            );
          })}
        </div>
      </div>
      {showNewMessageBtn && (
        <div
          onClick={scrollToBottom}
          style={{
            position: 'absolute',
            bottom: 12,
            right: 20,
            background: '#fff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            borderRadius: 14,
            padding: '4px 10px',
            fontSize: 12,
            cursor: 'pointer',
            color: '#2B579A',
          }}
        >
          ↓ 新消息
        </div>
      )}
    </div>
  );
};

export default React.memo(MessageList);
