// craftsman-ignore: TS001,TS002
import React from 'react';
import { Button, Typography } from 'antd';
import { PhoneOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface Props {
  peerName?: string;
  duration?: number;
  onHangup: () => void;
}

function formatDuration(seconds?: number) {
  if (!seconds) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function VoiceCallBar({ peerName, duration, onHangup }: Props) {
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000,
      background: '#1a1a2e', color: '#fff', padding: '12px 24px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', background: '#16213e',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'pulse 1.5s infinite',
        }}>
          <PhoneOutlined style={{ color: '#52c41a', fontSize: 18 }} />
        </div>
        <div>
          <Text style={{ color: '#fff', fontSize: 14, display: 'block' }}>{peerName || '语音通话中'}</Text>
          <Text style={{ color: '#aaa', fontSize: 12 }}>{formatDuration(duration)}</Text>
        </div>
      </div>
      <Button danger shape="circle" icon={<PhoneOutlined style={{ transform: 'rotate(135deg)' }} />} onClick={onHangup} size="large" />
    </div>
  );
}
