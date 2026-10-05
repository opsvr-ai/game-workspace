// craftsman-ignore: TS001,TS002
import React, { useEffect, useMemo, useState } from 'react';
import { Typography } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import { useChatStore } from '../stores/chatStore';
import { chatApi } from '../api/chat';

const { Text } = Typography;

interface Props {
  onOpenChat: (conversationId: string, groupName: string) => void;
  /** 私聊：点左侧列表里某个人，打开和他的聊天（老板 2026-09-30 从铃铛挪过来的入口） */
  onOpenDirectChat?: (conversationId: string, participantName: string) => void;
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

interface RowProps {
  name: string;
  lastMessage: string;
  lastMessageAt: number;
  unread: number;
  avatar: React.ReactNode;
  highlighted: boolean;
  pinned?: boolean;
  onClick: () => void;
}

const Row: React.FC<RowProps> = ({ name, lastMessage, lastMessageAt, unread, avatar, highlighted, pinned, onClick }) => (
  <div
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 10px',
      borderRadius: 10,
      cursor: 'pointer',
      transition: 'background 0.15s',
      background: highlighted ? '#EFF6FF' : 'transparent',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = highlighted ? '#EFF6FF' : '#F8FAFC';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = highlighted ? '#EFF6FF' : 'transparent';
    }}
  >
    {avatar}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1 }}>
          {pinned && (
            <span title="已置顶" style={{ fontSize: 11, flexShrink: 0 }}>📌</span>
          )}
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
            {name}
          </Text>
        </span>
        <Text style={{ fontSize: 11, color: '#94A3B8', flexShrink: 0 }}>{formatTime(lastMessageAt)}</Text>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
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

const groupAvatar = (
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
);

/**
 * 左侧常驻消息面板。
 * 私聊 + 工作室群聊，模仿微信的消息列表：头像、名字、最新消息预览、时间和未读角标。
 *
 * 老板 2026-09-30：「铃铛那里去除聊天的信息」—— 私聊列表从右上角铃铛搬到这儿，
 * 铃铛改成只放通知（新订单 / 催单 / 审核 ……），聊天该有的未读提示一个都没少。
 */
