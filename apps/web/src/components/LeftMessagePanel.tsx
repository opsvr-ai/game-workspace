// craftsman-ignore: TS001,TS002
import React, { useEffect, useMemo, useState } from 'react';
import { Typography } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import { useChatStore } from '../stores/chatStore';
import { chatApi } from '../api/chat';

const { Text } = Typography;

interface Props {
  onOpenChat: (conversationId: string, groupName: string) => void;
}

const formatTime = (ts?: number): string => {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/**
 * 左侧常驻群聊消息面板。
 * 只展示工作室群聊，模仿微信的消息列表：头像、群名、最新消息预览、时间和未读角标。
 */
const LeftMessagePanel: React.FC<Props> = ({ onOpenChat }) => {
  const conversations = useChatStore((s) => s.conversations);
  const conversationOrder = useChatStore((s) => s.conversationOrder);
  const markRead = useChatStore((s) => s.markRead);
  const [fallbackGroup, setFallbackGroup] = useState<{ id: string; groupName: string } | null>(null);

  const groups = useMemo(
    () =>
      conversationOrder
        .map((id) => conversations[id])
        .filter(Boolean)
        .filter((c) => c.isGroup || c.participant?.role === 'GROUP'),
    [conversations, conversationOrder],
  );

  const groupUnread = groups.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  // 确保左侧始终有群聊入口，即使服务端会话列表暂时还没返回。
  useEffect(() => {
    chatApi
      .getStudioGroup()
      .then(({ data }) => {
        const group = data?.data;
        if (group?.id) {
          setFallbackGroup({
            id: group.id,
            groupName: group.groupName || '蠢驴电竞群聊',
          });
        }
      })
      .catch(() => {});
  }, []);

  // 如果 store 里还没有群聊（例如会话列表请求失败），再补一次列表请求。
  useEffect(() => {
    if (groups.length > 0) return;
    chatApi
      .listConversations()
      .then(({ data }) => {
        const list = data?.data?.conversations || [];
        if (list.length > 0) {
          useChatStore.getState().setConversations(list);
        }
      })
      .catch(() => {});
  }, [groups.length]);

  const displayGroups =
    groups.length > 0
      ? groups
      : fallbackGroup
        ? [fallbackGroup]
        : [];

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#FFFFFF',
      }}
    >
      <div
        style={{
          padding: '16px 14px 10px',
          borderBottom: '1px solid #F0F0F0',
          flexShrink: 0,
        }}
      >
        <Text strong style={{ fontSize: 15, color: '#1E293B' }}>
          消息
        </Text>
        {groupUnread > 0 && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 20,
              height: 20,
              marginLeft: 8,
              padding: '0 6px',
              borderRadius: 10,
              background: '#F5222D',
              color: '#FFFFFF',
              fontSize: 12,
              lineHeight: '20px',
            }}
          >
            {groupUnread > 99 ? '99+' : groupUnread}
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {displayGroups.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
            暂无群聊
          </div>
        ) : (
          displayGroups.map((g: any) => {
            const storeGroup = groups.find((item) => item.id === g.id);
            const unread = storeGroup?.unreadCount || 0;
            const lastMessage = storeGroup?.lastMessage || '';
            const lastMessageAt = storeGroup?.lastMessageAt || 0;
            const groupName =
              storeGroup?.groupName ||
              storeGroup?.participant?.displayName ||
              storeGroup?.participant?.username ||
              g.groupName ||
              '蠢驴电竞群聊';

            return (
              <div
                key={g.id}
                onClick={() => {
                  if (storeGroup) markRead(g.id);
                  onOpenChat(g.id, groupName);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 10px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  background: unread > 0 ? '#EFF6FF' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = unread > 0 ? '#EFF6FF' : '#F8FAFC';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = unread > 0 ? '#EFF6FF' : 'transparent';
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    flexShrink: 0,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #7C4DFF, #5B7CFA)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FFFFFF',
                    fontSize: 18,
                  }}
                >
                  <TeamOutlined />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Text
                      strong
                      style={{
                        fontSize: 13,
                        color: '#1E293B',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {groupName}
                    </Text>
                    <Text style={{ fontSize: 11, color: '#94A3B8', flexShrink: 0 }}>
                      {formatTime(lastMessageAt)}
                    </Text>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: 3,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: unread > 0 ? '#475569' : '#94A3B8',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {lastMessage || '暂无消息'}
                    </Text>
                    {unread > 0 && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: 18,
                          height: 18,
                          padding: '0 5px',
                          marginLeft: 8,
                          borderRadius: 9,
                          background: '#F5222D',
                          color: '#FFFFFF',
                          fontSize: 11,
                          lineHeight: '18px',
                          flexShrink: 0,
                        }}
                      >
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default LeftMessagePanel;
