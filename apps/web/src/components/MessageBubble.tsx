import React from 'react';
import type { Message } from '../stores/chatStore';

interface Props {
  msg: Message;
  isMe: boolean;
  showAvatar: boolean;
  showDivider: boolean;
  avatarName: string;
  avatarUrl?: string;
}

const MessageBubble: React.FC<Props> = ({ msg, isMe, showAvatar, showDivider, avatarName, avatarUrl }) => {
  const time = (() => {
    const d = new Date(msg.createdAt);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  })();

  const dividerTime = (() => {
    const d = new Date(msg.createdAt);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return `${m}/${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  })();

  return (
    <>
      {showDivider && (
        <div style={{ textAlign: 'center', margin: '14px 0 10px' }}>
          <span style={{ fontSize: 11, color: '#B0B0B0', background: '#F5F6FA', padding: '2px 8px', borderRadius: 4 }}>
            {dividerTime}
          </span>
        </div>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: isMe ? 'row-reverse' : 'row',
          alignItems: 'flex-start',
          gap: 8,
          marginBottom: showAvatar ? 12 : 2,
          paddingLeft: isMe ? 40 : 0,
          paddingRight: isMe ? 0 : 40,
        }}
      >
        {/* Avatar */}
        <div style={{ flexShrink: 0, visibility: showAvatar ? 'visible' : 'hidden' }}>
          {avatarUrl ? (
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: `url(${avatarUrl}) center/cover` }} />
          ) : (
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: '#CBD5E1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ color: '#FFF', fontSize: 14, fontWeight: 700 }}>
                {(avatarName || '?')[0].toUpperCase()}
              </span>
            </div>
          )}
        </div>

        <div style={{ maxWidth: '70%' }}>
          {/* Bubble */}
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 14,
              lineHeight: 1.5,
              wordBreak: 'break-word',
              background: isMe ? '#95EC69' : '#FFFFFF',
              color: '#1E293B',
              boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
              position: 'relative',
            }}
          >
            {/* Arrow */}
            {showAvatar && (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  [isMe ? 'right' : 'left']: -5,
                  width: 0,
                  height: 0,
                  borderTop: '5px solid transparent',
                  borderBottom: '5px solid transparent',
                  [isMe ? 'borderLeft' : 'borderRight']: `5px solid ${isMe ? '#95EC69' : '#FFF'}`,
                }}
              />
            )}
            {msg.text}
          </div>
          {/* Time — only on first message of group */}
          {showAvatar && (
            <div
              style={{
                fontSize: 11,
                color: '#B0B0B0',
                marginTop: 2,
                textAlign: isMe ? 'right' : 'left',
              }}
            >
              {time}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export { MessageBubble };
