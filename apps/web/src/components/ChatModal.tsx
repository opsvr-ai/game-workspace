// craftsman-ignore: TS001,TS002
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Modal } from 'antd';
import { useChatStore } from '../stores/chatStore';
import ChatPanel from './chat/ChatPanel';

interface ChatPartner {
  conversationId: string;
  participant: { userId: string; username: string; displayName?: string; avatar?: string; role: string };
  orderInfo?: string;
}

interface Props {
  open: boolean;
  partner: ChatPartner | null;
  onClose: () => void;
}

const ChatModal: React.FC<Props> = ({ open, partner, onClose }) => {
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const conv = useChatStore((s) => (activeConversationId ? s.conversations[activeConversationId] : undefined));

  // JS-based resize state
  const [size, setSize] = useState({ w: 420, h: 500 });
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
      // Prevent the subsequent click from closing the modal
      setTimeout(() => { wasResizing.current = false; }, 100);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [size]);

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
      maskClosable
      onCancel={handleCancel}
      bodyStyle={{ padding: 0 }}
      style={{ top: 20 }}
      destroyOnClose
    >
      <div style={{ height: size.h, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <ChatPanel
          roomId={activeConversationId || undefined}
          participant={partner?.participant || conv?.participant}
          orderInfo={partner?.orderInfo || conv?.orderInfo}
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
