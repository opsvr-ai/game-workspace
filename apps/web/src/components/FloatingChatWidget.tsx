import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Badge, Popover, List, Typography } from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import { useAuthStore } from '../stores/authStore';
import { useChatStore, type ChatNotification } from '../stores/chatStore';

interface Props {
  onOpenChat: (companionId: string, companionName: string) => void;
}

const STORAGE_KEY = 'chat-widget-pos';

function loadPosition(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    x: window.innerWidth - 76,
    y: window.innerHeight - 140,
  };
}

function savePosition(pos: { x: number; y: number }): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {}
}

const FloatingChatWidget: React.FC<Props> = ({ onOpenChat }) => {
  const user = useAuthStore((s) => s.user);
  const { chatNotifications, chatUnread } = useChatStore();
  const totalUnread = Object.values(chatUnread).reduce((a, b) => a + b, 0);

  const [position, setPosition] = useState(loadPosition);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [bounce, setBounce] = useState(false);

  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  const prevNotifCount = useRef(chatNotifications.length);

  // Bounce animation when a new notification arrives
  useEffect(() => {
    if (chatNotifications.length > prevNotifCount.current) {
      setBounce(true);
      const t = setTimeout(() => setBounce(false), 500);
      prevNotifCount.current = chatNotifications.length;
      return () => clearTimeout(t);
    }
    prevNotifCount.current = chatNotifications.length;
  }, [chatNotifications.length]);

  // Drag: mouse
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      hasMoved.current = false;
      dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    },
    [position],
  );

  useEffect(() => {
    if (!isDragging.current) return;
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const nx = Math.max(0, Math.min(window.innerWidth - 56, e.clientX - dragStart.current.x));
      const ny = Math.max(0, Math.min(window.innerHeight - 56, e.clientY - dragStart.current.y));
      if (Math.abs(nx - position.x) > 3 || Math.abs(ny - position.y) > 3) {
        hasMoved.current = true;
      }
      setPosition({ x: nx, y: ny });
    };
    const onUp = () => {
      isDragging.current = false;
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
  }, [position]);

  // Drag: touch
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0];
      isDragging.current = true;
      hasMoved.current = false;
      dragStart.current = { x: t.clientX - position.x, y: t.clientY - position.y };
    },
    [position],
  );

  useEffect(() => {
    const onMove = (e: TouchEvent) => {
      if (!isDragging.current) return;
      const t = e.touches[0];
      const nx = Math.max(0, Math.min(window.innerWidth - 56, t.clientX - dragStart.current.x));
      const ny = Math.max(0, Math.min(window.innerHeight - 56, t.clientY - dragStart.current.y));
      if (Math.abs(nx - position.x) > 3 || Math.abs(ny - position.y) > 3) {
        hasMoved.current = true;
      }
      setPosition({ x: nx, y: ny });
    };
    const onEnd = () => {
      isDragging.current = false;
      savePosition(position);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);
    return () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [position]);

  const handleClick = useCallback(() => {
    if (hasMoved.current) return; // was a drag, not a click
    setPopoverOpen((prev) => !prev);
  }, []);

  // Deduplicated notification list
  const deduped = (() => {
    const map: Record<string, ChatNotification> = {};
    for (const n of chatNotifications) {
      if (!map[n.companionId] || n.timestamp > map[n.companionId].timestamp) {
        map[n.companionId] = n;
      }
    }
    return Object.values(map)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);
  })();

  const notificationContent = (
    <div style={{ width: 300, maxHeight: 400, overflowY: 'auto' }}>
      {deduped.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#94A3B8', fontSize: 13 }}>暂无消息通知</div>
      ) : (
        <List
          size="small"
          dataSource={deduped}
          renderItem={(item) => {
            const unread = chatUnread[item.companionId] || 0;
            const timeStr = new Date(item.timestamp).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <List.Item
                style={{
                  cursor: 'pointer',
                  padding: '10px 12px',
                  borderRadius: 6,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = '#F8FAFC';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
                onClick={() => {
                  onOpenChat(item.companionId, item.companionName);
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
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>
                        {(item.companionName || '?')[0].toUpperCase()}
                      </span>
                    </div>
                  }
                  title={
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {item.companionName}
                      {unread > 0 && (
                        <span
                          style={{
                            marginLeft: 8,
                            background: '#EF4444',
                            color: '#FFF',
                            borderRadius: 10,
                            padding: '0 6px',
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                        >
                          {unread}
                        </span>
                      )}
                    </span>
                  }
                  description={
                    <div>
                      <Typography.Text
                        style={{ fontSize: 12, color: '#64748B' }}
                        ellipsis={{ tooltip: item.lastMessage }}
                      >
                        {item.lastMessage || '（无文字消息）'}
                      </Typography.Text>
                      <br />
                      <Typography.Text style={{ fontSize: 11, color: '#94A3B8' }}>{timeStr}</Typography.Text>
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );

  // Hide for companions
  if (!user) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 1050,
        cursor: 'pointer',
        userSelect: 'none',
        transition: bounce ? 'none' : 'left 0.05s, top 0.05s',
      }}
    >
      <Popover
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        trigger="click"
        placement="topRight"
        title="消息通知"
        content={notificationContent}
      >
        <div
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onClick={handleClick}
          className={[totalUnread > 0 ? 'float-widget-pulse' : '', bounce ? 'float-widget-bounce' : '']
            .filter(Boolean)
            .join(' ')}
          style={{
            position: 'relative',
          }}
        >
          <Badge count={totalUnread} overflowCount={99} size="default" offset={[-4, 4]}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #2563EB, #3B82F6)',
                boxShadow: '0 4px 16px rgba(37, 99, 235, 0.4), 0 1px 4px rgba(0, 0, 0, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)';
                (e.currentTarget as HTMLElement).style.boxShadow =
                  '0 6px 24px rgba(37, 99, 235, 0.55), 0 2px 6px rgba(0, 0, 0, 0.15)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                (e.currentTarget as HTMLElement).style.boxShadow =
                  '0 4px 16px rgba(37, 99, 235, 0.4), 0 1px 4px rgba(0, 0, 0, 0.1)';
              }}
            >
              {React.createElement(MessageOutlined as any, {
                style: { fontSize: 26, color: '#FFF' },
              })}
            </div>
          </Badge>
        </div>
      </Popover>
    </div>
  );
};

export { FloatingChatWidget };
