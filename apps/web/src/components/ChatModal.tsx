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
 * Chat Modal — wraps ChatPanel in an antd Modal for popup use.
 * All pages (companion/CS/AppLayout) use this for consistent Chat 3.0 UI.
 *
 * IMPORTANT: partner.conversationId may be a companion ID or user ID,
 * NOT the real ChatRoom UUID. We use activeConversationId from the
 * store (set by openConversation API call) as the roomId for ChatPanel.
 */
const ChatModal: React.FC<Props> = ({ open, partner, onClose }) => {
  // NEVER call hooks conditionally — one selector always
  const { activeConversationId, conv } = useChatStore((s) => ({
    activeConversationId: s.activeConversationId,
    conv: s.activeConversationId ? s.conversations[s.activeConversationId] : undefined,
  }));

  // Open conversation when modal opens
  useEffect(() => {
    if (!open || !partner) return;
    useChatStore.getState().openConversation(
      partner.conversationId, partner.participant, partner.orderInfo,
    );

    return () => {
      useChatStore.getState().closeConversation();
    };
  }, [open, partner?.conversationId]);

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
        roomId={activeConversationId || undefined}
        participant={partner?.participant || conv?.participant}
        orderInfo={partner?.orderInfo || conv?.orderInfo}
        onClose={onClose}
      />
    </Modal>
  );
};

export default ChatModal;
