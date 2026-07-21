// craftsman-ignore: TS001,TS002
import React, { useEffect, useRef } from 'react';
import { CopyOutlined, UndoOutlined, DeleteOutlined } from '@ant-design/icons';

interface MessageContextMenuProps {
  x: number;
  y: number;
  isMine: boolean;
  canRecall: boolean; // within 2 minutes
  onClose: () => void;
  onCopy: () => void;
  onReply: () => void;
  onRecall: () => void;
  onDelete: () => void;
  onReaction: (emoji: string) => void;
}

const MessageContextMenu: React.FC<MessageContextMenuProps> = ({
  x,
  y,
  isMine,
  canRecall,
  onClose,
  onCopy,
  onReply,
  onRecall,
  onDelete,
  onReaction,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const emojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '💪'];

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: Math.min(x, window.innerWidth - 180),
        top: Math.min(y, window.innerHeight - 250),
        zIndex: 10000,
        background: '#FFF',
        borderRadius: 10,
        boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
        padding: '6px 0',
        minWidth: 160,
        animation: 'contextMenuIn 0.15s ease',
      }}
    >
      <style>{`@keyframes contextMenuIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }`}</style>

      {/* Quick emoji row */}
      <div style={{ display: 'flex', gap: 2, padding: '4px 12px', borderBottom: '1px solid #F0F0F0' }}>
        {emojis.map((e) => (
          <span
            key={e}
            onClick={() => {
              onReaction(e);
              onClose();
            }}
            style={{ cursor: 'pointer', fontSize: 16, padding: 2 }}
          >
            {e}
          </span>
        ))}
      </div>

      <MenuItem
        icon={<CopyOutlined />}
        label="复制文字"
        onClick={() => {
          onCopy();
          onClose();
        }}
      />
      <MenuItem
        icon={<UndoOutlined />}
        label="引用回复"
        onClick={() => {
          onReply();
          onClose();
        }}
      />
      {isMine && canRecall && (
        <MenuItem
          icon={<DeleteOutlined />}
          label="撤回"
          danger
          onClick={() => {
            onRecall();
            onClose();
          }}
        />
      )}
      {isMine && (
        <MenuItem
          icon={<DeleteOutlined />}
          label="删除"
          danger
          onClick={() => {
            onDelete();
            onClose();
          }}
        />
      )}
    </div>
  );
};

const MenuItem: React.FC<{ icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }> = ({
  icon,
  label,
  danger,
  onClick,
}) => (
  <div
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 14px',
      cursor: 'pointer',
      fontSize: 13,
      color: danger ? '#F23F42' : '#313338',
      transition: 'background 0.1s',
    }}
    onMouseEnter={(e) => {
      (e.target as HTMLElement).style.background = '#F2F3F5';
    }}
    onMouseLeave={(e) => {
      (e.target as HTMLElement).style.background = 'transparent';
    }}
  >
    {icon}
    <span>{label}</span>
  </div>
);

export default React.memo(MessageContextMenu);
