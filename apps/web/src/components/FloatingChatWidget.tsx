// craftsman-ignore: TS001
import React, { useState, useRef, useEffect, useCallback } from 'react';
// useCallback used by handleMouseDown
import { Badge, Popover, List, Typography } from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';

interface Props {
  onOpenChat: (conversationId: string, participantName: string) => void;
}

const STORAGE_KEY = 'chat-widget-pos';

function loadPosition(): { x: number; y: number } {
  const w = window.innerWidth || 1024;
  const h = window.innerHeight || 768;
  const defaultPos = { x: w - 76, y: h - 140 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Only accept saved position if it's near the right/bottom edge (within 200px)
      if (saved.x > w - 200 && saved.y > h - 300) return saved;
    }
  } catch {}
  return defaultPos;
}

function savePosition(pos: { x: number; y: number }): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {}
}

const FloatingChatWidget: React.FC<Props> = ({ onOpenChat }) => {
  const user = useAuthStore((s) => s.user);
  const { conversations, conversationOrder, totalUnread, markRead } = useChatStore();

  const [position, setPosition] = useState(loadPosition);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [bounce, setBounce] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  const prevTotalUnread = useRef(totalUnread);

  // Bounce on new message
  useEffect(() => {
    if (totalUnread > prevTotalUnread.current) {
      setBounce(true);
      const t = setTimeout(() => setBounce(false), 500);
      prevTotalUnread.current = totalUnread;
      return () => clearTimeout(t);
    }
    prevTotalUnread.current = totalUnread;
  }, [totalUnread]);

  // Reposition on window resize — keep within bounds
  useEffect(() => {
    const onResize = () => {
      setPosition((prev) => ({
        x: Math.min(prev.x, window.innerWidth - 56),
        y: Math.min(prev.y, window.innerHeight - 56),
      }));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Drag handlers (unchanged)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      hasMoved.current = false;
      dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    },
    [position],
  );

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const nx = Math.max(0, Math.min(window.innerWidth - 56, e.clientX - dragStart.current.x));
      const ny = Math.max(0, Math.min(window.innerHeight - 56, e.clientY - dragStart.current.y));
      if (Math.abs(nx - position.x) > 3 || Math.abs(ny - position.y) > 3) hasMoved.current = true;
      setPosition({ x: nx, y: ny });
    };
    const onUp = () => {
      setIsDragging(false);
      savePosition(position);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, position]);

  // Popover trigger="click" handles open/close — don't duplicate toggle
  const notificationItems = conversationOrder
    .map((id) => conversations[id])
    .filter(Boolean)
    .filter((c) => c.lastMessageAt > 0)
    .slice(0, 10);

  if (!user) return null;

  const formatTime = (ts: number): string => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 1050,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <Popover
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        trigger="click"
        placement="topRight"
        title="消息通知"
        content={
          <div style={{ width: 300, maxHeight: 400, overflowY: 'auto' }}>
            {notificationItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#94A3B8', fontSize: 13 }}>暂无消息通知</div>
            ) : (
              <List
                size="small"
                dataSource={notificationItems}
                renderItem={(c: any) => (
                  <List.Item
                    style={{ cursor: 'pointer', padding: '10px 12px', borderRadius: 6 }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = '#F8FAFC';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                    onClick={() => {
                      markRead(c.id);
                      onOpenChat(c.id, c.participant?.displayName || c.participant?.username || '?');
                      setPopoverOpen(false);
                    }}
                  >
                    <List.Item.Meta
                      avatar={
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            background: '#1677ff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>
                            {(c.participant?.username || '?')[0].toUpperCase()}
                          </span>
                        </div>
                      }
                      title={
                        <span style={{ fontWeight: 600, fontSize: 13 }}>
                          {c.participant?.displayName || c.participant?.username}
                          {c.unreadCount > 0 && (
                            <span
                              style={{
                                marginLeft: 8,
                                background: '#EF4444',
                                color: '#FFF',
                                borderRadius: 10,
                                padding: '0 6px',
                                fontSize: 10,
                              }}
                            >
                              {c.unreadCount}
                            </span>
                          )}
                        </span>
                      }
                      description={
                        <div>
                          <Typography.Text style={{ fontSize: 12 }} ellipsis={{ tooltip: c.lastMessage }}>
                            {c.lastMessage || ''}
                          </Typography.Text>
                          <br />
                          <Typography.Text style={{ fontSize: 11, color: '#94A3B8' }}>
                            {formatTime(c.lastMessageAt)}
                          </Typography.Text>
                        </div>
                      }
                    />
                  </List.Item>
                )}
                split={false}
              />
            )}
          </div>
        }
      >
        <div
          onMouseDown={handleMouseDown}
          className={[totalUnread > 0 ? 'float-widget-pulse' : '', bounce ? 'float-widget-bounce' : '']
            .filter(Boolean)
            .join(' ')}
        >
          <Badge count={totalUnread} overflowCount={99} size="default" offset={[-4, 4]}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #2563EB, #3B82F6)',
                boxShadow: '0 4px 16px rgba(37, 99, 235, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {React.createElement(MessageOutlined as any, { style: { fontSize: 26, color: '#FFF' } })}
            </div>
          </Badge>
        </div>
      </Popover>
    </div>
  );
};

export { FloatingChatWidget };
