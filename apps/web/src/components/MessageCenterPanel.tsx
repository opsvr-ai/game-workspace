import React from 'react';
import { List, Typography, Button, Badge } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { useChatStore } from '../stores/chatStore';

interface Props {
  onOpenChat: (companionId: string, companionName: string) => void;
  onClose: () => void;
}

const MessageCenterPanel: React.FC<Props> = ({ onOpenChat, onClose }) => {
  const { chats, totalUnread, markAllRead, markAllUnreadClean } = useChatStore();

  const items = Object.values(chats)
    .filter((c) => c.messages.length > 0)
    .sort((a, b) => b.lastMessageTime - a.lastMessageTime);

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

  const panelWidth = 340;
  const maxHeight = 480;

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const renderItem = (c: (typeof items)[0]) => (
    <List.Item
      key={c.companionId}
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
        markAllRead(c.companionId);
        onOpenChat(c.companionId, c.companionName);
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
                {(c.companionName || '?')[0].toUpperCase()}
              </span>
            </div>
            {c.unreadCount > 0 && (
              <Badge count={c.unreadCount} size="small" style={{ position: 'absolute', top: -6, right: -6 }} />
            )}
          </div>
        }
        title={<span style={{ fontWeight: c.unreadCount > 0 ? 700 : 500, fontSize: 13 }}>{c.companionName}</span>}
        description={
          <div>
            <Typography.Text style={{ fontSize: 12, color: '#64748B' }} ellipsis>
              {c.lastMessage || ''}
            </Typography.Text>
            <Typography.Text style={{ fontSize: 11, color: '#94A3B8', float: 'right' }}>
              {formatTime(c.lastMessageTime)}
            </Typography.Text>
          </div>
        }
      />
    </List.Item>
  );

  return (
    <div style={{ width: panelWidth, maxHeight, overflowY: 'auto' }}>
      {/* Header with mark-all-read */}
      {totalUnread > 0 && (
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
          <Button
            type="link"
            size="small"
            icon={React.createElement(CheckOutlined)}
            onClick={(e) => {
              e.stopPropagation();
              markAllUnreadClean();
            }}
            style={{ fontSize: 12 }}
          >
            全部已读
          </Button>
        </div>
      )}

      {/* Unread items */}
      {unreadItems.length > 0 && <List size="small" dataSource={unreadItems} renderItem={renderItem} split={false} />}

      {/* Read divider */}
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

      {/* Read items */}
      {readItems.length > 0 && <List size="small" dataSource={readItems} renderItem={renderItem} split={false} />}
    </div>
  );
};

export { MessageCenterPanel };
