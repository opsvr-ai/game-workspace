import React, { useState, useRef, useEffect } from 'react';
import { Modal, Input, Button } from 'antd';
import { CloseOutlined, UserOutlined } from '@ant-design/icons';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';

interface ChatMsg { text: string; time: string; from: string; }
interface ChatPartner { name: string; avatar?: string; orderId: string; orderInfo?: string; }

interface Props {
  open: boolean;
  partner: ChatPartner | null;
  onClose: () => void;
}

const STORAGE_KEY = 'chat-msgs';

function loadMsgs(orderId: string): ChatMsg[] {
  try { const r = localStorage.getItem(`${STORAGE_KEY}-${orderId}`); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function saveMsgs(orderId: string, msgs: ChatMsg[]) {
  try { localStorage.setItem(`${STORAGE_KEY}-${orderId}`, JSON.stringify(msgs.slice(-200))); } catch {}
}

const ChatModal: React.FC<Props> = ({ open, partner, onClose }) => {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [customEmojis, setCustomEmojis] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('custom-emojis')||'[]'); } catch { return []; } });
  const [addEmojiUrl, setAddEmojiUrl] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const user = useAuthStore(s => s.user);
  const partnerRef = useRef(partner);
  partnerRef.current = partner;

  // Load messages + mark read when opening
  useEffect(() => {
    if (!open || !partner?.orderId) return;
    const loaded = loadMsgs(partner.orderId);
    setMsgs(loaded);
    setInput('');
    useAuthStore.getState().setChatOpen(true);
    localStorage.removeItem(`unread-${partner.orderId}`);
    // Fetch messages from server and merge with localStorage
    http.get(`/companions/chat-pending?orderId=${partner.orderId}`).then(({ data }) => {
      const serverMsgs = data?.data?.messages || [];
      const total = serverMsgs.length || loaded.length;
      useAuthStore.getState().markRead(partner.orderId, total);
      // Merge server messages into state (server has full history)
      if (serverMsgs.length > loaded.length) {
        setMsgs(serverMsgs.map((m: any) => ({ ...m, from: m.from === 'me' ? 'them' : m.from })));
        saveMsgs(partner.orderId, serverMsgs.map((m: any) => ({ ...m, from: m.from === 'me' ? 'them' : m.from })));
      }
    }).catch(() => {
      useAuthStore.getState().markRead(partner.orderId, loaded.length);
    });
    // Listen for new messages from global poll
    const handler = (e: any) => {
      const msg = e.detail;
      const p = partnerRef.current;
      if (!p) return;
      if (msg.orderId === p.orderId) {
        setMsgs(prev => {
          if (prev.some(m => m.text === msg.text && m.time === msg.time)) return prev;
          const updated = [...prev, { text: msg.text, time: msg.time, from: 'them' }];
          saveMsgs(p.orderId, updated);
          return updated;
        });
      }
    };
    window.addEventListener('chat-message', handler);
    return () => window.removeEventListener('chat-message', handler);
  }, [open, partner?.orderId]);

  // Auto-scroll
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs]);

  const send = () => {
    const text = input.trim();
    if (!text || !partner) return;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const msg: ChatMsg = { text, time, from: 'me' };
    const updated = [...msgs, msg];
    setMsgs(updated);
    saveMsgs(partner.orderId, updated);
    setInput('');
    const body: any = { orderId: partner.orderId, message: text, time };
    if (partner.orderId) body.orderId = partner.orderId;
    http.post('/companions/chat-notify', body).catch(() => {});
  };

  const avatarEl = (p: ChatPartner, size = 36, isMe = false) => {
    const u = p.avatar ? `/uploads/avatars/${p.avatar}` : null;
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: u ? `url(${u}) center/cover` : isMe ? '#1890ff' : '#1677ff',
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {u ? null : isMe
          ? <span style={{ color: '#fff', fontSize: size * 0.5 }}>{React.createElement(UserOutlined)}</span>
          : <span style={{ color: '#fff', fontSize: size > 30 ? 15 : 12, fontWeight: 700 }}>{(p.name||'?')[0].toUpperCase()}</span>
        }
      </div>
    );
  };

  const handleClose = () => {
    useAuthStore.getState().setChatOpen(false);
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
    <Modal open={open} footer={null} width={520} closable={false}
      maskClosable={false} keyboard={false}
      style={{ top: 20 }} bodyStyle={{ padding: 0, height: '75vh', display: 'flex', flexDirection: 'column' }}>
      {partner && (
        <>
          {/* Header — WeChat dark bar with order info + X close */}
          <div style={{ background: '#2E2E2E', color: '#FFF', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{partner.name}</div>
              {partner.orderInfo && <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2, lineHeight: 1.4 }}>{partner.orderInfo}</div>}
            </div>
            <Button type="text" icon={React.createElement(CloseOutlined)} onClick={handleClose} style={{ color: '#FFF', fontSize: 18 }} />
          </div>

          {/* Messages — WeChat gray background */}
          <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', background: '#EDEDED' }}>
            {msgs.length === 0 && (
              <div style={{ textAlign: 'center', color: '#B0B0B0', marginTop: 80, fontSize: 13 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
                暂无消息，发送消息开始对话
              </div>
            )}
            {msgs.map((m, i) => {
              const isMe = m.from === 'me';
              return (
                <div key={i} style={{ display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', alignItems: 'flex-start', gap: 8, marginBottom: 14 }}>
                  {/* Avatar */}
                  <div style={{ flexShrink: 0 }}>
                    {isMe ? avatarEl(myAvatar, 34, true) : avatarEl(partner, 34, false)}
                  </div>
                  {/* Bubble */}
                  <div style={{ maxWidth: '65%' }}>
                    <div style={{
                      padding: '10px 14px', borderRadius: 8, fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word',
                      background: isMe ? '#95EC69' : '#FFFFFF', color: '#333',
                      position: 'relative',
                    }}>
                      {m.text}
                    </div>
                    <div style={{ fontSize: 11, color: '#B0B0B0', marginTop: 3, textAlign: isMe ? 'right' : 'left' }}>{m.time}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Input bar — WeChat style */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#F7F7F7', borderTop: '1px solid #E0E0E0', flexShrink: 0 }}>
            <span style={{ fontSize: 22, cursor: 'pointer', userSelect: 'none' as any }} onClick={() => setShowEmoji(!showEmoji)}>😊</span>
            <Input value={input} onChange={e => setInput(e.target.value)} onPressEnter={send}
              placeholder="输入消息..." style={{ flex: 1, borderRadius: 6, background: '#FFF', border: '1px solid #E0E0E0' }} />
            <Button onClick={send} disabled={!input.trim()}
              style={{ background: input.trim() ? '#07C160' : '#E0E0E0', borderColor: input.trim() ? '#07C160' : '#E0E0E0', color: input.trim() ? '#FFF' : '#999', borderRadius: 6, fontWeight: 600 }}>
              发送
            </Button>
          </div>
          {showEmoji && (
            <div style={{ padding: '8px 10px', background: '#FFF', borderTop: '1px solid #E0E0E0', maxHeight: 240, overflowY: 'auto', flexShrink: 0 }}>
              {/* Built-in emoji */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {(['😀','😂','🤣','😊','😍','🥰','😘','😜','🤔','😅','😭','🥺','😤','🤬','👍','👎','🙏','💪','🔥','❤️','💔','⭐','🎉','🎂','💰','📱','💻','✅','❌','⚠️','🟢','🔴','🐶','🐱','🦊','🐼','🐨','🐸','🐵','🦁','🐮','🐷','🌹','🌸','🌺','🍎','🍉','🍕','🍔','🎮','⚽','🏀','🚗','✈️','🏠','⏰','📅','💡','🔑','🎵','🌈','☀️','🌙','⛄'] as string[]).map(e => (
                  <span key={e} style={{ fontSize: 22, cursor: 'pointer', padding: '2px 4px', borderRadius: 4 }} onClick={() => { setInput(prev => prev + e); setShowEmoji(false); }}>{e}</span>
                ))}
              </div>
              {/* Custom emojis */}
              {customEmojis.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8, paddingTop: 8, borderTop: '1px solid #F0F0F0' }}>
                  <span style={{ fontSize: 10, color: '#999', width: '100%', marginBottom: 4 }}>我的表情</span>
                  {customEmojis.map((url: string, i: number) => (
                    <span key={i} style={{ cursor: 'pointer', padding: 2, borderRadius: 4, position: 'relative' }}
                      onClick={() => { setInput(prev => prev + ` [img]${url}[/img] `); setShowEmoji(false); }}>
                      <img src={url} style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 4 }} alt="emoji"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <span style={{ position: 'absolute', top: -4, right: -4, fontSize: 10, cursor: 'pointer', color: '#FF4757', background: '#FFF', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={(e2) => { e2.stopPropagation(); const next = customEmojis.filter((_:string,j:number) => j !== i); setCustomEmojis(next); localStorage.setItem('custom-emojis', JSON.stringify(next)); }}>×</span>
                    </span>
                  ))}
                </div>
              )}
              {/* Add custom emoji input */}
              <div style={{ display: 'flex', gap: 4, paddingTop: 8, borderTop: '1px solid #F0F0F0' }}>
                <Input size="small" value={addEmojiUrl} onChange={e => setAddEmojiUrl(e.target.value)}
                  placeholder="粘贴表情图片URL" style={{ flex: 1, fontSize: 11 }} />
                <Button size="small" onClick={() => { const url = addEmojiUrl.trim(); if (url && !customEmojis.includes(url)) { const next = [...customEmojis, url]; setCustomEmojis(next); localStorage.setItem('custom-emojis', JSON.stringify(next)); setAddEmojiUrl(''); } }}>收藏</Button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
};

export default ChatModal;
