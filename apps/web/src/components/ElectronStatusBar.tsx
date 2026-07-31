import React, { useEffect, useState, useRef } from 'react';

const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

const STYLE_ID = 'electron-status-bar-styles';
const CSS = `
@keyframes esb-slide-in {
  0% { transform: translateY(-100%); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}
@keyframes esb-collapse {
  0% { max-height: 40px; opacity: 1; }
  80% { max-height: 4px; opacity: 0.6; }
  100% { max-height: 4px; opacity: 0.85; }
}
@keyframes esb-pulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
@keyframes esb-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.esb-container {
  position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
  overflow: hidden;
}
.esb-banner {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 16px; font-size: 14px; font-weight: 600; color: #fff;
  background-size: 200% 100%;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  animation: esb-slide-in 0.4s ease-out;
  text-shadow: 0 1px 2px rgba(0,0,0,0.2);
  cursor: default; user-select: none;
  transition: all 0.6s ease;
}
.esb-banner.collapsed {
  padding: 0 16px; font-size: 0; gap: 0;
  max-height: 4px; min-height: 4px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
  animation: esb-collapse 0.6s ease-in forwards;
}
.esb-banner.collapsed .esb-label,
.esb-banner.collapsed .esb-icon { opacity: 0; transition: opacity 0.3s; }
.esb-icon { font-size: 18px; flex-shrink: 0; }
.esb-label { white-space: nowrap; transition: opacity 0.3s; }
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

interface StatusPreset {
  label: string;
  icon: string;
  gradient: string;
  color: string;
  barAnim: string;
}

const STATUS_MAP: Record<string, StatusPreset> = {
  AVAILABLE: {
    label: '空闲中 — 等待接单',
    icon: '🟢',
    gradient: 'linear-gradient(110deg, #16a34a, #22c55e, #4ade80, #22c55e)',
    color: '#22c55e',
    barAnim: 'esb-pulse 3s ease-in-out infinite',
  },
  BUSY: {
    label: '接单中 — 服务中',
    icon: '🔴',
    gradient: 'linear-gradient(110deg, #dc2626, #ef4444, #f87171, #ef4444)',
    color: '#ef4444',
    barAnim: 'esb-pulse 1.2s ease-in-out infinite',
  },
  ENTERTAINMENT: {
    label: '娱乐中 — 休息放松',
    icon: '🎮',
    gradient: 'linear-gradient(110deg, #ca8a04, #eab308, #facc15, #eab308)',
    color: '#eab308',
    barAnim: 'esb-shimmer 2s linear infinite',
  },
  RESTING: {
    label: '休息中 — 暂不接单',
    icon: '🟠',
    gradient: 'linear-gradient(110deg, #ea580c, #f97316, #fb923c, #f97316)',
    color: '#f97316',
    barAnim: 'esb-pulse 5s ease-in-out infinite',
  },
  OFFLINE: {
    label: '离线',
    icon: '⚫',
    gradient: '#9ca3af',
    color: '#9ca3af',
    barAnim: 'none',
  },
};

const DEFAULT: StatusPreset = {
  label: '',
  icon: '',
  gradient: '#6b7280',
  color: '#6b7280',
  barAnim: 'none',
};

const COLLAPSE_DELAY = 3000; // banner stays expanded for 3s

const ElectronStatusBar: React.FC = () => {
  const [status, setStatus] = useState<string>('');
  const [collapsed, setCollapsed] = useState(true);
  const [visible, setVisible] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const showBanner = (newStatus: string) => {
    setStatus(newStatus);
    setCollapsed(false);
    setVisible(true);

    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setCollapsed(true), COLLAPSE_DELAY);
  };

  useEffect(() => {
    mountedRef.current = true;
    if (!isElectron) return;

    injectStyles();

    let lastSeen = '';

    const poll = async () => {
      try {
        const api = (window as any).electronAPI;
        if (!api || !mountedRef.current) return;
        const s = (await api.storeGet('lastStatus')) as string;
        if (s && s !== lastSeen) {
          lastSeen = s;
          showBanner(s);
        }
      } catch {
        /* ignore */
      }
    };

    poll();
    const interval = setInterval(poll, 1500);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    };
  }, []);

  if (!isElectron || !visible) return null;

  const preset = STATUS_MAP[status] || DEFAULT;

  return (
    <div className="esb-container">
      <div
        className={`esb-banner${collapsed ? ' collapsed' : ''}`}
        style={{
          background: preset.gradient,
          backgroundSize: '200% 100%',
          animation: collapsed ? undefined : 'esb-slide-in 0.4s ease-out',
          ...(collapsed
            ? {
                animation: preset.barAnim !== 'none' ? preset.barAnim : undefined,
              }
            : {}),
        }}
      >
        <span className="esb-icon">{preset.icon}</span>
        <span className="esb-label">{preset.label}</span>
      </div>
    </div>
  );
};

export default ElectronStatusBar;
