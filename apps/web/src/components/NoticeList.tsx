import React from 'react';
import { Button, Typography } from 'antd';
import { useNotifStore, type NoticeItem } from '../stores/notifStore';

interface Props {
  onClose: () => void;
  onNavigate: (href: string, item: NoticeItem) => void;
}

const formatTime = (ts: number): string => {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  return d.getMonth() + 1 + '/' + d.getDate();
};

/**
 * 右上角铃铛里的内容 —— 只有通知，没有聊天。
 * 老板 2026-09-30：「铃铛那里去除聊天的信息，只保留其他的通知」。
 * 聊天（私聊 / 群聊）现在只看左侧消息面板和导航角标，铃铛不再掺聊天。
 */
const NoticeList: React.FC<Props> = ({ onClose, onNavigate }) => {
  const items = useNotifStore((s) => s.items);
  const markRead = useNotifStore((s) => s.markRead);
  const markAllRead = useNotifStore((s) => s.markAllRead);
  const clear = useNotifStore((s) => s.clear);
  const unread = items.reduce((n, it) => (it.read ? n : n + 1), 0);

  return (
    <div style={{ width: 360, maxHeight: 460, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '2px 4px 8px',
          borderBottom: '1px solid #F0F0F0',
        }}
      >
        <Typography.Text strong style={{ fontSize: 13, color: '#1E293B' }}>
          🔔 通知{unread > 0 ? '（未读 ' + (unread > 99 ? '99+' : unread) + '）' : ''}
        </Typography.Text>
        <span>
          <Button type="link" size="small" disabled={unread === 0} onClick={() => markAllRead()}>
            全部已读
          </Button>
          <Button type="link" size="small" disabled={items.length === 0} onClick={() => clear()}>
            清空
          </Button>
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 4 }}>
        {items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 12px', color: '#94A3B8', fontSize: 13 }}>
            <div style={{ fontSize: 36, marginBottom: 6, opacity: 0.5 }}>🔔</div>
            暂无通知
          </div>
        ) : (
          items.map((it) => (
            <div
              key={it.id}
              onClick={() => {
                markRead(it.id);
                if (it.href) {
                  onNavigate(it.href, it);
                  onClose();
                }
              }}
              style={{
                display: 'flex',
                gap: 10,
                padding: '10px 10px',
                borderRadius: 8,
                cursor: it.href ? 'pointer' : 'default',
                background: it.read ? 'transparent' : '#EFF6FF',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = it.read ? '#F8FAFC' : '#E3EEFF';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = it.read ? 'transparent' : '#EFF6FF';
              }}
            >
              <span style={{ fontSize: 18, lineHeight: '20px', flexShrink: 0 }}>{it.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <Typography.Text
                    strong={!it.read}
                    style={{ fontSize: 13, color: '#1E293B', whiteSpace: 'normal' }}
                  >
                    {it.title}
                  </Typography.Text>
                  <Typography.Text style={{ fontSize: 11, color: '#94A3B8', flexShrink: 0 }}>
                    {formatTime(it.at)}
                  </Typography.Text>
                </div>
                {it.desc ? (
                  <div style={{ fontSize: 12, color: it.read ? '#94A3B8' : '#475569', marginTop: 3, lineHeight: 1.5 }}>
                    {it.desc}
                  </div>
                ) : null}
                {it.href ? (
                  <div style={{ fontSize: 11, color: '#2563EB', marginTop: 4 }}>查看 ›</div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export { NoticeList };
