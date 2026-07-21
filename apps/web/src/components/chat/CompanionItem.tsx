// craftsman-ignore: TS001,TS002
import React from 'react';
import { Space, Tag, Typography } from 'antd';
import { companionStatusConfig } from '../../constants';

const { Text } = Typography;

interface CompanionItemProps {
  companion: {
    id: string;
    user?: { username: string; displayName?: string; avatar?: string };
    status: string;
    games?: any[];
  };
  isSelected: boolean;
  unreadCount: number;
  onSelect: () => void;
}

const CompanionItem: React.FC<CompanionItemProps> = ({ companion: c, isSelected, unreadCount, onSelect }) => {
  const hasUnread = unreadCount > 0;
  const u = c.user as any;
  const name = u?.displayName || u?.username || '?';
  const statusConfig = companionStatusConfig[c.status] || { color: 'default', label: c.status };

  return (
    <div
      onClick={onSelect}
      style={{
        padding: '8px 8px',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        borderLeft: isSelected ? '3px solid #2B579A' : '3px solid transparent',
        borderRadius: '0 6px 6px 0',
        transition: 'transform 0.15s ease, background 0.15s ease',
        background: isSelected ? '#3F4248' : 'transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#2B2D31';
        e.currentTarget.style.transform = 'translateX(2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateX(0)';
        if (!isSelected) e.currentTarget.style.background = 'transparent';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <Space size="small">
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {hasUnread && (
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#F23F42',
                  flexShrink: 0,
                  boxShadow: '0 0 4px #F23F42',
                }}
              />
            )}
            <Text strong style={{ color: '#F2F3F5', fontSize: 13 }}>
              {name}
            </Text>
          </span>
        </Space>
        <Tag color={statusConfig.color} style={{ fontSize: 11, padding: '0 6px', lineHeight: '18px' }}>
          {statusConfig.label}
        </Tag>
      </div>
      {c.games && c.games.length > 0 && typeof c.games[0] === 'object' && (
        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {c.games.slice(0, 3).map((g: any, i: number) => (
            <Tag
              key={i}
              style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px', opacity: 0.85, color: '#949BA4' }}
            >
              {g.game} <span style={{ color: '#7C3AED' }}>{g.rank || '?'}</span>
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
};

export default React.memo(CompanionItem);
