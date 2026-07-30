import React, { useEffect, useState, useCallback } from 'react';
import { keyframes } from '@emotion/react';

// Detect Electron environment
const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

// Animation keyframes per status
const breathe = keyframes`
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; }
`;

const pulse = keyframes`
  0%, 100% { opacity: 0.9; transform: scaleY(1); }
  50% { opacity: 1; transform: scaleY(1.15); }
`;

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

const flow = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`;

interface StatusConfig {
  label: string;
  color: string;
  gradient: string;
  animation: string;
  duration: string;
}

const statusConfigs: Record<string, StatusConfig> = {
  AVAILABLE: {
    label: '空闲中',
    color: '#22c55e',
    gradient: 'linear-gradient(90deg, #22c55e, #4ade80, #22c55e)',
    animation: `${breathe} 3s ease-in-out infinite`,
    duration: '3s',
  },
  BUSY: {
    label: '接单中',
    color: '#ef4444',
    gradient: 'linear-gradient(90deg, #ef4444, #f87171, #ef4444)',
    animation: `${pulse} 1.5s ease-in-out infinite`,
    duration: '1.5s',
  },
  ENTERTAINMENT: {
    label: '娱乐中',
    color: '#eab308',
    gradient: `linear-gradient(110deg, #eab308 0%, #facc15 20%, #fef08a 30%, #facc15 50%, #eab308 100%)`,
    animation: `${shimmer} 2.5s linear infinite`,
    duration: '2.5s',
  },
  RESTING: {
    label: '休息中',
    color: '#f97316',
    gradient: 'linear-gradient(90deg, #f97316, #fb923c, #f97316)',
    animation: `${breathe} 4s ease-in-out infinite`,
    duration: '4s',
  },
  OFFLINE: {
    label: '离线',
    color: '#9ca3af',
    gradient: '#9ca3af',
    animation: 'none',
    duration: '0s',
  },
};

const defaultConfig: StatusConfig = {
  label: '未知',
  color: '#6b7280',
  gradient: '#6b7280',
  animation: 'none',
  duration: '0s',
};

const ElectronStatusBar: React.FC = () => {
  const [status, setStatus] = useState<string>('OFFLINE');
  const [visible, setVisible] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const api = (window as any).electronAPI;
      if (!api) return;
      const s = (await api.storeGet('lastStatus')) as string;
      if (s && s !== status) {
        setStatus(s);
        setVisible(true);
      }
    } catch {
      // ignore
    }
  }, [status]);

  useEffect(() => {
    if (!isElectron) return;

    // Initial fetch
    fetchStatus();

    // Poll every 2 seconds
    const interval = setInterval(fetchStatus, 2000);

    // Also listen to WebSocket status events if available
    let cleanup: (() => void) | undefined;
    try {
      const api = (window as any).electronAPI;
      if (api?.onWsEvent) {
        cleanup = api.onWsEvent('ws:statusBroadcast', (data: any) => {
          // Only update if it's about our companion
          // ws:statusBroadcast contains { companionId, status }
          // We can't reliably match here without companionId, so skip
        });
      }
    } catch {
      // ignore
    }

    return () => {
      clearInterval(interval);
      if (cleanup) cleanup();
    };
  }, [fetchStatus]);

  if (!isElectron || !visible) return null;

  const config = statusConfigs[status] || defaultConfig;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        height: 4,
        background: config.gradient,
        backgroundSize: '200% 100%',
        animation: config.animation,
        boxShadow: `0 1px 6px ${config.color}40`,
        transition: 'all 0.5s ease',
      }}
      title={`当前状态：${config.label}`}
    >
      {/* Subtle glow effect */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: config.gradient,
          backgroundSize: '200% 100%',
          filter: 'blur(3px)',
          opacity: 0.5,
          animation: config.animation,
        }}
      />
    </div>
  );
};

export default ElectronStatusBar;
