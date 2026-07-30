import React, { useEffect, useState, useCallback, useRef } from 'react';

// Detect Electron environment
const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

// CSS keyframes injected via <style> — no external dependencies
const STYLE_ID = 'electron-status-bar-styles';
const ANIMATION_CSS = `
@keyframes esb-breathe {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; }
}
@keyframes esb-pulse {
  0%, 100% { opacity: 0.9; transform: scaleY(1); }
  50% { opacity: 1; transform: scaleY(1.15); }
}
@keyframes esb-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.esb-bar {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 9999;
  height: 4px;
  background-size: 200% 100%;
  transition: all 0.5s ease;
}
.esb-glow {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-size: 200% 100%;
  filter: blur(3px);
  opacity: 0.5;
}
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = ANIMATION_CSS;
  document.head.appendChild(style);
}

interface StatusConfig {
  label: string;
  color: string;
  gradient: string;
  animation: string;
}

const statusConfigs: Record<string, StatusConfig> = {
  AVAILABLE: {
    label: '空闲中',
    color: '#22c55e',
    gradient: 'linear-gradient(90deg, #22c55e, #4ade80, #22c55e)',
    animation: 'esb-breathe 3s ease-in-out infinite',
  },
  BUSY: {
    label: '接单中',
    color: '#ef4444',
    gradient: 'linear-gradient(90deg, #ef4444, #f87171, #ef4444)',
    animation: 'esb-pulse 1.5s ease-in-out infinite',
  },
  ENTERTAINMENT: {
    label: '娱乐中',
    color: '#eab308',
    gradient: 'linear-gradient(110deg, #eab308 0%, #facc15 20%, #fef08a 30%, #facc15 50%, #eab308 100%)',
    animation: 'esb-shimmer 2.5s linear infinite',
  },
  RESTING: {
    label: '休息中',
    color: '#f97316',
    gradient: 'linear-gradient(90deg, #f97316, #fb923c, #f97316)',
    animation: 'esb-breathe 4s ease-in-out infinite',
  },
  OFFLINE: {
    label: '离线',
    color: '#9ca3af',
    gradient: '#9ca3af',
    animation: 'none',
  },
};

const defaultConfig: StatusConfig = {
  label: '未知',
  color: '#6b7280',
  gradient: '#6b7280',
  animation: 'none',
};

const ElectronStatusBar: React.FC = () => {
  const [status, setStatus] = useState<string>('OFFLINE');
  const [visible, setVisible] = useState(false);
  const mountedRef = useRef(true);

  const fetchStatus = useCallback(async () => {
    try {
      const api = (window as any).electronAPI;
      if (!api) return;
      const s = (await api.storeGet('lastStatus')) as string;
      if (s && s !== status && mountedRef.current) {
        setStatus(s);
        setVisible(true);
      }
    } catch {
      // ignore
    }
  }, [status]);

  useEffect(() => {
    mountedRef.current = true;
    if (!isElectron) return;

    injectStyles();
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchStatus]);

  if (!isElectron || !visible) return null;

  const config = statusConfigs[status] || defaultConfig;

  return (
    <div
      className="esb-bar"
      style={{
        background: config.gradient,
        animation: config.animation,
        boxShadow: `0 1px 6px ${config.color}40`,
      }}
      title={`当前状态：${config.label}`}
    >
      <div
        className="esb-glow"
        style={{
          background: config.gradient,
          animation: config.animation,
        }}
      />
    </div>
  );
};

export default ElectronStatusBar;