const LeftMessagePanel: React.FC<Props> = ({ onOpenChat, onOpenDirectChat }) => {
  const conversations = useChatStore((s) => s.conversations);
  const conversationOrder = useChatStore((s) => s.conversationOrder);
  const markRead = useChatStore((s) => s.markRead);
  const [fallbackGroup, setFallbackGroup] = useState<{ id: string; groupName: string } | null>(null);

  const all = useMemo(
    () => conversationOrder.map((id) => conversations[id]).filter(Boolean),
    [conversations, conversationOrder],
  );

  const groups = useMemo(
    () => all.filter((c) => c.isGroup || c.participant?.role === 'GROUP'),
    [all],
  );

  // 私聊：只列有来有往的会话，空壳房间不占地方；**手动置顶的排最上面**，其次有未读的置顶，
  // 其余最近的排前面（老板 2026-10-05）。
  const directs = useMemo(
    () =>
      all
        .filter((c) => !(c.isGroup || c.participant?.role === 'GROUP'))
        .filter((c) => (c.lastMessageAt || 0) > 0 || (c.messages?.length || 0) > 0)
        .sort((a, b) => {
          const aPin = a.pinned ? 1 : 0;
          const bPin = b.pinned ? 1 : 0;
          if (aPin !== bPin) return bPin - aPin;
          const aUnread = (a.unreadCount || 0) > 0 ? 1 : 0;
          const bUnread = (b.unreadCount || 0) > 0 ? 1 : 0;
          if (aUnread !== bUnread) return bUnread - aUnread;
          return (b.lastMessageAt || 0) - (a.lastMessageAt || 0);
        }),
    [all],
  );

  const unreadTotal =
    groups.reduce((sum, c) => sum + (c.unreadCount || 0), 0) +
    directs.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

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

  // 如果 store 里还没有会话（例如会话列表请求失败），再补一次列表请求。
  useEffect(() => {
    if (all.length > 0) return;
    chatApi
      .listConversations()
      .then(({ data }) => {
        const list = data?.data?.conversations || [];
        if (list.length > 0) {
          useChatStore.getState().setConversations(list);
        }
      })
      .catch(() => {});
  }, [all.length]);

  const displayGroups = groups.length > 0 ? groups : fallbackGroup ? [fallbackGroup] : [];

  // 置顶的会话（私聊、群聊都算）统一浮到整个列表最上面（老板 2026-10-05：
  // 聊天窗口那个大头针要真的把会话钉到消息列表顶部）。
  const pinnedItems = useMemo(
    () =>
      all
        .filter((c) => c.pinned)
        .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)),
    [all],
  );
  const isPinnedGroupRow = (g: any) => {
    const storeGroup = groups.find((item) => item.id === g.id);
    return !!(storeGroup?.pinned || (g as any).pinned);
  };

  // 「置顶」分区里私聊 / 群聊混着排，所以单独一套行渲染（头像 / 名字 / 点击行为按类型走）。
  const renderConvRow = (c: any) => {
    const isGroupConv = !!(c.isGroup || c.participant?.role === 'GROUP');
    const name = isGroupConv
      ? c.groupName || c.participant?.displayName || c.participant?.username || '工作室群聊'
      : c.participant?.displayName || c.participant?.username || '未知';
    const unread = c.unreadCount || 0;
    return (
      <Row
        key={c.id}
        name={name}
        lastMessage={c.lastMessage || ''}
        lastMessageAt={c.lastMessageAt || 0}
        unread={unread}
        highlighted={unread > 0}
        pinned={!!c.pinned}
        avatar={
          isGroupConv ? (
            groupAvatar
          ) : (
            <div
              style={{
                width: 40,
                height: 40,
                flexShrink: 0,
                borderRadius: '50%',
                background: unread > 0 ? 'linear-gradient(135deg, #7C4DFF, #5B7CFA)' : '#CBD5E1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              {String(name)[0].toUpperCase()}
            </div>
          )
        }
        onClick={() => {
          markRead(c.id);
          if (isGroupConv) onOpenChat(c.id, name);
          else if (onOpenDirectChat) onOpenDirectChat(c.id, name);
          else onOpenChat(c.id, name);
        }}
      />
    );
  };

  const sectionTitle = (label: string) => (
    <div style={{ padding: '10px 10px 4px', fontSize: 11, color: '#94A3B8' }}>{label}</div>
  );

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
        {unreadTotal > 0 && (
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
            {unreadTotal > 99 ? '99+' : unreadTotal}
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {directs.length === 0 && displayGroups.length === 0 && pinnedItems.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>暂无消息</div>
        ) : (
          <>
            {pinnedItems.length > 0 && sectionTitle('置顶')}
            {pinnedItems.map(renderConvRow)}

            {directs.some((c: any) => !c.pinned) && sectionTitle('私聊')}
            {directs.filter((c: any) => !c.pinned).map((c: any) => {
              const name = c.participant?.displayName || c.participant?.username || '未知';
              return (
                <Row
                  key={c.id}
                  name={name}
                  lastMessage={c.lastMessage || ''}
                  lastMessageAt={c.lastMessageAt || 0}
                  unread={c.unreadCount || 0}
                  highlighted={(c.unreadCount || 0) > 0}
                  pinned={!!c.pinned}
                  avatar={
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        flexShrink: 0,
                        borderRadius: '50%',
                        background: (c.unreadCount || 0) > 0 ? 'linear-gradient(135deg, #7C4DFF, #5B7CFA)' : '#CBD5E1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#FFFFFF',
                        fontSize: 16,
                        fontWeight: 700,
                      }}
                    >
                      {String(name)[0].toUpperCase()}
                    </div>
                  }
                  onClick={() => {
                    markRead(c.id);
                    if (onOpenDirectChat) onOpenDirectChat(c.id, name);
                    else onOpenChat(c.id, name);
                  }}
                />
              );
            })}

            {displayGroups.some((g: any) => !isPinnedGroupRow(g)) && sectionTitle('群聊')}
            {displayGroups.filter((g: any) => !isPinnedGroupRow(g)).map((g: any) => {
              const storeGroup = groups.find((item) => item.id === g.id);
              const groupName =
                storeGroup?.groupName ||
                storeGroup?.participant?.displayName ||
                storeGroup?.participant?.username ||
                g.groupName ||
                '蠢驴电竞群聊';
              return (
                <Row
                  key={g.id}
                  name={groupName}
                  lastMessage={storeGroup?.lastMessage || ''}
                  lastMessageAt={storeGroup?.lastMessageAt || 0}
                  unread={storeGroup?.unreadCount || 0}
                  highlighted={(storeGroup?.unreadCount || 0) > 0}
                  avatar={groupAvatar}
                  onClick={() => {
                    if (storeGroup) markRead(g.id);
                    onOpenChat(g.id, groupName);
                  }}
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
};

export default LeftMessagePanel;
