// craftsman-ignore: TS001
import React from 'react';
import { Button } from 'antd';
import { PhoneOutlined, CloseOutlined } from '@ant-design/icons';

import { BG, TEXT } from '../styles/tokens';
interface Props {
  open: boolean;
  callerName?: string;
  calling?: boolean;
  onAccept: () => void;
  onReject: () => void;
  /**
   * floating = 主程序窗口右下角浮着（默认）；
   * inline = 铺在独立聊天窗口里（老板 2026-10-10：「能不能直接在聊天窗口里挂断」）。
   */
  variant?: 'floating' | 'inline';
}

const IncomingCallModal: React.FC<Props> = ({ open, callerName, calling, onAccept, onReject, variant = 'floating' }) => {
  if (!open) return null;
  const inline = variant === 'inline';
  return (
    <div
      className="scale-in"
      style={{
        ...(inline
          ? { position: 'relative', width: '100%', boxSizing: 'border-box' }
          : { position: 'fixed', right: 20, bottom: 20, zIndex: 2000, width: 280 }),
        background: `linear-gradient(135deg,${BG.inverse},#0F172A)`,
        color: TEXT.inverse,
        borderRadius: 12,
        padding: 16,
        boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: '#334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            flexShrink: 0,
            animation: 'pulse-glow 1.5s ease-in-out infinite',
          }}
        >
          📞
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {callerName || '未知'}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 2 }}>
            {calling ? '正在呼叫...' : '邀请你进行语音通话'}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 28, marginTop: 16 }}>
        {calling ? (
          <Button danger shape="circle" size="large" title="挂断" icon={<CloseOutlined />} onClick={onReject} />
        ) : (
          <>
            <Button
              type="primary"
              shape="circle"
              size="large"
              title="接听"
              icon={<PhoneOutlined />}
              onClick={onAccept}
              style={{ background: '#52c41a', borderColor: '#52c41a' }}
            />
            <Button danger shape="circle" size="large" title="拒接" icon={<CloseOutlined />} onClick={onReject} />
          </>
        )}
      </div>
    </div>
  );
};

export default IncomingCallModal;
