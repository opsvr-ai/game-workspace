import React, { useState, useRef, useEffect } from 'react';
import { Modal, Input, Button } from 'antd';
import { LeftOutlined, UserOutlined } from '@ant-design/icons';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';

interface ChatMsg { text: string; time: string; from: string; }
interface ChatPartner { name: string; avatar?: string; companionId: string; orderInfo?: string; orderId?: string; }

interface Props {
  open: boolean;
  partner: ChatPartner | null;
  onClose: () => void;
}

const STORAGE_KEY = 'chat-msgs';

function loadMsgs(companionId: string): ChatMsg[] {
  try { const r = localStorage.getItem(`${STORAGE_KEY}-${companionId}`); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function saveMsgs(companionId: string, msgs: ChatMsg[]) {
  try { localStorage.setItem(`${STORAGE_KEY}-${companionId}`, JSON.stringify(msgs.slice(-200))); } catch {}
}

const ChatModal: React.FC<Props> = ({ open, partner, onClose }) => {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [dbg, setDbg] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const user = useAuthStore(s => s.user);
  const partnerRef = useRef(partner);
  partnerRef.current = partner;

  // Load messages when modal opens with a new companionId
  useEffect(() => {
    if (!open || !partner?.companionId) return;
    setMsgs(loadMsgs(partner.companionId));
    setInput('');
    // Poll immediately, then every 3s
    let timer: any;
    const poll = async () => {
      const p = partnerRef.current;
      if (!p) return;
      try {
        const { data } = await http.get(`/companions/chat-pending?companionId=${p.companionId}`);
        const d = data.data;
        setDbg(`轮询OK companionId=${(p.companionId||'').slice(0,8)} msgs=${d?.messages?.length||0} hasNew=${d?.hasNew} ${new Date().toLocaleTimeString()}`);
        if (d?.messages?.length) {
          setMsgs(prev => {
            const seen = new Set(prev.map(m => m.text + m.time));
            const news = d.messages.filter((m: any) => !seen.has(m.text + m.time));
            if (news.length === 0) return prev;
            const updated = [...prev, ...news.map((m: any) => ({ ...m, from: 'them' }))];
            saveMsgs(p.companionId, updated);
            return updated;
          });
        }
      } catch (e: any) {
        setDbg(`轮询ERR ${e?.message || '未知'}`);
      }
    };
    poll();
    timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, [open, partner?.companionId]);

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
    saveMsgs(partner.companionId, updated);
    setInput('');
    const body: any = { companionId: partner.companionId, message: text, time };
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

  // Current user avatar
  const myName = user?.displayName || user?.username || '我';
  const myAvatar = { name: myName, avatar: user?.avatar || undefined, companionId: '', orderInfo: '' };

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={520} closable={false}
      style={{ top: 20 }} bodyStyle={{ padding: 0, height: '75vh', display: 'flex', flexDirection: 'column' }}>
      {partner && (
        <>
          {/* Header — WeChat dark bar with order info */}
          <div style={{ background: '#2E2E2E', color: '#FFF', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <Button type="text" icon={React.createElement(LeftOutlined)} onClick={onClose} style={{ color: '#FFF' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{partner.name}</div>
              {partner.orderInfo && <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2, lineHeight: 1.4 }}>{partner.orderInfo}</div>}
              <div style={{ fontSize: 10, color: '#0f0', marginTop: 2, fontFamily: 'monospace' }}>{dbg || '等待轮询...'}</div>
            </div>
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
            <span style={{ fontSize: 22, cursor: 'default' }}>😊</span>
            <Input value={input} onChange={e => setInput(e.target.value)} onPressEnter={send}
              placeholder="输入消息..." style={{ flex: 1, borderRadius: 6, background: '#FFF', border: '1px solid #E0E0E0' }} />
            <Button onClick={send} disabled={!input.trim()}
              style={{ background: input.trim() ? '#07C160' : '#E0E0E0', borderColor: input.trim() ? '#07C160' : '#E0E0E0', color: input.trim() ? '#FFF' : '#999', borderRadius: 6, fontWeight: 600 }}>
              发送
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
};

export default ChatModal;
