// craftsman-ignore: TS002
import React, { useState, useRef, useEffect } from 'react';
import { Modal, Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useAuthStore } from '../stores/authStore';
import { useChatStore, type Message } from '../stores/chatStore';
import { chatApi, type ParticipantInfo } from '../api/chat';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';

interface ChatPartner {
  conversationId: string;
  participant: ParticipantInfo;
}

interface Props {
  open: boolean;
  partner: ChatPartner | null;
  onClose: () => void;
}

const ChatModal: React.FC<Props> = ({ open, partner, onClose }) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const user = useAuthStore((s) => s.user);
  const { conversations, activeConversationId } = useChatStore();
  const partnerRef = useRef(partner);
  partnerRef.current = partner;

  // Messages from store for the active conversation
  const conv = activeConversationId ? conversations[activeConversationId] : undefined;
  const messages: Message[] = conv?.messages || [];

  // Time threshold for grouping (3 min)
  const shouldShowDivider = (prev: Message, curr: Message): boolean => {
    return curr.createdAt - prev.createdAt > 3 * 60 * 1000;
  };

  // Auto-scroll on new messages
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages.length]);

  // Open conversation when modal opens
  useEffect(() => {
    if (!open || !partner) return;
    useChatStore.getState().openConversation(partner.conversationId, partner.participant);

    return () => {
      useChatStore.getState().closeConversation();
    };
  }, [open, partner?.conversationId]);

  const handleSend = async (text: string) => {
    if (!activeConversationId) return;
    try {
      const { data } = await chatApi.sendMessage(activeConversationId, text);
      const msg = data?.data?.message;
      if (msg) {
        useChatStore.getState().receiveMessage(activeConversationId, msg);
      }
    } catch {}
  };

  const handleClose = () => {
    useChatStore.getState().closeConversation();
    onClose();
  };

  const participantName = partner?.participant.displayName || partner?.participant.username || '?';
  const myName = user?.displayName || user?.username || '我';

  return (
    <Modal
      open={open}
      footer={null}
      width={480}
      closable={false}
      maskClosable={false}
      keyboard={false}
      style={{ top: 24 }}
      bodyStyle={{
        padding: 0,
        height: '80vh',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {partner && (
        <>
          {/* WeChat-style header */}
          <div
            style={{
              background: '#EDEDED',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexShrink: 0,
              borderBottom: '1px solid #D9D9D9',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: '#07C160',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <span style={{ color: '#FFF', fontSize: 16, fontWeight: 700 }}>{participantName[0].toUpperCase()}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 16, lineHeight: 1.3 }}>{participantName}</div>
            </div>
            <Button
              type="text"
              icon={React.createElement(CloseOutlined)}
              onClick={handleClose}
              style={{ color: '#333', fontSize: 18 }}
            />
          </div>

          {/* Messages */}
          <div
            ref={bodyRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px 16px',
              background: '#F5F6FA',
            }}
          >
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: '#999', marginTop: 60, fontSize: 13 }}>
                <div style={{ fontSize: 48, marginBottom: 8, opacity: 0.6 }}>💬</div>
                发送第一条消息吧
              </div>
            )}
            {messages.map((m, i) => {
              const isMe = m.senderId === user?.id;
              const prev = i > 0 ? messages[i - 1] : null;
              const sameSender = prev && prev.senderId === m.senderId;
              const withinTime = prev && m.createdAt - prev.createdAt <= 2 * 60 * 1000;
              const showAvatar = !sameSender || !withinTime;
              const showDivider = prev && shouldShowDivider(prev, m);

              return (
                <MessageBubble
                  key={m.id}
                  msg={m}
                  isMe={isMe}
                  showAvatar={showAvatar || false}
                  showDivider={showDivider || false}
                  avatarName={isMe ? myName : participantName}
                />
              );
            })}
          </div>

          {/* Input */}
          <ChatInput onSend={handleSend} />
        </>
      )}
    </Modal>
  );
};

export default ChatModal;
