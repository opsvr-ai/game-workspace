// craftsman-ignore: TS001,TS002
import React, { memo, useState, useRef, useEffect } from 'react';
import { Modal, Input, Button, message } from 'antd';
import { CloseOutlined, UserOutlined } from '@ant-design/icons';
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
  name: string;
  avatar?: string;
  orderId: string;
  orderInfo?: string;
}

interface Props {
  open: boolean;
  partner: ChatPartner | null;
  onClose: () => void;
}

const STORAGE_PREFIX = 'chat-msgs';

function loadMsgs(userId: string, orderId: string): ChatMsg[] {
  try {
    const r = localStorage.getItem(`${STORAGE_PREFIX}-${userId}-${orderId}`);
    return r ? JSON.parse(r) : [];
  } catch {
    return [];
  }
}
function saveMsgs(userId: string, orderId: string, msgs: ChatMsg[]) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}-${userId}-${orderId}`, JSON.stringify(msgs.slice(-200)));
  } catch {}
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
  const user = useAuthStore((s) => s.user);
  const partnerRef = useRef(partner);
  partnerRef.current = partner;

  // Sync custom emojis to localStorage + server
  const syncCustomEmojis = (next: string[]) => {
    setCustomEmojis(next);
    localStorage.setItem('custom-emojis', JSON.stringify(next));
    http.put('/auth/me/emojis', { emojis: next }).catch(() => {});
  };

  // Load custom emojis from server on mount (localStorage is fast cache)
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

  // Load messages + mark read when opening
  useEffect(() => {
    if (!open || !partner?.orderId) return;
    const loaded = loadMsgs(user?.id || '', partner.orderId);
    setMsgs(loaded);
    setInput('');
    useChatStore.getState().setChatOpen(true);
    localStorage.removeItem(`unread-${partner.orderId}`);
    // Fetch messages from server and merge with localStorage
    http
      .get(`/companions/chat-pending?orderId=${partner.orderId}`)
      .then(({ data }) => {
        const serverMsgs = data?.data?.messages || [];
        const total = serverMsgs.length || loaded.length;
        useChatStore.getState().markRead(partner.orderId, total);
        // Merge server messages into state (server has full history)
        if (serverMsgs.length > loaded.length) {
          setMsgs(serverMsgs);
          saveMsgs(user?.id || '', partner.orderId, serverMsgs);
        }
      })
      .catch(() => {
        useChatStore.getState().markRead(partner.orderId, loaded.length);
      });
    // Listen for new messages from global poll
    const handler = (e: any) => {
      const msg = e.detail;
      const p = partnerRef.current;
      if (!p) return;
      if (msg.orderId === p.orderId) {
        setMsgs((prev) => {
          if (prev.some((m) => m.text === msg.text && m.time === msg.time)) return prev;
          const updated = [...prev, { text: msg.text, time: msg.time, from: 'them' }];
          saveMsgs(user?.id || '', p.orderId, updated);
          return updated;
        });
      }
    };
    window.addEventListener('chat-message', handler);
    return () => window.removeEventListener('chat-message', handler);
  }, [open, partner?.orderId]);

  // Auto-scroll (smooth)
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
    return currMin - prevMin > 5;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !partner) return;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const msg: ChatMsg = { text, time, from: 'me' };
    const updated = [...msgs, msg];
    setMsgs(updated);
    saveMsgs(user?.id || '', partner.orderId, updated);
    setInput('');
    const body: any = { orderId: partner.orderId, message: text, time };
    if (partner.orderId) body.orderId = partner.orderId;
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
    const body: any = { orderId: partner.orderId, message: msg.text, time: msg.time };
    try {
      await http.post('/companions/chat-notify', body);
      setMsgs((prev) =>
        prev.map((m) =>
          m.text === msg.text && m.time === msg.time && m.from === msg.from ? { ...m, error: false } : m,
        ),
      );
    } catch {
      // keep error flag
    }
  };

  const avatarEl = (p: ChatPartner, size = 36, isMe = false) => {
    const u = p.avatar ? `/uploads/avatars/${p.avatar}?v=${p.avatar}` : null;
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          flexShrink: 0,
          background: u ? `url(${u}) center/cover` : isMe ? '#1890ff' : '#1677ff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {u ? null : isMe ? (
          <span style={{ color: '#fff', fontSize: size * 0.5 }}>{React.createElement(UserOutlined)}</span>
        ) : (
          <span style={{ color: '#fff', fontSize: size > 30 ? 15 : 12, fontWeight: 700 }}>
            {(p.name || '?')[0].toUpperCase()}
          </span>
        )}
      </div>
    );
  };

  const handleClose = () => {
    useChatStore.getState().setChatOpen(false);
    if (partner) {
      localStorage.removeItem(`unread-${partner.orderId}`);
      if (partner.orderId) localStorage.removeItem(`unread-${partner.orderId}`);
    }
    onClose();
  };

  // Current user avatar
  const myName = user?.displayName || user?.username || '我';
  const myAvatar = { name: myName, avatar: user?.avatar || undefined, orderId: '', orderInfo: '' };

  return (
    <Modal
      open={open}
      footer={null}
      width={520}
      closable={false}
      maskClosable={false}
      keyboard={false}
      style={{ top: 20 }}
      bodyStyle={{ padding: 0, height: '75vh', display: 'flex', flexDirection: 'column' }}
    >
      {partner && (
        <>
          {/* Header — gradient bar with online dot + order info + X close */}
          <div
            style={{
              background: 'linear-gradient(135deg, #00D4FF, #7B61FF)',
              color: '#FFF',
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexShrink: 0,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Online status dot */}
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#00E676',
                    boxShadow: '0 0 6px #00E676',
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 16,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {partner.name}
                </div>
              </div>
              {partner.orderInfo && (
                <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2, lineHeight: 1.4 }}>{partner.orderInfo}</div>
              )}
            </div>
            <Button
              type="text"
              icon={React.createElement(CloseOutlined)}
              onClick={handleClose}
              style={{ color: '#FFF', fontSize: 18 }}
            />
          </div>

          {/* Messages */}
          <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', background: '#EDEDED' }}>
            {msgs.length === 0 && (
              <div style={{ textAlign: 'center', color: '#B0B0B0', marginTop: 80, fontSize: 13 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
                暂无聊天记录，发送第一条消息吧
              </div>
            )}
            {msgs.map((m, i) => {
              const isMe = m.from === 'me';
              const showDivider = i > 0 && shouldShowTimeDivider(msgs[i - 1].time, m.time);
              return (
                <React.Fragment key={i}>
                  {/* Time divider */}
                  {showDivider && (
                    <div
                      style={{
                        textAlign: 'center',
                        margin: '12px 0',
                        fontSize: 11,
                        color: '#94A3B8',
                      }}
                    >
                      ——— {m.time} ———
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: isMe ? 'row-reverse' : 'row',
                      alignItems: 'flex-start',
                      gap: 8,
                      marginBottom: 10,
                    }}
                  >
                    {/* Avatar */}
                    <div style={{ flexShrink: 0 }}>
                      {isMe ? avatarEl(myAvatar, 34, true) : avatarEl(partner, 34, false)}
                    </div>
                    {/* Bubble */}
                    <div style={{ maxWidth: '65%' }}>
                      <div
                        style={{
                          padding: '10px 14px',
                          borderRadius: 12,
                          fontSize: 14,
                          lineHeight: 1.5,
                          wordBreak: 'break-word',
                          background: isMe
                            ? 'linear-gradient(135deg, #00D4FF, #7B61FF)'
                            : '#F1F5F9',
                          color: isMe ? '#FFF' : '#1E293B',
                          position: 'relative',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                        }}
                      >
                        {m.text.split(/(\[img\].*?\[\/img\])/g).map((part: string, i: number) => {
                          if (part.startsWith('[img]') && part.endsWith('[/img]')) {
                            const url = part.slice(5, -6);
                            return (
                              <img
                                key={i}
                                src={url}
                                style={{
                                  maxWidth: 120,
                                  maxHeight: 120,
                                  borderRadius: 4,
                                  display: 'block',
                                  cursor: 'pointer',
                                }}
                                alt="emoji"
                                title="右键收藏此表情"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
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
                          return <span key={i}>{part}</span>;
                        })}
                      </div>
                      {/* Time + error indicator */}
                      <div
                        style={{
                          fontSize: 11,
                          color: '#B0B0B0',
                          marginTop: 3,
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
                            style={{
                              color: '#FF4757',
                              fontSize: 14,
                              cursor: 'pointer',
                              fontWeight: 700,
                            }}
                            title="发送失败，点击重试"
                          >
                            !
                          </span>
                        )}
                        {m.time}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          {/* Quick emoji bar */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              padding: '4px 10px',
              background: '#F7F7F7',
              borderTop: '1px solid #E0E0E0',
              flexShrink: 0,
            }}
          >
            {['👍', '❤️', '😊', '😂', '🎉', '🔥'].map((e) => (
              <span
                key={e}
                style={{
                  fontSize: 20,
                  cursor: 'pointer',
                  padding: '2px 6px',
                  borderRadius: 6,
                  transition: 'background 0.15s',
                  userSelect: 'none' as any,
                }}
                onMouseEnter={(ev) => {
                  (ev.currentTarget as HTMLSpanElement).style.background = '#E8ECF1';
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
            <span
              style={{
                fontSize: 20,
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: 6,
                userSelect: 'none' as any,
                marginLeft: 'auto',
              }}
              onClick={() => setShowEmoji(!showEmoji)}
            >
              😊
            </span>
          </div>

          {/* Input bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              background: '#F7F7F7',
              borderTop: '1px solid #E0E0E0',
              flexShrink: 0,
            }}
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={send}
              placeholder="输入消息..."
              style={{
                flex: 1,
                borderRadius: 20,
                background: '#FFF',
                border: '1px solid #E0E0E0',
                boxShadow: 'none',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#00D4FF';
                e.currentTarget.style.boxShadow = '0 0 0 2px rgba(0,212,255,0.2)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#E0E0E0';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
            <Button
              onClick={send}
              disabled={!input.trim()}
              style={{
                background: input.trim()
                  ? 'linear-gradient(135deg, #00D4FF, #7B61FF)'
                  : '#E0E0E0',
                borderColor: input.trim() ? 'transparent' : '#E0E0E0',
                color: input.trim() ? '#FFF' : '#999',
                borderRadius: 20,
                fontWeight: 600,
                padding: '0 18px',
                border: 'none',
              }}
            >
              发送
            </Button>
          </div>
          {showEmoji && (
            <div
              style={{
                padding: '8px 10px',
                background: '#FFF',
                borderTop: '1px solid #E0E0E0',
                maxHeight: 240,
                overflowY: 'auto',
                flexShrink: 0,
              }}
            >
              {/* Built-in emoji */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {(
                  [
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
                    '🤬',
                    '👍',
                    '👎',
                    '🙏',
                    '💪',
                    '🔥',
                    '❤️',
                    '💔',
                    '⭐',
                    '🎉',
                    '🎂',
                    '💰',
                    '📱',
                    '💻',
                    '✅',
                    '❌',
                    '⚠️',
                    '🟢',
                    '🔴',
                    '🐶',
                    '🐱',
                    '🦊',
                    '🐼',
                    '🐨',
                    '🐸',
                    '🐵',
                    '🦁',
                    '🐮',
                    '🐷',
                    '🌹',
                    '🌸',
                    '🌺',
                    '🍎',
                    '🍉',
                    '🍕',
                    '🍔',
                    '🎮',
                    '⚽',
                    '🏀',
                    '🚗',
                    '✈️',
                    '🏠',
                    '⏰',
                    '📅',
                    '💡',
                    '🔑',
                    '🎵',
                    '🌈',
                    '☀️',
                    '🌙',
                    '⛄',
                  ] as string[]
                ).map((e) => (
                  <span
                    key={e}
                    style={{ fontSize: 22, cursor: 'pointer', padding: '2px 4px', borderRadius: 4 }}
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
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 4,
                    marginBottom: 8,
                    paddingTop: 8,
                    borderTop: '1px solid #F0F0F0',
                  }}
                >
                  <span style={{ fontSize: 10, color: '#999', width: '100%', marginBottom: 4 }}>我的表情</span>
                  {customEmojis.map((url: string, i: number) => (
                    <span
                      key={i}
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
                        alt="emoji"
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
                          syncCustomEmojis(customEmojis.filter((_: string, j: number) => j !== i));
                        }}
                      >
                        ×
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {/* Add custom emoji input */}
              <div style={{ display: 'flex', gap: 4, paddingTop: 8, borderTop: '1px solid #F0F0F0' }}>
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
        </>
      )}
    </Modal>
  );
};

export default memo(ChatModal);
