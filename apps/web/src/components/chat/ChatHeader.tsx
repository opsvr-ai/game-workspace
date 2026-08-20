// craftsman-ignore: TS001,TS002
import React from 'react';
import { Space, Tag, Typography } from 'antd';
import { PushpinOutlined, PushpinFilled, CloseOutlined, PhoneOutlined } from '@ant-design/icons';
import { useVoiceCallStore } from '../../stores/voiceCallStore';

const { Text } = Typography;

interface ChatHeaderProps {
  name: string;
  role: string;
  userId?: string;
  avatarUrl?: string;
  orderInfo?: string;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClose?: () => void;
  onCallClick?: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  COMPANION: '陪玩',
  CS: '客服',
  ADMIN: '管理员',
  OWNER: '老板',
};

function formatCallDuration(seconds?: number) {
  if (!seconds) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({ name, role, userId, avatarUrl, orderInfo, pinned, onTogglePin, onClose, onCallClick }) => {
  const call = useVoiceCallStore((s) => s.call);
  const inCall = call.status === 'connected' && !!userId && call.peerId === userId;

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', background: '#CBD5E1',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#FFF', fontSize: 14, fontWeight: 700,
            position: 'absolute', top: 0, left: 0,
          }}>
            {name[0]?.toUpperCase()}
          </div>
          {avatarUrl && (
            <img src={avatarUrl} alt="" style={{
              width: 36, height: 36, borderRadius: '50%', objectFit: 'cover',
              position: 'absolute', top: 0, left: 0,
            }} />
          )}
        </div>
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
        {inCall && (
          <span
            style={{
              fontSize: 12,
              color: '#16A34A',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 2,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', display: 'inline-block', animation: 'pulse-glow 1.5s ease-in-out infinite' }} />
            正在语音通话 {formatCallDuration(call.duration)}
          </span>
        )}
      </div>
      </div>
      <Space size={4}>
        {onCallClick && (
          <PhoneOutlined onClick={onCallClick} style={{ cursor: 'pointer', color: '#52c41a', padding: 4, fontSize: 16 }} title="语音通话" />
        )}
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
