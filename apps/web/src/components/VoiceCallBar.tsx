// craftsman-ignore: TS001,TS002
import React from 'react';
import { Button, Slider } from 'antd';
import { PhoneOutlined, SoundOutlined } from '@ant-design/icons';

interface Props {
  peerName?: string;
  duration?: number;
  volume?: number;
  onVolumeChange?: (v: number) => void;
  onHangup: () => void;
}

function formatDuration(seconds?: number) {
  if (!seconds) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function VoiceCallBar({ peerName, duration, volume, onVolumeChange, onHangup }: Props) {
  return (
    <div
      className="scale-in"
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 2000,
        width: 280,
        background: '#1E293B',
        color: '#fff',
        borderRadius: 12,
        padding: '12px 14px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: '#16213E',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <PhoneOutlined style={{ color: '#52C41A', fontSize: 16 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {peerName || '语音通话中'}
          </div>
          <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 1 }}>{formatDuration(duration)}</div>
        </div>
        <Button
          danger
          shape="circle"
          size="middle"
          icon={<PhoneOutlined style={{ transform: 'rotate(135deg)' }} />}
          onClick={onHangup}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <SoundOutlined style={{ color: '#94A3B8', fontSize: 13, flexShrink: 0 }} />
        <Slider
          min={0}
          max={100}
          value={volume || 80}
          onChange={(v) => onVolumeChange?.(v)}
          style={{ margin: 0, flex: 1 }}
        />
      </div>
    </div>
  );
}
