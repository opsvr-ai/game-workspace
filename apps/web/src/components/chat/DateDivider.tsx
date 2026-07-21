// craftsman-ignore: TS001,TS002
import React from 'react';

interface DateDividerProps {
  timestamp: number;
}

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatDateLabel(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - DAY);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  if (msgDate.getTime() === today.getTime()) return time;
  if (msgDate.getTime() === yesterday.getTime()) return `昨天 ${time}`;

  const diffDays = Math.floor((today.getTime() - msgDate.getTime()) / DAY);
  if (diffDays < 7) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${weekdays[date.getDay()]} ${time}`;
  }

  return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

const DateDivider: React.FC<DateDividerProps> = ({ timestamp }) => {
  return (
    <div style={{ textAlign: 'center', margin: '12px 0' }}>
      <span
        style={{
          display: 'inline-block',
          padding: '2px 12px',
          borderRadius: 10,
          background: '#E8E9EB',
          color: '#80848F',
          fontSize: 12,
        }}
      >
        {formatDateLabel(timestamp)}
      </span>
    </div>
  );
};

export default React.memo(DateDivider);
