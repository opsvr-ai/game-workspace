/**
 * 聊天浮窗系统的「渲染」—— 从 layouts/AppLayout.tsx 原样搬出，样式/结构/文案零变化。
 *
 * 两个挂载点（位置和原来一样，只是包了一层组件）：
 *   - MessageDock：左侧常驻群聊消息栏（Sider，宽度 / 折叠 / 边框全部沿用原值）；
 *   - ChatModalHost：全局聊天弹窗（从铃铛 / 横幅 / 消息面板打开的那个）。
 */
import React from 'react';
import { Layout } from 'antd';
import { BG, BORDER } from '../../styles/tokens';
import LeftMessagePanel from '../LeftMessagePanel';
import ChatModal from '../ChatModal';
import type { ShellChatPartner } from '../../hooks/useShellChat';

const { Sider } = Layout;

interface MessageDockProps {
  /** 消息栏是否收起（状态仍在 AppLayout，顶栏那个消息按钮也要用） */
  collapsed: boolean;
  openGroupChat: (conversationId: string, groupName: string) => void;
  openDirectChat: (conversationId: string, participantName: string) => void;
}

export const MessageDock: React.FC<MessageDockProps> = ({ collapsed, openGroupChat, openDirectChat }) => (
  <Sider
    theme="light"
    width={240}
    collapsedWidth={0}
    collapsible
    collapsed={collapsed}
    trigger={null}
    style={{
      background: BG.container,
      borderRight: `1px solid ${BORDER.base}`,
      height: '100vh',
      position: 'sticky',
      top: 0,
      display: 'flex',
      flexDirection: 'column',
      zIndex: 2,
      overflow: 'hidden',
    }}
  >
    {!collapsed && (
      <LeftMessagePanel onOpenChat={openGroupChat} onOpenDirectChat={openDirectChat} />
    )}
  </Sider>
);

interface ChatModalHostProps {
  partner: ShellChatPartner | null;
  onClose: () => void;
}

export const ChatModalHost: React.FC<ChatModalHostProps> = ({ partner, onClose }) => (
  <ChatModal open={!!partner} partner={partner as any} onClose={onClose} />
);
