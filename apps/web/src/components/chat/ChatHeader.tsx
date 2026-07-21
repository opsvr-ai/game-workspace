// craftsman-ignore: TS001,TS002
import React from 'react';
import { Space, Tag, Typography } from 'antd';
import { PushpinOutlined, PushpinFilled, CloseOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface ChatHeaderProps {
  name: string;
  role: string;
  orderInfo?: string;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClose?: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  COMPANION: '陪玩',
  CS: '客服',
  ADMIN: '管理员',
  OWNER: '老板',
};

const ChatHeader: React.FC<ChatHeaderProps> = ({ name, role, orderInfo, pinned, onTogglePin, onClose }) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid #E8E9EB',
        background: '#FFF',
        minHeight: 56,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Space size={8}>
          <Text strong style={{ fontSize: 15, color: '#313338' }}>
            {name}
          </Text>
          <Tag style={{ fontSize: 11, padding: '0 6px', lineHeight: '18px' }}>{ROLE_LABELS[role] || role}</Tag>
        </Space>
        {orderInfo && (
          <Text type="secondary" style={{ fontSize: 12, marginTop: 1 }}>
            {orderInfo}
          </Text>
        )}
      </div>
      <Space size={4}>
        {onTogglePin && (
          <span onClick={onTogglePin} style={{ cursor: 'pointer', padding: 4, color: pinned ? '#F0B232' : '#949BA4' }}>
            {pinned ? <PushpinFilled /> : <PushpinOutlined />}
          </span>
        )}
        {onClose && (
          <CloseOutlined onClick={onClose} style={{ cursor: 'pointer', color: '#949BA4', padding: 4, fontSize: 14 }} />
        )}
      </Space>
    </div>
  );
};

export default React.memo(ChatHeader);
