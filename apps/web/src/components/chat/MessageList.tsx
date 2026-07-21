// craftsman-ignore: TS001,TS002
import React, { useRef, useEffect, useCallback } from 'react';
import type { Message } from '../../stores/chatStore';
import MessageBubble from './MessageBubble';
import DateDivider from './DateDivider';
import TypingIndicator from './TypingIndicator';

const SHOULD_SHOW_TIME_THRESHOLD = 3 * 60 * 1000; // 3 min gap → show time label

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
  onReply,
  onRecall,
  onReaction,
  onRemoveReaction,
  onContextMenu,
  onLoadMore,
  hasMore,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Track if scrolled to bottom
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

  // Auto-scroll to bottom when new messages arrive (only if already at bottom)
  useEffect(() => {
    if (isAtBottomRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, typing]);

  // Scroll to bottom on initial load
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'auto' });
    }
  }, []);

  // IntersectionObserver for load more
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onLoadMore || !hasMore) return;
    const sentinel = el.querySelector('.load-more-sentinel');
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { root: el, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onLoadMore, hasMore]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 16px',
        background: '#FFF',
      }}
    >
      {/* Load more sentinel */}
      {hasMore && onLoadMore && <div className="load-more-sentinel" style={{ height: 1 }} />}

      {messages.map((msg, i) => {
        const prev = i > 0 ? messages[i - 1] : null;
        const isMe = msg.senderId === myUserId;
        const sameSender = prev && prev.senderId === msg.senderId;
        const withinTimeGap = prev && msg.createdAt - prev.createdAt < SHOULD_SHOW_TIME_THRESHOLD;
        const showAvatar = !sameSender || !withinTimeGap;
        const showTime =
          i === messages.length - 1 ||
          (messages[i + 1] ? messages[i + 1].createdAt - msg.createdAt >= SHOULD_SHOW_TIME_THRESHOLD : true);

        return (
          <React.Fragment key={msg.id}>
            {/* Date divider when gap is large */}
            {prev && msg.createdAt - prev.createdAt >= SHOULD_SHOW_TIME_THRESHOLD && (
              <DateDivider timestamp={msg.createdAt} />
            )}
            <MessageBubble
              message={msg}
              isMe={isMe}
              showAvatar={showAvatar}
              showTime={showTime}
              participantName={isMe ? undefined : participantName}
              onReply={() => onReply?.(msg)}
              onRecall={() => onRecall?.(msg)}
              onReaction={(emoji) => onReaction?.(msg.id, emoji)}
              onRemoveReaction={(emoji) => onRemoveReaction?.(msg.id, emoji)}
              onContextMenu={(e) => onContextMenu?.(e, msg)}
              myUserId={myUserId}
            />
          </React.Fragment>
        );
      })}

      {/* Typing indicator */}
      {typing && <TypingIndicator />}

      {/* Auto-scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
};

export default React.memo(MessageList);
