// craftsman-ignore: TS001,TS002
import React, { useEffect } from 'react';
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

/**
 * Chat Modal — wraps ChatPanel in an antd Modal for non-embedded use.
 * Used by notification bell, FloatingChatWidget, companion pages.
 */
const ChatModal: React.FC<Props> = ({ open, partner, onClose }) => {
  // Open conversation when modal opens
  useEffect(() => {
    if (!open || !partner) return;
    const store = useChatStore.getState();
    store.openConversation(partner.conversationId, partner.participant, partner.orderInfo);

    return () => {
      useChatStore.getState().closeConversation();
    };
  }, [open, partner?.conversationId]);

  const conv = partner?.conversationId
    ? useChatStore((s) => s.conversations[partner.conversationId])
    : undefined;

  return (
    <Modal
      open={open}
      footer={null}
      width={520}
      closable={false}
      maskClosable
      onCancel={onClose}
      bodyStyle={{ padding: 0, height: '75vh', display: 'flex', flexDirection: 'column' }}
      destroyOnClose
    >
      <ChatPanel
        roomId={partner?.conversationId}
        participant={partner?.participant}
        orderInfo={partner?.orderInfo || conv?.orderInfo}
        onClose={onClose}
      />
    </Modal>
  );
};

export default ChatModal;
