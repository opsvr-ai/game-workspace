// craftsman-ignore: TS001,TS002
import React, { useRef, useEffect, useCallback } from 'react';
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

  const virtualizer = useVirtualizer({
    count: messages.length + (typing ? 1 : 0),
    getScrollElement: () => containerRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  // Auto-scroll to bottom on new messages
  const prevLengthRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevLengthRef.current) {
      const lastIdx = messages.length - 1;
      const lastMsg = messages[lastIdx];
      if (lastMsg?.senderId === myUserId || prevLengthRef.current === 0) {
        virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
      }
    }
    prevLengthRef.current = messages.length;
  }, [messages.length, myUserId, virtualizer]);

  // Scroll to bottom on mount
  useEffect(() => {
    if (messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    }
  }, []); // eslint-disable-line

  // Load more when scrolling to top
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || !onLoadMore || !hasMore) return;
    if (el.scrollTop < 60) onLoadMore();
  }, [onLoadMore, hasMore]);

  return (
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
  );
};

export default React.memo(MessageList);
