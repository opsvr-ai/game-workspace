// craftsman-ignore: TS001,TS002
import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Message } from '../../stores/chatStore';
import MessageBubble from './MessageBubble';
import DateDivider from './DateDivider';
import TypingIndicator from './TypingIndicator';

import { BG, SEMANTIC } from '../../styles/tokens';
const SHOULD_SHOW_TIME_THRESHOLD = 3 * 60 * 1000;

interface MessageListProps {
  messages: Message[];
  myUserId: string | null;
  participantName?: string;
  participantAvatarUrl?: string;
  groupMemberMap?: Record<string, { username: string; displayName?: string; avatar?: string; role: string }>;
  myAvatarUrl?: string;
  typing?: boolean;
  onReply?: (msg: Message) => void;
  onRecall?: (msg: Message) => void;
  onReaction?: (msgId: string, emoji: string) => void;
  onRemoveReaction?: (msgId: string, emoji: string) => void;
  onContextMenu?: (e: React.MouseEvent, msg: Message) => void;
  onMentionSender?: (name: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  /** 对方在本会话读到哪一条（undefined = 还不知道，不显示回执） */
  peerReadSeq?: number;
  /** 群聊不做单条已读回执 */
  isGroup?: boolean;
  /**
   * 当前会话 id：换会话时要把「贴底 / 跳未读」这些状态整份重置
   * （ChatPanel 不会重建 MessageList，只能靠这个值认出来）。
   */
  conversationId?: string;
  /** 打开这个会话时我读到哪一条（服务端 myReadSeq）—— 比它大的就是这次未读 */
  unreadFromSeq?: number;
}

const MessageList: React.FC<MessageListProps> = ({
  messages,
  myUserId,
  participantName,
  participantAvatarUrl,
  groupMemberMap,
  myAvatarUrl,
  typing,
  onReply: _onReply,
  onRecall: _onRecall,
  onReaction,
  onRemoveReaction,
  onContextMenu,
  onMentionSender,
  onLoadMore,
  hasMore,
  peerReadSeq,
  isGroup,
  conversationId,
  unreadFromSeq,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  /** 贴着底：打开会话、或用户自己滚到底时为 true。虚拟列表量完高度会变，靠它持续贴底。 */
  const stickToBottomRef = useRef(true);
  /** 这次的未读已经「到过」了（点过跳转 / 在视野里出现过），顶部那根条就不再冒出来 */
  const unreadSeenRef = useRef(false);
  const [showNewMessageBtn, setShowNewMessageBtn] = useState(false);
  const [showUnreadJump, setShowUnreadJump] = useState(false);
  const prevLengthRef = useRef(messages.length);

  const virtualizer = useVirtualizer({
    count: messages.length + (typing ? 1 : 0),
    getScrollElement: () => containerRef.current,
    estimateSize: () => 80,
    overscan: 10,
  });
  const totalSize = virtualizer.getTotalSize();

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      setShowNewMessageBtn(false);
    });
  }, []);

  /** 未读第一条在消息数组里的下标（-1 = 这次没有未读）。 */
  const firstUnreadIndex = useMemo(() => {
    if (typeof unreadFromSeq !== 'number' || !Number.isFinite(unreadFromSeq)) return -1;
    return messages.findIndex((m) => typeof m.seq === 'number' && m.seq > unreadFromSeq);
  }, [messages, unreadFromSeq]);

  /** 这次未读的条数（按 seq 数，跟列表加载到第几页无关）。 */
  const unreadCount = useMemo(() => {
    if (firstUnreadIndex < 0) return 0;
    return messages.reduce((n, m) => (typeof m.seq === 'number' && m.seq > (unreadFromSeq as number) ? n + 1 : n), 0);
  }, [messages, unreadFromSeq, firstUnreadIndex]);

  /** 未读那条现在是不是已经在视野里（用真实 DOM 位置算，别用估算值）。 */
  const isUnreadOnScreen = useCallback(() => {
    const el = containerRef.current;
    if (!el || firstUnreadIndex < 0) return false;
    const node = el.querySelector<HTMLElement>(`[data-index="${firstUnreadIndex}"]`);
    if (!node) return false;
    const top = node.offsetTop;
    const bottom = top + node.offsetHeight;
    return bottom > el.scrollTop && top < el.scrollTop + el.clientHeight;
  }, [firstUnreadIndex]);

  // 换会话：整份重置（贴底、未读起点、两个浮标）
  const prevConvRef = useRef<string | undefined>(conversationId);
  useEffect(() => {
    if (prevConvRef.current === conversationId) return;
    prevConvRef.current = conversationId;
    nearBottomRef.current = true;
    stickToBottomRef.current = true;
    unreadSeenRef.current = false;
    prevLengthRef.current = messages.length;
    setShowNewMessageBtn(false);
    setShowUnreadJump(false);
  }, [conversationId, messages.length]);

  // 打开会话就贴到最新消息。虚拟列表是异步测量高度的：刚渲染时算出来的
  // scrollHeight 是估算值，量完还会变，所以只滚一次常常「差一截」——
  // 这里跟着 totalSize 一直贴，另加几个延时兜底，确保真的落在最底部。
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1]?.id : undefined;
  // 依赖里必须带 conversationId / lastMessageId：换会话时两边消息条数一样（都是 50 条）的话，
  // 光看 messages.length 不会触发，就又会「打开不在最底」—— 这正是老板 2026-10-02 报的问题。
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollToBottom();
  }, [conversationId, messages.length, lastMessageId, totalSize, scrollToBottom]);

  useEffect(() => {
    if (!conversationId) return;
    const timers = [0, 60, 180, 400, 800].map((ms) =>
      window.setTimeout(() => {
        if (stickToBottomRef.current) scrollToBottom();
      }, ms),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [conversationId, scrollToBottom]);

  // 顶部「N 条未读」条：没有未读 / 已经到过 / 未读那条就在眼前 → 不显示
  useEffect(() => {
    if (firstUnreadIndex < 0 || unreadSeenRef.current) {
      setShowUnreadJump(false);
      return;
    }
    if (isUnreadOnScreen()) {
      unreadSeenRef.current = true;
      setShowUnreadJump(false);
      return;
    }
    setShowUnreadJump(true);
  }, [firstUnreadIndex, isUnreadOnScreen, messages.length, totalSize]);

  // Auto-scroll to bottom on new messages（微信式：在底部才自动滚，否则显示「新消息」按钮）
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

  // Load more when scrolling to top
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = distanceFromBottom < 80;
    stickToBottomRef.current = nearBottomRef.current;
    if (nearBottomRef.current && showNewMessageBtn) setShowNewMessageBtn(false);
    if (el.scrollTop < 60 && onLoadMore && hasMore) onLoadMore();

    if (firstUnreadIndex < 0 || unreadSeenRef.current) {
      setShowUnreadJump(false);
      return;
    }
    if (isUnreadOnScreen()) {
      unreadSeenRef.current = true;
      setShowUnreadJump(false);
    } else {
      setShowUnreadJump(true);
    }
  }, [onLoadMore, hasMore, showNewMessageBtn, firstUnreadIndex, isUnreadOnScreen]);

  /** 顶部未读条：点一下定位到「最开始的那条未读」 */
  const jumpToFirstUnread = useCallback(() => {
    if (firstUnreadIndex < 0) return;
    unreadSeenRef.current = true;
    setShowUnreadJump(false);
    stickToBottomRef.current = false;
    nearBottomRef.current = false;
    virtualizer.scrollToIndex(firstUnreadIndex, { align: 'start' });
  }, [firstUnreadIndex, virtualizer]);

  return (
    <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', background: BG.container }}
      >
        <div style={{ height: totalSize, position: 'relative' }}>
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
            const sender = !isMe && groupMemberMap ? groupMemberMap[msg.senderId] : undefined;
            const senderName = sender
              ? (sender.displayName || sender.username)
              : participantName;
            const showSenderName = !!groupMemberMap && !isMe && showAvatar;
            const senderAvatarUrl = sender?.avatar
              ? `/uploads/avatars/${sender.avatar}?v=${sender.avatar}`
              : participantAvatarUrl;

            return (
              <div
                key={msg.id}
                data-index={vi.index}
                style={{ position: 'absolute', top: vi.start, width: '100%' }}
                ref={virtualizer.measureElement}
              >
                {showDivider && <DateDivider timestamp={msg.createdAt} />}
                {vi.index === firstUnreadIndex && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      margin: '4px 0 10px',
                      color: '#F5222D',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ flex: 1, height: 1, background: SEMANTIC.dangerBorder }} />
                    <span>以下为新消息</span>
                    <div style={{ flex: 1, height: 1, background: SEMANTIC.dangerBorder }} />
                  </div>
                )}
                <MessageBubble
                  message={msg}
                  isMe={isMe}
                  showAvatar={showAvatar}
                  showTime={showTime}
                  participantName={isMe ? undefined : senderName}
                  avatarUrl={isMe ? myAvatarUrl : senderAvatarUrl}
                  showSenderName={showSenderName}
                  senderName={senderName}
                  onReaction={(emoji) => onReaction?.(msg.id, emoji)}
                  onRemoveReaction={(emoji) => onRemoveReaction?.(msg.id, emoji)}
                  onContextMenu={(e) => onContextMenu?.(e, msg)}
                  onMentionSender={() => onMentionSender?.(senderName || '')}
                  myUserId={myUserId}
                  readReceipt={
                    isMe && !isGroup && typeof msg.seq === 'number' && typeof peerReadSeq === 'number'
                      ? msg.seq <= peerReadSeq
                        ? 'read'
                        : 'unread'
                      : null
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
      {showUnreadJump && (
        <div
          onClick={jumpToFirstUnread}
          title="定位到最开始的那条未读"
          style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 5,
            background: BG.container,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            borderRadius: 14,
            padding: '4px 12px',
            fontSize: 12,
            cursor: 'pointer',
            color: '#F5222D',
            userSelect: 'none',
          }}
        >
          ↑ {unreadCount} 条未读 · 点这里回到未读处
        </div>
      )}
      {showNewMessageBtn && (
        <div
          onClick={scrollToBottom}
          style={{
            position: 'absolute',
            bottom: 12,
            right: 20,
            background: BG.container,
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
