// craftsman-ignore: TS001,TS002
import React from 'react';
import { Image } from 'antd';
import type { Message } from '../../stores/chatStore';
import ReplyPreview from './ReplyPreview';
import MessageReactions from './MessageReactions';

interface MessageBubbleProps {
  message: Message;
  isMe: boolean;
  showAvatar: boolean;
  showTime: boolean;
  participantName?: string;
  avatarUrl?: string;  // full URL to avatar image (e.g. /uploads/avatars/xxx)
  showSenderName?: boolean;
  senderName?: string;
  onReaction?: (emoji: string) => void;
  onRemoveReaction?: (emoji: string) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onMentionSender?: () => void;
  myUserId?: string | null;
}

const stringToColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 52%)`;
};

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isMe,
  showAvatar,
  showTime,
  participantName,
  avatarUrl,
  showSenderName,
  senderName,
  onReaction,
  onRemoveReaction,
  onContextMenu,
  onMentionSender,
  myUserId,
}) => {
  const isRecalled = !!message.deletedAt;
  const isPending = message.status === 'pending';
  const isFailed = message.status === 'failed';
  const isMentioned = !!myUserId && (message.mentions || []).includes(myUserId);
  // 群聊广播：客服/店长发的重要通知，气泡要跟普通聊天明显区分开
  const isBroadcast = message.type === 'BROADCAST';
  const fallbackColor = stringToColor(message.senderId || participantName || '?');

  const bubbleStyle: React.CSSProperties = {
    maxWidth: '70%',
    padding: '10px 14px',
    borderRadius: isMe ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
    background: isBroadcast ? '#FFF1F0' : isMe ? '#2B579A' : isMentioned ? '#FFF3C4' : '#F2F3F5',
    color: isBroadcast ? '#8C1F1F' : isMe ? '#FFF' : '#313338',
    fontSize: 14,
    lineHeight: '22px',
    wordBreak: 'break-word',
    overflow: 'hidden',
    opacity: isPending ? 0.6 : 1,
    boxShadow: isBroadcast ? '0 0 0 1px #FFA39E' : isFailed ? '0 0 0 1px #F23F42' : undefined,
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
      {/* 群聊发送者名字：右键名字直接 @ 对方 */}
      {showSenderName && senderName && (
        <div
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMentionSender?.();
          }}
          title={`右键 @${senderName}`}
          style={{
            marginLeft: 44,
            marginBottom: 2,
            fontSize: 11,
            color: '#949BA4',
            cursor: 'context-menu',
            userSelect: 'none',
          }}
        >
          {senderName}
        </div>
      )}

      {/* Reply preview */}
      {message.replyTo && <ReplyPreview replyTo={message.replyTo} />}

      {/* Avatar + Bubble */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: isMe ? 'row-reverse' : 'row' }}>
        {/* Avatar */}
        {showAvatar ? (
          <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
            {/* Initials fallback (always shown, below the image) */}
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: avatarUrl ? 'transparent' : fallbackColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#FFF', fontSize: 14, fontWeight: 700,
              position: 'absolute', top: 0, left: 0,
            }}>
              {(participantName || '?')[0].toUpperCase()}
            </div>
            {/* Avatar image (on top of initials, hides them when loaded) */}
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt=""
                style={{
                  width: 36, height: 36, borderRadius: '50%',
                  objectFit: 'cover', position: 'absolute', top: 0, left: 0,
                }}
              />
            )}
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
          ) : message.type === 'IMAGE' && message.attachments?.length ? (
            <ImageContent attachments={message.attachments} isMe={isMe} />
          ) : message.type === 'FILE' && message.attachments?.length ? (
            <FileContent attachment={message.attachments[0]} isMe={isMe} />
          ) : message.type === 'ORDER_CARD' ? (
            <OrderCardContent content={message.content || message.text} isMe={isMe} />
          ) : isBroadcast ? (
            <BroadcastContent text={message.text || ''} />
          ) : (
            <RenderText text={message.text || ''} />
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

// ── Inline rich media renderers ──

const ImageContent: React.FC<{ attachments: any[]; isMe: boolean }> = ({ attachments }) => {
  const imgs = attachments.filter((a: any) => a.type === 'IMAGE');
  if (!imgs.length) return <span>[图片]</span>;
  const cols = imgs.length === 1 ? 1 : imgs.length === 2 ? 2 : 3;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4, maxWidth: 280 }}>
      {imgs.map((img: any, i: number) => (
        <img
          key={i}
          src={img.thumbnailUrl || img.url}
          alt=""
          style={{
            width: '100%',
            borderRadius: 8,
            objectFit: 'cover',
            maxHeight: cols === 1 ? 240 : 140,
            cursor: 'pointer',
          }}
          onClick={() => {
            /* open ImageViewer */
          }}
        />
      ))}
    </div>
  );
};

const FileContent: React.FC<{ attachment: any; isMe: boolean }> = ({ attachment, isMe }) => {
  const { url, fileName, fileSize } = attachment;
  return (
    <a href={url} target="_blank" rel="noopener" style={{ color: isMe ? '#FFF' : '#313338', textDecoration: 'none' }}>
      📎 {fileName || '文件'} {fileSize ? `(${(fileSize / 1024).toFixed(1)}KB)` : ''}
    </a>
  );
};

const OrderCardContent: React.FC<{ content: string; isMe: boolean }> = ({ content }) => {
  let order: any = {};
  try {
    order = JSON.parse(content);
  } catch {
    return <span>{content}</span>;
  }
  const statusLabel: Record<string, string> = {
    PENDING: '待接单',
    GRABBED: '已抢到订单',
    CONFIRMED: '已确认',
    DONE: '已完成',
    CANCELLED: '已取消',
  };
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>📋 订单 #{order.orderId?.slice(-8)}</div>
      <div style={{ fontWeight: 600, marginTop: 2 }}>{order.gameName}</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>
        💰 ¥{Number(order.amount || 0).toFixed(0)}
        {order.duration ? ` · ⏱ ${order.duration}h` : ''}
      </div>
      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
        <span style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.08)' }}>
          {statusLabel[order.status] || order.status}
        </span>
      </div>
    </div>
  );
};

// 群聊广播：醒目的红底通知，和普通聊天明显区分
const BroadcastContent: React.FC<{ text: string }> = ({ text }) => (
  <div>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 700,
        color: '#D4380D',
        marginBottom: 4,
      }}
    >
      <span>📢</span>
      <span>群聊广播</span>
    </div>
    <RenderText text={text} />
  </div>
);

// Parse [img]url[/img] markup in text messages
const RenderText: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(\[img\].*?\[\/img\])/g);
  return (
    <span>
      {parts.map((part, i) => {
        const m = part.match(/^\[img\](.*?)\[\/img\]$/);
        if (m) return <Image key={i} src={m[1]} style={{ maxWidth: 200, maxHeight: 240, objectFit: 'contain', borderRadius: 8, display: 'block', margin: '4px 0' }} />;
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
};

export default React.memo(MessageBubble);
