// craftsman-ignore: TS001,TS002
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Input, Modal } from 'antd';
import { message } from '../../utils/feedback';
import { useChatStore, type Message } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { chatApi } from '../../api/chat';
import http from '../../api/client';
import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import ChatComposer from './ChatComposer';
import MessageContextMenu from './MessageContextMenu';
import ChatVoiceCallStrip from './ChatVoiceCallStrip';
import { startVoiceCallFromCurrentWindow } from '../../utils/voiceCallWindow';

import { BG, TEXT } from '../../styles/tokens';
interface ChatPanelProps {
  roomId?: string;
  participant?: { userId: string; username: string; displayName?: string; avatar?: string; role: string };
  orderInfo?: string | null;
  embedded?: boolean;
  /** 独立系统窗口里的聊天框（一个联系人一个窗口）——点「查看订单」改为另开窗口，不把本窗口导航走 */
  standalone?: boolean;
  onMinimize?: () => void;
  onClose?: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ roomId, participant, orderInfo, embedded, standalone, onMinimize, onClose }) => {
  const user = useAuthStore((s) => s.user);
  // Use selectors — never subscribe to full store (causes infinite loops)
  const conv = useChatStore((s) => (roomId ? s.conversations[roomId] : undefined));
  const messages = conv?.messages || [];
  const participantName = participant?.displayName || participant?.username || '...';
  const participantAvatar = participant?.avatar ? `/uploads/avatars/${participant.avatar}?v=${participant.avatar}` : undefined;
  const myAvatar = user?.avatar ? `/uploads/avatars/${user.avatar}?v=${user.avatar}` : undefined;
  const isGroupRoom = !!(conv?.isGroup || participant?.role === 'GROUP');
  // 群聊广播：只有客服/店长/老板能发（陪玩只能收）
  const canBroadcast = isGroupRoom && ['CS', 'ADMIN', 'OWNER'].includes(user?.role || '');

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: Message } | null>(null);
  const [, setReplyTarget] = useState<Message | null>(null);
  const [groupMembers, setGroupMembers] = useState<Array<{ userId: string; username: string; displayName?: string; avatar?: string; role: string }>>([]);
  const [mentionRequest, setMentionRequest] = useState<{ nonce: number; name: string } | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  // 陪玩「申请删除」自己发的一条消息（老板 2026-10-11：陪玩端不留直接删除按钮，一律申请 → 客服/店长审批）
  const [deleteRequest, setDeleteRequest] = useState<{ message: Message; reason: string } | null>(null);
  const [deleteRequestSubmitting, setDeleteRequestSubmitting] = useState(false);
  const canRecallMyself = ['CS', 'ADMIN', 'OWNER'].includes(user?.role || '');

  useEffect(() => {
    if (!roomId || !(conv?.isGroup || participant?.role === 'GROUP')) return;
    chatApi
      .getGroupMembers(roomId)
      .then(({ data }) => {
        setGroupMembers(data?.data?.members || []);
      })
      .catch(() => {});
  }, [roomId, conv?.isGroup, participant?.role]);

  const groupMemberMap = useMemo(() => {
    const map: Record<string, { username: string; displayName?: string; avatar?: string; role: string }> = {};
    for (const m of groupMembers) {
      map[m.userId] = m;
    }
    return map;
  }, [groupMembers]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string, mentionUserIds?: string[]) => {
      if (!roomId) return;
      const s = useChatStore.getState();
      const tempId = `temp-${Date.now()}`;
      s.receiveMessage(roomId, {
        id: tempId, senderId: user?.id, text, content: text,
        type: 'TEXT', createdAt: new Date().toISOString(), status: 'pending',
      });

      try {
        const { data } = await chatApi.sendRoomMessage(roomId, {
          type: 'TEXT', content: text, replyToId, mentionUserIds,
        });
        const realMsg = data?.data?.message;
        if (realMsg) {
          // Replace temp optimistic msg with real server msg (ensure text field for display)
          const conv2 = useChatStore.getState().conversations[roomId];
          if (conv2) {
            const msgs = conv2.messages.map((m) =>
              m.id === tempId ? {
                ...realMsg,
                text: realMsg.content || realMsg.text || text,
                status: 'sent' as const,
                createdAt: realMsg.createdAt ? new Date(realMsg.createdAt).getTime() : Date.now(),
              } : m,
            );
            useChatStore.setState((prev) => ({
              conversations: { ...prev.conversations, [roomId]: { ...conv2, messages: msgs } },
            }));
          }
        }
      } catch {
        const conv2 = useChatStore.getState().conversations[roomId];
        if (conv2) {
          const msgs = conv2.messages.map((m) =>
            m.id === tempId ? { ...m, status: 'failed' as const } : m,
          );
          useChatStore.setState((prev) => ({
            conversations: { ...prev.conversations, [roomId]: { ...conv2, messages: msgs } },
          }));
        }
      }
    },
    [roomId, user?.id],
  );

  const handleUpload = useCallback(async (file: File) => {
    try {
      const { data } = await chatApi.uploadFile(file);
      const info = data?.data;
      if (info?.url) {
        const isImage = file.type.startsWith('image/');
        return isImage ? `[img]${info.url}[/img]` : `[${info.fileName}](${info.url})`;
      }
    } catch {}
    return undefined;
  }, []);

  const handleBroadcast = useCallback(async () => {
    const content = broadcastText.trim();
    if (!content) {
      message.warning('先输入要广播的内容');
      return;
    }
    setBroadcasting(true);
    try {
      await chatApi.studioBroadcast(content);
      message.success('广播已发出，在线陪玩电脑上会弹提醒');
      setBroadcastOpen(false);
      setBroadcastText('');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '广播发送失败');
    } finally {
      setBroadcasting(false);
    }
  }, [broadcastText]);

  const handleContextMenu = useCallback((e: React.MouseEvent, msg: Message) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, message: msg });
  }, []);

  const handleMentionSender = useCallback((name: string) => {
    setMentionRequest({ nonce: Date.now(), name });
  }, []);

  const handleReply = useCallback((msg: Message) => {
    setReplyTarget(msg);
    setContextMenu(null);
  }, []);

  const handleRecall = useCallback(async (msg: Message) => {
    if (!roomId) return;
    try { await chatApi.deleteRoomMessage?.(roomId, msg.id); } catch {}
    setContextMenu(null);
  }, [roomId]);

  /** 陪玩申请删掉自己发的一条消息：提交后等客服 / 店长 / 老板通过或驳回，过程留痕。 */
  const submitDeleteRequest = useCallback(async () => {
    if (!roomId || !deleteRequest) return;
    const reason = deleteRequest.reason.trim();
    if (!reason) {
      message.warning('请填写申请删除的原因');
      return;
    }
    setDeleteRequestSubmitting(true);
    try {
      await http.post('/customer-tracking/message-delete-requests', {
        roomId,
        messageId: deleteRequest.message.id,
        reason,
      });
      message.success('申请已提交，等客服 / 店长通过或驳回');
      setDeleteRequest(null);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '提交申请失败');
    } finally {
      setDeleteRequestSubmitting(false);
    }
  }, [roomId, deleteRequest]);

  const handleReaction = useCallback(async (msgId: string, emoji: string) => {
    if (!roomId) return;
    try {
      await chatApi.addReaction?.(roomId, msgId, emoji);
      const s = useChatStore.getState();
      const conv2 = s.conversations[roomId];
      if (conv2) {
        const msgs = conv2.messages.map((m) =>
          m.id === msgId ? { ...m, reactions: [...(m.reactions || []), { userId: user?.id || '', emoji }] } : m,
        );
        useChatStore.setState((prev) => ({
          conversations: { ...prev.conversations, [roomId]: { ...conv2, messages: msgs } },
        }));
      }
    } catch {}
  }, [roomId, user?.id]);

  const handleRemoveReaction = useCallback(async (msgId: string, emoji: string) => {
    if (!roomId) return;
    try { await chatApi.removeReaction?.(roomId, msgId, emoji); } catch {}
  }, [roomId]);

  const extractCollectableUrl = (msg: any): string | undefined => {
    if (msg?.attachments?.length) {
      const img = msg.attachments.find(
        (a: any) => a?.type === 'IMAGE' || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(a?.url || ''),
      );
      if (img) return img.thumbnailUrl || img.url;
    }
    const m = (msg?.text || msg?.content || '').match(/\[img\](.*?)\[\/img\]/);
    return m?.[1];
  };

  const collectEmoji = async (url: string) => {
    try {
      let list: string[] = [];
      try {
        list = JSON.parse(localStorage.getItem('custom-emojis') || '[]');
      } catch {
        list = [];
      }
      if (!Array.isArray(list)) list = [];
      if (!list.includes(url)) list = [...list, url];
      localStorage.setItem('custom-emojis', JSON.stringify(list));
      await http.put('/auth/me/emojis', { emojis: list }).catch(() => {});
      message.success('已收藏到表情');
    } catch {
      message.error('收藏失败');
    }
  };

  const handleLoadMore = useCallback(() => {
    if (!roomId || !conv?.hasMore) return;
    const oldest = conv.messages[0];
    if (!oldest) return;
    // 后端分页游标是消息序号 seq（INT4），以前传的是 createdAt 毫秒时间戳，
    // 后端拿它去查 seq 直接崩（Unhandled exception），表现就是「点了没反应」。
    const cursor = oldest.seq ?? oldest.createdAt;
    if (!cursor) return;
    chatApi.getMessages(roomId, String(cursor))
      .then(({ data }) => {
        const msgs = data?.data?.messages || [];
        if (msgs.length > 0) {
          useChatStore.getState().prependMessages(roomId, msgs, data?.data?.hasMore ?? false);
        }
      }).catch(() => {});
  }, [roomId, conv]);

  if (!roomId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#949BA4', fontSize: 14 }}>
        选择一位陪玩开始聊天
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: BG.container, borderLeft: embedded ? '1px solid #E8E9EB' : undefined }}>
      <ChatHeader
        name={participantName}
        role={participant?.role || ''}
        userId={participant?.userId}
        avatarUrl={participantAvatar}
        // 「这一单」以会话里记着的为准：服务端一改就实时推过来，两边看到的是同一单。
        // props 只在本地还没有这个会话时兜底（正常流程下 store 里已经有值）。
        orderInfo={conv ? conv.orderInfo : orderInfo}
        pinned={conv?.pinned}
        standalone={standalone}
        onMinimize={onMinimize}
        onClose={onClose}
        // 语音：主程序窗口自己打；独立聊天窗口没有语音能力（一个账号只能有一处接听，见
        // utils/voiceCallWindow.ts），改成请主程序窗口去打 —— 以前这里直接 dispatch 一个
        // 只有主程序窗口才监听的 CustomEvent，在聊天窗口里点等于石沉大海（老板 2026-10-10 报的）。
        onCallClick={participant?.userId ? () => {
          startVoiceCallFromCurrentWindow(participant.userId, participantName);
        } : undefined}
        onTogglePin={() => {
          if (!roomId) return;
          const next = !conv?.pinned;
          // 先本地立刻生效（大头针变金色），再存服务端；失败回滚并提示
          // （老板 2026-10-05：以前点了没反应 —— 服务端存了、界面一点没变）。
          useChatStore.getState().setPinned(roomId, next);
          chatApi
            .updateRoom(roomId, { pinned: next })
            .then(() => message.success(next ? '已置顶 · 消息列表里排最上面' : '已取消置顶'))
            .catch(() => {
              useChatStore.getState().setPinned(roomId, !next);
              message.error('置顶失败，请重试');
            });
        }}
        onBroadcast={canBroadcast ? () => setBroadcastOpen(true) : undefined}
      />
      <MessageList
        conversationId={roomId}
        unreadFromSeq={conv?.openedReadSeq}
        messages={messages}
        myUserId={user?.id || null}
        participantName={participantName}
        participantAvatarUrl={participantAvatar}
        groupMemberMap={conv?.isGroup || participant?.role === 'GROUP' ? groupMemberMap : undefined}
        myAvatarUrl={myAvatar}
        typing={false}
        hasMore={conv?.hasMore ?? false}
        onLoadMore={handleLoadMore}
        onReply={handleReply}
        onRecall={handleRecall}
        onReaction={handleReaction}
        onRemoveReaction={handleRemoveReaction}
        onContextMenu={handleContextMenu}
        onMentionSender={handleMentionSender}
        peerReadSeq={conv?.peerReadSeq}
        isGroup={conv?.isGroup || participant?.role === 'GROUP'}
      />
      {/* 独立聊天窗口：通话条 / 来电卡片铺在输入框上面 —— 在这个窗口就能挂断、拖音量，
          不用切回主程序（老板 2026-10-10）。主程序窗口里 standalone 是 undefined，
          那边照旧用右下角的浮条，不会重复（见 utils/voiceCallWindow.ts）。 */}
      {standalone && <ChatVoiceCallStrip peerId={participant?.userId} />}
      <ChatComposer
        // 换会话就重挂：草稿按会话分开存、分开读（老板 2026-10-08 的「输入别丢」）
        key={roomId || 'composer'}
        draftKey={roomId ? `chat:${roomId}` : null}
        onSend={handleSend}
        onUpload={handleUpload}
        groupMembers={groupMembers}
        mentionRequest={mentionRequest}
      />
      <Modal
        title="📢 群聊广播"
        open={broadcastOpen}
        onCancel={() => setBroadcastOpen(false)}
        onOk={handleBroadcast}
        okText="发送广播"
        cancelText="取消"
        confirmLoading={broadcasting}
        width={460}
      >
        <div style={{ fontSize: 12, color: '#949BA4', marginBottom: 8, lineHeight: 1.8 }}>
          广播会发进本工作室群聊，并立刻弹到每个<b>在线陪玩</b>电脑的右下角（5 秒后自动消失）。
          「某单接不接」「催上号」这类必须让人看到的消息，用广播最稳。
        </div>
        <Input.TextArea
          value={broadcastText}
          onChange={(e) => setBroadcastText(e.target.value)}
          rows={3}
          maxLength={200}
          showCount
          placeholder="例如：还有一单三角洲机密单，谁接？接的话在群里回 1"
        />
      </Modal>
      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x} y={contextMenu.y}
          deleteAction={
            contextMenu.message.senderId !== user?.id
              ? null
              : canRecallMyself
                ? Date.now() - contextMenu.message.createdAt < 2 * 60 * 1000
                  ? { label: '撤回', onClick: () => handleRecall(contextMenu.message) }
                  : null
                : { label: '申请删除', onClick: () => setDeleteRequest({ message: contextMenu.message, reason: '' }) }
          }
          showCollect={!!extractCollectableUrl(contextMenu.message)}
          onCollectEmoji={() => {
            const url = extractCollectableUrl(contextMenu.message);
            if (url) collectEmoji(url);
          }}
          onClose={() => setContextMenu(null)}
          onCopy={() => navigator.clipboard.writeText(contextMenu.message.text)}
          onReply={() => handleReply(contextMenu.message)}
          onReaction={(emoji) => handleReaction(contextMenu.message.id, emoji)}
        />
      )}
      <Modal
        title="申请删除这条消息"
        open={!!deleteRequest}
        onOk={submitDeleteRequest}
        onCancel={() => setDeleteRequest(null)}
        okText="提交申请"
        cancelText="取消"
        confirmLoading={deleteRequestSubmitting}
        destroyOnClose
      >
        <div style={{ marginTop: 8 }}>
          <div style={{ color: TEXT.tertiary, fontSize: 12 }}>要申请删除的内容</div>
          <div style={{ marginTop: 6, padding: 10, background: BG.hover, borderRadius: 8 }}>
            {deleteRequest?.message.text || '（图片 / 文件）'}
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ marginBottom: 6 }}>申请原因（必填）</div>
          <Input.TextArea
            rows={3}
            value={deleteRequest?.reason || ''}
            onChange={(e) => setDeleteRequest((prev) => (prev ? { ...prev, reason: e.target.value } : prev))}
            placeholder="例如：发错了 / 内容有误 / 泄露了房间码"
          />
        </div>
        <div style={{ marginTop: 10, color: TEXT.tertiary, fontSize: 12 }}>
          提交后由客服 / 店长 / 老板审核：通过才会删掉，驳回会通知你，全过程留痕。
        </div>
      </Modal>
    </div>
  );
};

export default ChatPanel;
