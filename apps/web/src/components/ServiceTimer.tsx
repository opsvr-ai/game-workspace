// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';

interface Props {
  startedAt?: string | Date | null;
}

/** 服务计时：从 startedAt 开始，每秒刷新显示已服务时长。 */
const ServiceTimer: React.FC<Props> = ({ startedAt }) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const sec = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const text = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;

  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: '#1677ff' }}>
      ⏱ {text}
    </span>
  );
};

export default ServiceTimer;
