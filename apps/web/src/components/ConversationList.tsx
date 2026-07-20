import React from 'react';
import { List, Typography, Badge } from 'antd';
import { useChatStore } from '../stores/chatStore';

interface Props {
  onOpenChat: (conversationId: string, participantName: string) => void;
  onClose: () => void;
}

const ConversationList: React.FC<Props> = ({ onOpenChat, onClose }) => {
  const { conversations, conversationOrder, totalUnread, markRead } = useChatStore();

  const items = conversationOrder
    .map((id) => conversations[id])
    .filter(Boolean)
    .filter((c) => c.lastMessageAt > 0 || c.messages.length > 0);

  const unreadItems = items.filter((c) => c.unreadCount > 0);
  const readItems = items.filter((c) => c.unreadCount === 0);

  if (items.length === 0) {
    return (
      <div style={{ width: 300, textAlign: 'center', padding: 24, color: '#94A3B8', fontSize: 13 }}>
        <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.5 }}>💬</div>
        暂无消息
      </div>
    );
  }

  const formatTime = (ts: number): string => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const renderItem = (c: (typeof items)[0]) => (
    <List.Item
      key={c.id}
      style={{
        cursor: 'pointer',
        padding: '10px 12px',
        borderRadius: 6,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = '#F8FAFC';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
      onClick={() => {
        markRead(c.id);
        onOpenChat(c.id, c.participant.displayName || c.participant.username);
        onClose();
      }}
    >
      <List.Item.Meta
        avatar={
          <div style={{ position: 'relative' }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: c.unreadCount > 0 ? 'linear-gradient(135deg, #2563EB, #3B82F6)' : '#CBD5E1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>
                {(c.participant.displayName || c.participant.username || '?')[0].toUpperCase()}
              </span>
            </div>
            {c.unreadCount > 0 && (
              <Badge count={c.unreadCount} size="small" style={{ position: 'absolute', top: -6, right: -6 }} />
            )}
          </div>
        }
        title={
          <span style={{ fontWeight: c.unreadCount > 0 ? 700 : 500, fontSize: 13 }}>
            {c.participant.displayName || c.participant.username}
          </span>
        }
        description={
          <div>
            <Typography.Text style={{ fontSize: 12, color: '#64748B' }} ellipsis>
              {c.lastMessage || ''}
            </Typography.Text>
            <Typography.Text style={{ fontSize: 11, color: '#94A3B8', float: 'right' }}>
              {formatTime(c.lastMessageAt)}
            </Typography.Text>
          </div>
        }
      />
    </List.Item>
  );

  return (
    <div style={{ width: 340, maxHeight: 480, overflowY: 'auto' }}>
      {unreadItems.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '4px 0 8px',
            borderBottom: '1px solid #F0F0F0',
            marginBottom: 4,
          }}
        >
          <Typography.Text strong style={{ fontSize: 13, color: '#1E293B' }}>
            📌 未读 ({totalUnread})
          </Typography.Text>
        </div>
      )}
      {unreadItems.length > 0 && <List size="small" dataSource={unreadItems} renderItem={renderItem} split={false} />}
      {readItems.length > 0 && unreadItems.length > 0 && (
        <Typography.Text
          style={{
            display: 'block',
            fontSize: 11,
            color: '#94A3B8',
            padding: '8px 0 4px',
            borderTop: '1px solid #F0F0F0',
          }}
        >
          已读
        </Typography.Text>
      )}
      {readItems.length > 0 && <List size="small" dataSource={readItems} renderItem={renderItem} split={false} />}
    </div>
  );
};

export { ConversationList };
