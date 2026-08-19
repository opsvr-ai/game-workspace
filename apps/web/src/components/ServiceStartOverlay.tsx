import React, { useEffect, useRef, useState } from 'react';
import { Progress } from 'antd';

// 服务开始后的「进入接单中，用心服务」过渡：粗进度条走满后自动进入接单状态提示。
const ServiceStartOverlay: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [percent, setPercent] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onStart = () => {
      setVisible(true);
      setPercent(0);
      if (timerRef.current) clearInterval(timerRef.current);
      if (hideRef.current) clearTimeout(hideRef.current);
      let p = 0;
      timerRef.current = setInterval(() => {
        p += 5;
        if (p >= 100) {
          p = 100;
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          hideRef.current = setTimeout(() => setVisible(false), 700);
        }
        setPercent(p);
      }, 60);
    };
    window.addEventListener('chunlv:service-started', onStart as EventListener);
    return () => {
      window.removeEventListener('chunlv:service-started', onStart as EventListener);
      if (timerRef.current) clearInterval(timerRef.current);
      if (hideRef.current) clearTimeout(hideRef.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 10001,
        width: 320,
        background: '#fff',
        borderRadius: 14,
        boxShadow: '0 10px 40px rgba(0,0,0,0.28)',
        padding: '18px 20px',
        borderLeft: '5px solid #52c41a',
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>🎧 进入接单中，用心服务</div>
      <Progress
        percent={percent}
        strokeWidth={18}
        status={percent >= 100 ? 'success' : 'active'}
        showInfo={false}
        strokeColor={{ from: '#52c41a', to: '#1677ff' }}
      />
      <div style={{ marginTop: 8, fontSize: 12, color: percent >= 100 ? '#52c41a' : '#888' }}>
        {percent >= 100 ? '✅ 已切换到接单状态' : '正在进入接单状态…'}
      </div>
    </div>
  );
};

export default ServiceStartOverlay;
