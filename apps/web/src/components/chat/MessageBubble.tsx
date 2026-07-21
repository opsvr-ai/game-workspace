// craftsman-ignore: TS001,TS002
import React from 'react';
import type { Message } from '../../stores/chatStore';
import ReplyPreview from './ReplyPreview';
import MessageReactions from './MessageReactions';

interface MessageBubbleProps {
  message: Message;
  isMe: boolean;
  showAvatar: boolean;
  showTime: boolean;
  participantName?: string;
  onReaction?: (emoji: string) => void;
  onRemoveReaction?: (emoji: string) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  myUserId?: string | null;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isMe,
  showAvatar,
  showTime,
  participantName,
  onReaction,
  onRemoveReaction,
  onContextMenu,
  myUserId,
}) => {
  const isRecalled = !!message.deletedAt;
  const isPending = message.status === 'pending';
  const isFailed = message.status === 'failed';

  const bubbleStyle: React.CSSProperties = {
    maxWidth: '70%',
    padding: '10px 14px',
    borderRadius: isMe ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
    background: isMe ? '#2B579A' : '#F2F3F5',
    color: isMe ? '#FFF' : '#313338',
    fontSize: 14,
    lineHeight: '22px',
    wordBreak: 'break-word',
    opacity: isPending ? 0.6 : 1,
    boxShadow: isFailed ? '0 0 0 1px #F23F42' : undefined,
    transition: 'opacity 0.2s',
  };

  const timeStr = new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      onContextMenu={onContextMenu}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isMe ? 'flex-end' : 'flex-start',
        marginBottom: showAvatar ? 8 : 2,
        marginTop: showAvatar ? 8 : 0,
      }}
    >
      {/* Reply preview */}
      {message.replyTo && <ReplyPreview replyTo={message.replyTo} />}

      {/* Avatar + Bubble */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: isMe ? 'row-reverse' : 'row' }}>
        {/* Avatar */}
        {showAvatar ? (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: isMe ? '#2B579A' : '#CBD5E1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFF',
              fontSize: 14,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {(participantName || '?')[0].toUpperCase()}
          </div>
        ) : (
          <div style={{ width: 36, flexShrink: 0 }} />
        )}

        {/* Bubble */}
        <div style={bubbleStyle}>
          {isRecalled ? (
            <span style={{ color: isMe ? 'rgba(255,255,255,0.6)' : '#999', fontStyle: 'italic', fontSize: 13 }}>
              消息已被撤回
            </span>
          ) : (
            <span>{message.text}</span>
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 4,
              marginTop: 2,
            }}
          >
            {isFailed && <span style={{ fontSize: 10, color: '#F23F42' }}>⚠ 发送失败</span>}
            {isMe && !isPending && !isFailed && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>✓</span>}
            {showTime && (
              <span
                style={{
                  fontSize: 10,
                  color: isMe ? 'rgba(255,255,255,0.5)' : '#949BA4',
                }}
              >
                {timeStr}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Reactions */}
      {!isRecalled && message.reactions && message.reactions.length > 0 && (
        <div style={{ marginLeft: isMe ? 0 : 44, marginRight: isMe ? 44 : 0 }}>
          <MessageReactions
            reactions={message.reactions}
            onAdd={(emoji) => onReaction?.(emoji)}
            onRemove={(emoji) => onRemoveReaction?.(emoji)}
            myUserId={myUserId}
          />
        </div>
      )}
    </div>
  );
};

export default React.memo(MessageBubble);
