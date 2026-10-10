// craftsman-ignore: TS001,TS002
import React, { useEffect, useRef } from 'react';
import { CopyOutlined, UndoOutlined, DeleteOutlined, StarOutlined } from '@ant-design/icons';

import { BG } from '../../styles/tokens';
interface MessageContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onCopy: () => void;
  onReply: () => void;
  onReaction: (emoji: string) => void;
  showCollect?: boolean;
  onCollectEmoji?: () => void;
  /**
   * 删除类操作（只在自己发的消息上出现）。
   * 老板 2026-10-11：陪玩端不留任何直接删除按钮 —— 陪玩这里是「申请删除」（等客服/店长批），
   * 管理端 / 客服还是「撤回」（2 分钟内当场删）。没有可做的删除时传 null。
   */
  deleteAction?: { label: string; onClick: () => void } | null;
}

const MessageContextMenu: React.FC<MessageContextMenuProps> = ({
  x,
  y,
  onClose,
  onCopy,
  onReply,
  onReaction,
  showCollect,
  onCollectEmoji,
  deleteAction,
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
        background: BG.container,
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
      {showCollect && onCollectEmoji && (
        <MenuItem
          icon={<StarOutlined />}
          label="收藏表情"
          onClick={() => {
            onCollectEmoji();
            onClose();
          }}
        />
      )}
      <MenuItem
        icon={<UndoOutlined />}
        label="引用回复"
        onClick={() => {
          onReply();
          onClose();
        }}
      />
      {deleteAction && (
        <MenuItem
          icon={<DeleteOutlined />}
          label={deleteAction.label}
          danger
          onClick={() => {
            deleteAction.onClick();
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
