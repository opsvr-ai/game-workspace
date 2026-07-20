// craftsman-ignore: TS001,TS002
import React, { memo, useState, useRef, useEffect } from 'react';
import { Modal, Input, Button, message } from 'antd';
import { CloseOutlined, SendOutlined, SmileOutlined, PaperClipOutlined } from '@ant-design/icons';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';

interface ChatMsg {
  text: string;
  time: string;
  from: string;
  error?: boolean;
}
interface ChatPartner {
  companionId: string;
  companionName: string;
  avatar?: string;
}

interface Props {
  open: boolean;
  partner: ChatPartner | null;
  onClose: () => void;
}

const ChatModal: React.FC<Props> = ({ open, partner, onClose }) => {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [customEmojis, setCustomEmojis] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('custom-emojis') || '[]');
    } catch {
      return [];
    }
  });
  const [addEmojiUrl, setAddEmojiUrl] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const user = useAuthStore((s) => s.user);
  const partnerRef = useRef(partner);
  partnerRef.current = partner;

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  const syncCustomEmojis = (next: string[]) => {
    setCustomEmojis(next);
    localStorage.setItem('custom-emojis', JSON.stringify(next));
    http.put('/auth/me/emojis', { emojis: next }).catch(() => {});
  };

  useEffect(() => {
    http
      .get('/auth/me/emojis')
      .then(({ data }) => {
        const serverEmojis = data?.data;
        if (Array.isArray(serverEmojis) && serverEmojis.length > 0) {
          setCustomEmojis(serverEmojis);
          localStorage.setItem('custom-emojis', JSON.stringify(serverEmojis));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open || !partner?.companionId) return;
    const store = useChatStore.getState();
    store.openChat(partner.companionId);

    // Load messages from store
    const chat = store.chats[partner.companionId];
    const storedMsgs =
      chat?.messages.map((m) => ({
        text: m.text,
        time: formatTime(m.timestamp),
        from: m.senderId === user?.id ? 'me' : 'them',
      })) ?? [];
    setMsgs(storedMsgs as any);

    // Fetch full history from server
    http
      .get(`/companions/chat-history/${partner.companionId}`)
      .then(({ data }) => {
        const serverMsgs: any[] = data?.data?.messages ?? [];
        if (serverMsgs.length > 0) {
          store.loadHistory(
            partner.companionId,
            partner.companionName,
            serverMsgs.map((m: any) => ({
              id: m.id,
              companionId: partner.companionId,
              companionName: partner.companionName,
              senderId: m.senderId,
              senderRole: m.senderRole,
              text: m.text,
              timestamp: new Date(m.createdAt).getTime(),
            })),
          );
        }
      })
      .catch(() => {});

    // Listen for new messages from store (covers both poll + history load)
    const unsubscribe = useChatStore.subscribe((state) => {
      const p = partnerRef.current;
      if (!p) return;
      const c = state.chats[p.companionId];
      if (!c) return;
      setMsgs(
        c.messages.map((m) => ({
          text: m.text,
          time: formatTime(m.timestamp),
          from: m.senderId === user?.id ? 'me' : 'them',
        })) as any,
      );
    });

    return () => {
      unsubscribe();
      useChatStore.getState().closeChat();
    };
  }, [open, partner?.companionId]);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [msgs]);

  const timeToMinutes = (t: string): number => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const shouldShowTimeDivider = (prevTime: string, currTime: string): boolean => {
    const prevMin = timeToMinutes(prevTime);
    let currMin = timeToMinutes(currTime);
    if (currMin < prevMin) currMin += 24 * 60;
    return currMin - prevMin > 3;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await http.post('/companions/chat-upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = data?.data?.url;
      const name = data?.data?.name || file.name;
      if (url) {
        const isImage = file.type.startsWith('image/');
        const marker = isImage ? `[img]${url}[/img]` : `[file:${name}](${url})`;
        setInput((prev) => prev + (prev ? ' ' : '') + marker);
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || '上传失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !partner) return;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const msg: ChatMsg = { text, time, from: 'me' };
    const updated = [...msgs, msg];
    setMsgs(updated);
    setInput('');
    const body: any = { companionId: partner.companionId, message: text, time };
    try {
      await http.post('/companions/chat-notify', body);
    } catch {
      setMsgs((prev) =>
        prev.map((m) =>
          m.text === text && m.time === time && m.from === 'me' && !m.error ? { ...m, error: true } : m,
        ),
      );
    }
  };

  const retrySend = async (msg: ChatMsg) => {
    if (!partner) return;
    const body: any = { companionId: partner.companionId, message: msg.text, time: msg.time };
    try {
      await http.post('/companions/chat-notify', body);
      setMsgs((prev) =>
        prev.map((m) =>
          m.text === msg.text && m.time === msg.time && m.from === msg.from ? { ...m, error: false } : m,
        ),
      );
    } catch {}
  };

  const avatarEl = (p: ChatPartner, size = 36) => {
    const u = p.avatar ? `/uploads/avatars/${p.avatar}?v=${p.avatar}` : null;
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          flexShrink: 0,
          background: u ? `url(${u}) center/cover` : '#CBD5E1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {!u && (
          <span style={{ color: '#FFF', fontSize: size > 30 ? 14 : 11, fontWeight: 700 }}>
            {(p.companionName || '?')[0]}
          </span>
        )}
      </div>
    );
  };

  const handleClose = () => {
    useChatStore.getState().closeChat();
    onClose();
  };

  const myName = user?.displayName || user?.username || '我';
  const myAvatar: ChatPartner = { companionId: '', companionName: myName, avatar: user?.avatar || undefined };

  // Group consecutive messages from same sender within 2 min for QQ-style grouping
  const groupedMessages = msgs.reduce<{ msg: ChatMsg; showAvatar: boolean }[]>((acc, m, i) => {
    const prev = i > 0 ? msgs[i - 1] : null;
    const sameSender = prev && prev.from === m.from;
    const withinTime = prev && timeToMinutes(m.time) - timeToMinutes(prev.time) <= 2;
    acc.push({ msg: m, showAvatar: !sameSender || !withinTime });
    return acc;
  }, []);

  const QQ_EMOJIS = [
    '😀',
    '😂',
    '🤣',
    '😊',
    '😍',
    '🥰',
    '😘',
    '😜',
    '🤔',
    '😅',
    '😭',
    '🥺',
    '😤',
    '👍',
    '👎',
    '🙏',
    '💪',
    '🔥',
    '❤️',
    '💔',
    '⭐',
    '🎉',
    '💰',
    '✅',
    '❌',
    '⚠️',
    '🐶',
    '🐱',
    '🦊',
    '🐼',
    '🐸',
    '🐵',
    '🦁',
    '🐷',
    '🌹',
    '🌸',
    '🍎',
    '🍉',
    '🎮',
    '⚽',
    '🚗',
    '✈️',
    '⏰',
    '💡',
    '🔑',
    '🎵',
    '🌈',
    '☀️',
    '🌙',
    '⛄',
    '😎',
    '🤩',
    '😇',
    '😌',
  ];

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
          {/* Header — QQ-style light blue bar */}
          <div
            style={{
              background: '#12B7F5',
              color: '#FFF',
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexShrink: 0,
            }}
          >
            {avatarEl(partner, 34)}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.2 }}>{partner.companionName}</div>
            </div>
            <Button
              type="text"
              icon={React.createElement(CloseOutlined)}
              onClick={handleClose}
              style={{ color: '#FFF', fontSize: 18 }}
            />
          </div>

          {/* Messages — QQ white background */}
          <div
            ref={bodyRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px 16px',
              background: '#F5F6FA',
            }}
          >
            {msgs.length === 0 && (
              <div style={{ textAlign: 'center', color: '#999', marginTop: 60, fontSize: 13 }}>
                <div style={{ fontSize: 48, marginBottom: 8, opacity: 0.6 }}>💬</div>
                发送第一条消息吧
              </div>
            )}
            {groupedMessages.map(({ msg: m, showAvatar }, i) => {
              const isMe = m.from === 'me';
              const showDivider = i > 0 && shouldShowTimeDivider(groupedMessages[i - 1].msg.time, m.time);
              return (
                <React.Fragment key={i}>
                  {showDivider && (
                    <div style={{ textAlign: 'center', margin: '14px 0 10px', fontSize: 11, color: '#B0B0B0' }}>
                      {m.time}
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: isMe ? 'row-reverse' : 'row',
                      alignItems: 'flex-start',
                      gap: 8,
                      marginBottom: showAvatar ? 12 : 2,
                      paddingLeft: isMe ? 40 : 0,
                      paddingRight: isMe ? 0 : 40,
                    }}
                  >
                    {/* Avatar */}
                    <div style={{ flexShrink: 0, visibility: showAvatar ? 'visible' : 'hidden' }}>
                      {isMe ? avatarEl(myAvatar, 34) : avatarEl(partner, 34)}
                    </div>
                    {/* Bubble + time */}
                    <div style={{ maxWidth: '70%' }}>
                      {/* QQ-style bubble: white with arrow */}
                      <div style={{ position: 'relative' }}>
                        {/* Arrow */}
                        {showAvatar && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 12,
                              [isMe ? 'right' : 'left']: -5,
                              width: 0,
                              height: 0,
                              borderTop: '5px solid transparent',
                              borderBottom: '5px solid transparent',
                              [isMe ? 'borderLeft' : 'borderRight']: '5px solid #FFF',
                            }}
                          />
                        )}
                        <div
                          style={{
                            padding: '8px 12px',
                            borderRadius: 8,
                            fontSize: 14,
                            lineHeight: 1.5,
                            wordBreak: 'break-word',
                            background: isMe ? '#12B7F5' : '#FFF',
                            color: isMe ? '#FFF' : '#1E293B',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                          }}
                        >
                          {m.text.split(/(\[img\].*?\[\/img\]|\[file:.*?\]\(.*?\))/g).map((part: string, j: number) => {
                            if (part.startsWith('[img]') && part.endsWith('[/img]')) {
                              const url = part.slice(5, -6);
                              return (
                                <img
                                  key={j}
                                  src={url}
                                  style={{
                                    maxWidth: 200,
                                    maxHeight: 200,
                                    borderRadius: 6,
                                    display: 'block',
                                    cursor: 'pointer',
                                  }}
                                  alt=""
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                  }}
                                  onClick={() => window.open(url, '_blank')}
                                  onContextMenu={(e2) => {
                                    e2.preventDefault();
                                    if (!customEmojis.includes(url)) {
                                      syncCustomEmojis([...customEmojis, url]);
                                      message.success('已收藏到我的表情');
                                    } else {
                                      message.info('已在收藏中');
                                    }
                                  }}
                                />
                              );
                            }
                            if (part.startsWith('[file:') && part.includes('](')) {
                              const nameEnd = part.indexOf('](');
                              const name = part.slice(6, nameEnd);
                              const url = part.slice(nameEnd + 2, -1);
                              const ext = name.split('.').pop()?.toLowerCase() || '';
                              const isDoc = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'].includes(ext);
                              return (
                                <a
                                  key={j}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '6px 10px',
                                    borderRadius: 6,
                                    background: isMe ? 'rgba(255,255,255,0.2)' : '#F0F0F0',
                                    color: isMe ? '#FFF' : '#2563EB',
                                    fontSize: 13,
                                    textDecoration: 'none',
                                  }}
                                >
                                  <span>{isDoc ? '📄' : '📎'}</span>
                                  <span
                                    style={{
                                      maxWidth: 140,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {name}
                                  </span>
                                </a>
                              );
                            }
                            return <span key={j}>{part}</span>;
                          })}
                        </div>
                      </div>
                      {/* Error + time */}
                      {showAvatar && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#B0B0B0',
                            marginTop: 2,
                            textAlign: isMe ? 'right' : 'left',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            justifyContent: isMe ? 'flex-end' : 'flex-start',
                          }}
                        >
                          {m.error && isMe && (
                            <span
                              onClick={() => retrySend(m)}
                              style={{ color: '#FF4757', fontSize: 14, cursor: 'pointer', fontWeight: 700 }}
                              title="发送失败，点击重试"
                            >
                              !
                            </span>
                          )}
                          {m.time}
                        </div>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          {/* Input area — QQ bottom bar */}
          <div
            style={{
              background: '#FFF',
              borderTop: '1px solid #E8E8E8',
              flexShrink: 0,
            }}
          >
            {/* Quick emoji row */}
            <div
              style={{
                display: 'flex',
                gap: 2,
                padding: '4px 12px',
              }}
            >
              {['👍', '❤️', '😊', '😂', '🎉', '🔥'].map((e) => (
                <span
                  key={e}
                  style={{
                    fontSize: 18,
                    cursor: 'pointer',
                    padding: '2px 6px',
                    borderRadius: 4,
                    transition: 'background 0.15s',
                    userSelect: 'none' as any,
                  }}
                  onMouseEnter={(ev) => {
                    (ev.currentTarget as HTMLSpanElement).style.background = '#F0F0F0';
                  }}
                  onMouseLeave={(ev) => {
                    (ev.currentTarget as HTMLSpanElement).style.background = 'transparent';
                  }}
                  onClick={() => {
                    setInput((prev) => prev + e);
                    inputRef.current?.focus();
                  }}
                >
                  {e}
                </span>
              ))}
              {/* Upload button */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleUpload}
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
                style={{ display: 'none' }}
              />
              <span
                style={{
                  fontSize: 16,
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  padding: '2px 4px',
                  borderRadius: 4,
                  opacity: uploading ? 0.5 : 1,
                  color: '#666',
                }}
                onClick={() => !uploading && fileInputRef.current?.click()}
                title="上传图片或文件"
              >
                {React.createElement(PaperClipOutlined)}
              </span>
              {/* Emoji toggle */}
              <span
                style={{
                  fontSize: 16,
                  cursor: 'pointer',
                  padding: '2px 4px',
                  borderRadius: 4,
                  marginLeft: 4,
                  userSelect: 'none' as any,
                  color: showEmoji ? '#12B7F5' : '#666',
                }}
                onClick={() => setShowEmoji(!showEmoji)}
              >
                {React.createElement(SmileOutlined)}
              </span>
            </div>
            {/* Input + send */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 8,
                padding: '0 12px 10px',
              }}
            >
              <Input.TextArea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="输入消息..."
                autoSize={{ minRows: 1, maxRows: 4 }}
                style={{
                  flex: 1,
                  borderRadius: 6,
                  border: '1px solid #E0E0E0',
                  resize: 'none',
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              />
              <Button
                type="primary"
                onClick={send}
                disabled={!input.trim()}
                icon={React.createElement(SendOutlined)}
                style={{
                  background: input.trim() ? '#12B7F5' : '#E0E0E0',
                  borderColor: 'transparent',
                  borderRadius: 6,
                  minWidth: 60,
                  fontWeight: 600,
                }}
              >
                发送
              </Button>
            </div>

            {/* Emoji panel */}
            {showEmoji && (
              <div
                style={{
                  padding: '8px 12px',
                  background: '#FFF',
                  borderTop: '1px solid #F0F0F0',
                  maxHeight: 200,
                  overflowY: 'auto',
                  flexShrink: 0,
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginBottom: 8 }}>
                  {QQ_EMOJIS.map((e) => (
                    <span
                      key={e}
                      style={{ fontSize: 20, cursor: 'pointer', padding: '3px 5px', borderRadius: 4 }}
                      onClick={() => {
                        setInput((prev) => prev + e);
                        setShowEmoji(false);
                        inputRef.current?.focus();
                      }}
                    >
                      {e}
                    </span>
                  ))}
                </div>
                {/* Custom emojis */}
                {customEmojis.length > 0 && (
                  <div
                    style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingTop: 8, borderTop: '1px solid #F0F0F0' }}
                  >
                    <span style={{ fontSize: 10, color: '#999', width: '100%', marginBottom: 4 }}>我的表情</span>
                    {customEmojis.map((url: string, idx: number) => (
                      <span
                        key={idx}
                        style={{ cursor: 'pointer', padding: 2, borderRadius: 4, position: 'relative' }}
                        onClick={() => {
                          setInput((prev) => prev + ` [img]${url}[/img] `);
                          setShowEmoji(false);
                          inputRef.current?.focus();
                        }}
                      >
                        <img
                          src={url}
                          style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 4 }}
                          alt=""
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                        <span
                          style={{
                            position: 'absolute',
                            top: -4,
                            right: -4,
                            fontSize: 10,
                            cursor: 'pointer',
                            color: '#FF4757',
                            background: '#FFF',
                            borderRadius: '50%',
                            width: 14,
                            height: 14,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                          onClick={(e2) => {
                            e2.stopPropagation();
                            syncCustomEmojis(customEmojis.filter((_, j) => j !== idx));
                          }}
                        >
                          ×
                        </span>
                      </span>
                    ))}
                  </div>
                )}
                {/* Add emoji URL */}
                <div style={{ display: 'flex', gap: 4, paddingTop: 8, borderTop: '1px solid #F0F0F0', marginTop: 8 }}>
                  <Input
                    size="small"
                    value={addEmojiUrl}
                    onChange={(e) => setAddEmojiUrl(e.target.value)}
                    placeholder="粘贴表情图片URL"
                    style={{ flex: 1, fontSize: 11 }}
                  />
                  <Button
                    size="small"
                    onClick={() => {
                      const url = addEmojiUrl.trim();
                      if (url && !customEmojis.includes(url)) {
                        syncCustomEmojis([...customEmojis, url]);
                        setAddEmojiUrl('');
                      }
                    }}
                  >
                    收藏
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
};

export default memo(ChatModal);
