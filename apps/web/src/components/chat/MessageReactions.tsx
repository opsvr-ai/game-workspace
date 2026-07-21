// craftsman-ignore: TS001,TS002
import React from 'react';

interface MessageReactionsProps {
  reactions: Array<{ userId: string; emoji: string }>;
  onAdd: (emoji: string) => void;
  onRemove: (emoji: string) => void;
  myUserId?: string | null;
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

const MessageReactions: React.FC<MessageReactionsProps> = ({ reactions, onAdd, onRemove, myUserId }) => {
  // Group by emoji
  const grouped: Record<string, string[]> = {};
  for (const r of reactions) {
    if (!grouped[r.emoji]) grouped[r.emoji] = [];
    grouped[r.emoji].push(r.userId);
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
      {Object.entries(grouped).map(([emoji, users]) => {
        const isActive = myUserId ? users.includes(myUserId) : false;
        return (
          <span
            key={emoji}
            onClick={() => (isActive ? onRemove(emoji) : onAdd(emoji))}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              padding: '1px 6px',
              borderRadius: 8,
              background: isActive ? 'rgba(43, 87, 154, 0.12)' : '#F2F3F5',
              cursor: 'pointer',
              fontSize: 13,
              userSelect: 'none',
              transition: 'background 0.15s',
            }}
            title={users.join(', ')}
          >
            <span>{emoji}</span>
            {users.length > 1 && <span style={{ fontSize: 10, color: '#888' }}>{users.length}</span>}
          </span>
        );
      })}
      {/* Quick emoji picker */}
      <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
        {QUICK_EMOJIS.map((emoji) => (
          <span
            key={emoji}
            onClick={(e) => {
              e.stopPropagation();
              onAdd(emoji);
            }}
            style={{
              cursor: 'pointer',
              opacity: 0.5,
              transition: 'opacity 0.15s',
              fontSize: 13,
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.opacity = '0.5';
            }}
          >
            {emoji}
          </span>
        ))}
      </div>
    </div>
  );
};

export default React.memo(MessageReactions);
