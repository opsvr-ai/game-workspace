// craftsman-ignore: TS001,TS002
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Modal } from 'antd';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
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
