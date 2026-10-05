// craftsman-ignore: TS001,TS002
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Modal } from 'antd';
import { ExpandOutlined, CloseOutlined } from '@ant-design/icons';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { chatApi } from '../api/chat';
import ChatPanel from './chat/ChatPanel';

interface ChatPartner {
  conversationId: string;
  participant: { userId: string; username: string; displayName?: string; avatar?: string; role: string };
  orderInfo?: string | null;
}

interface Props {
  open: boolean;
  partner: ChatPartner | null;
  onClose: () => void;
}

const ChatModal: React.FC<Props> = ({ open, partner, onClose }) => {
  const userId = useAuthStore((s) => s.user?.id || 'anonymous');
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const conv = useChatStore((s) => (activeConversationId ? s.conversations[activeConversationId] : undefined));
  // 最小化：整个窗口收成右下角一条小窗，再点一下还原。窗口在最小化时不算「人正在看」，
  // 新消息照常计未读、照常响、不自动标已读（见 chatStore / ChatProvider）。
  const minimized = useChatStore((s) => s.activeConversationMinimized);
  const setMinimized = useChatStore((s) => s.setActiveConversationMinimized);
  const sizeStorageKey = `chat-modal-size:${userId}`;

  // JS-based resize state — restore saved size
  const [size, setSize] = useState(() => {
    try {
      const saved = localStorage.getItem(sizeStorageKey);
      if (saved) {
        const s = JSON.parse(saved);
        return { w: s.w || 420, h: Math.min(s.h || 500, window.innerHeight - 100) };
      }
    } catch {}
    return { w: 420, h: Math.min(500, window.innerHeight - 100) };
  });
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number; dir: string } | null>(null);
  const wasResizing = useRef(false);

  const onResizeStart = useCallback((e: React.MouseEvent, dir: string) => {
    e.preventDefault();
    e.stopPropagation();
    wasResizing.current = false;
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: size.w, startH: size.h, dir };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      wasResizing.current = true;
      const dx = ev.clientX - resizeRef.current.startX;
      const dy = ev.clientY - resizeRef.current.startY;
      setSize(() => ({
        w: Math.min(700, Math.max(320, resizeRef.current!.startW + (resizeRef.current!.dir.includes('e') ? dx : 0))),
        h: Math.min(window.innerHeight - 60, Math.max(300, resizeRef.current!.startH + (resizeRef.current!.dir.includes('s') ? dy : 0))),
      }));
    };
    const onUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Persist size
      setSize((current: { w: number; h: number }) => { localStorage.setItem(sizeStorageKey, JSON.stringify(current)); return current; });
      setTimeout(() => { wasResizing.current = false; }, 100);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [size, sizeStorageKey]);

  // Block modal close if we just finished resizing
  const handleCancel = useCallback(() => {
    if (wasResizing.current) return;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open || !partner) return;
    useChatStore.getState().openConversation(partner.conversationId, partner.participant, partner.orderInfo);
    return () => { useChatStore.getState().closeConversation(); };
  }, [open, partner?.conversationId]);

  // 窗口展开着 = 人正在看：把当前会话标已读（尤其是从「最小化」还原回来那一下，
  // 最小化期间攒的新消息要在这里清掉未读）。
  useEffect(() => {
    if (!open || minimized) return;
    const id = useChatStore.getState().activeConversationId;
    if (!id) return;
    chatApi.markRead(id).catch(() => {});
    useChatStore.getState().markRead(id);
  }, [open, minimized]);

  // 最小化：收起成一个贴在右下角的小条，点一下还原，旁边可直接关闭。
  if (open && partner && minimized) {
    const p = partner.participant || conv?.participant;
    const name = p?.displayName || p?.username || '聊天';
    const avatarUrl = p?.avatar ? `/uploads/avatars/${p.avatar}?v=${p.avatar}` : '';
    const initial = name.slice(0, 1).toUpperCase();
    const unread = conv?.unreadCount || 0;
    const stop = (e: React.MouseEvent) => e.stopPropagation();
    return (
      <div
        onClick={() => setMinimized(false)}
        title="点击还原聊天窗口"
        style={{
          position: 'fixed',
          right: 20,
          bottom: 20,
          zIndex: 1100,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#FFF',
          border: '1px solid #E8E9EB',
          borderRadius: 10,
          boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
          padding: '8px 10px',
          cursor: 'pointer',
          width: 240,
        }}
      >
        <div style={{ position: 'relative', width: 28, height: 28, flexShrink: 0 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', background: '#2563EB',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#FFF', fontSize: 13, fontWeight: 700,
          }}>
            {initial}
          </div>
          {avatarUrl && (
            <img src={avatarUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#313338', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
          </div>
          <div style={{ fontSize: 11, color: unread > 0 ? '#EF4444' : '#949BA4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {unread > 0 ? `${unread} 条新消息 · 点这里查看` : '已最小化 · 点这里还原'}
          </div>
        </div>
        <ExpandOutlined
          onClick={(e) => { stop(e); setMinimized(false); }}
          title="还原"
          style={{ color: '#949BA4', padding: 4, fontSize: 13, flexShrink: 0 }}
        />
        <CloseOutlined
          onClick={(e) => { stop(e); onClose(); }}
          title="关闭"
          style={{ color: '#949BA4', padding: 4, fontSize: 13, flexShrink: 0 }}
        />
      </div>
    );
  }

  return (
    <Modal
      open={open}
      footer={null}
      width={size.w}
      closable={false}
      mask={false}
      maskClosable={false}
      wrapClassName="chat-modal-floating"
      onCancel={handleCancel}
      bodyStyle={{ padding: 0 }}
      style={{ top: 20 }}
      destroyOnClose
    >
      <div style={{ height: size.h, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <ChatPanel
          roomId={activeConversationId || undefined}
          participant={partner?.participant || conv?.participant}
          orderInfo={partner?.orderInfo}
          onMinimize={() => setMinimized(true)}
          onClose={onClose}
        />
        {/* Resize handle — bottom-right corner */}
        <div
          onMouseDown={(e) => onResizeStart(e, 'se')}
          style={{
            position: 'absolute', bottom: 0, right: 0,
            width: 16, height: 16, cursor: 'nwse-resize',
            background: 'linear-gradient(135deg, transparent 50%, #D0D5DD 50%)',
            opacity: 0.5,
          }}
        />
      </div>
    </Modal>
  );
};

export default ChatModal;
