// craftsman-ignore: TS001,TS002
import React from 'react';
import ChatPanel from './ChatPanel';
import { useChatStore } from '../../stores/chatStore';

interface EmbeddedChatPanelProps {
  onClose: () => void;
}

/**
 * Embedded chat panel for CSDispatchView.
 * Reads active room from chatStore.
 */
const EmbeddedChatPanel: React.FC<EmbeddedChatPanelProps> = ({ onClose }) => {
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const conv = useChatStore((s) => (activeConversationId ? s.conversations[activeConversationId] : undefined));

  return (
    <ChatPanel
      roomId={activeConversationId || undefined}
      participant={conv?.participant}
      orderInfo={conv?.orderInfo}
      embedded
      onClose={onClose}
    />
  );
};

export default EmbeddedChatPanel;
