// craftsman-ignore: TS001,TS002
import React from 'react';
import { List, Input, Spin, Typography } from 'antd';
import { useChatStore } from '../../stores/chatStore';
import CompanionItem from './CompanionItem';

const { Text } = Typography;

interface Companion {
  id: string;
  user?: { username: string; displayName?: string; avatar?: string };
  status: string;
  games?: any[];
}

interface CompanionSidebarProps {
  companions: Companion[];
  loading: boolean;
  searchText: string;
  onSearchChange: (v: string) => void;
  selectedId: string | null;
  onSelect: (c: Companion) => void;
}

const CompanionSidebar: React.FC<CompanionSidebarProps> = ({
  companions,
  loading,
  searchText,
  onSearchChange,
  selectedId,
  onSelect,
}) => {
  const conversations = useChatStore((s) => s.conversations);

  const filtered = searchText
    ? companions.filter((c) => {
        const name = c.user?.displayName || c.user?.username || '';
        return name.toLowerCase().includes(searchText.toLowerCase());
      })
    : companions;

  return (
    <div style={{ background: '#1E1F22', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 10px 8px', borderBottom: '1px solid #2B2D31' }}>
        <Text strong style={{ color: '#F2F3F5', fontSize: 14 }}>
          陪玩管理
        </Text>
        <Input
          size="small"
          placeholder="搜索陪玩..."
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          allowClear
          style={{ marginTop: 8, background: '#2B2D31', border: '1px solid #3F4248', color: '#F2F3F5' }}
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 4px' }}>
        {loading && companions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : filtered.length === 0 ? (
          <Text style={{ color: '#949BA4', padding: 12, display: 'block' }}>暂无陪玩</Text>
        ) : (
          <List
            size="small"
            dataSource={filtered}
            renderItem={(c) => (
              <CompanionItem
                key={c.id}
                companion={c}
                isSelected={selectedId === c.id}
                unreadCount={conversations[c.id]?.unreadCount || 0}
                onSelect={() => onSelect(c)}
              />
            )}
          />
        )}
      </div>
    </div>
  );
};

export default CompanionSidebar;
