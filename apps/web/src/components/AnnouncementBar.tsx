// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import http from '../api/client';
import { visibleInterval } from '../hooks/usePolling';

/**
 * 店长 / 老板在后台设置的公告栏。
 * 红字 + 📢 从左往右滚动；没内容时整条不占位。
 * 每 60 秒重新拉一次，后台改完不用刷新页面。
 */
const AnnouncementBar: React.FC = () => {
  const [text, setText] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () => {
      http
        .get('/announcement')
        .then(({ data }: any) => {
          if (!alive) return;
          setText(String(data?.data?.text || '').trim());
        })
        .catch(() => {});
    };
    load();
    const timer = visibleInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer as any);
    };
  }, []);

  if (!text) return null;

  return (
    <div
      style={{
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        background: '#FFF7F7',
        border: '1px solid #FFD6D6',
        borderRadius: 8,
        padding: '5px 0',
        marginBottom: 12,
      }}
      title={text}
    >
      <style>{`
        @keyframes chunlv-announcement-lr {
          from { transform: translateX(-100%); }
          to { transform: translateX(100%); }
        }
      `}</style>
      <div
        style={{
          display: 'inline-block',
          color: '#E60000',
          fontSize: 13,
          fontWeight: 600,
          animation: 'chunlv-announcement-lr 22s linear infinite',
        }}
      >
        📢 {text}
      </div>
    </div>
  );
};

export default AnnouncementBar;
