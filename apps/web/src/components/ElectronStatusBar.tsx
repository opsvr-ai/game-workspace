import React, { useEffect, useState, useRef, useCallback } from 'react';

const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

const STYLE_ID = 'esb-bar';
const CSS = `
@keyframes esb-fill {
  0%   { width: 0%; }
  100% { width: 100%; }
}
.esb-bar {
  position: fixed; top: 0; left: 0; z-index: 9999;
  height: 5px; pointer-events: none;
}
.esb-fill {
  height: 100%;
  border-radius: 0 3px 3px 0;
  box-shadow: 0 0 10px currentColor, 0 0 4px currentColor;
  animation: esb-fill 1s ease-out forwards;
}
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

const COLORS: Record<string, string> = {
  AVAILABLE: '#22c55e',
  BUSY: '#ef4444',
  ENTERTAINMENT: '#eab308',
  RESTING: '#f97316',
};

const ElectronStatusBar: React.FC = () => {
  const [status, setStatus] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const mountedRef = useRef(true);
  const companionIdRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = useCallback((s: string) => {
    if (!COLORS[s]) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    // Force remount to replay CSS animation
    setTick((n) => n + 1);
    setStatus(s);
    timerRef.current = setTimeout(() => setStatus(null), 1300);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!isElectron) return;
    injectStyles();

    const api = (window as any).electronAPI;
    if (!api) return;

    // Get companionId
    api.storeGet('companionId').then((id: string) => {
      companionIdRef.current = id || '';
    });

    // Listen to WebSocket status broadcasts — most reliable path
    const unsub = api.onWsEvent?.('ws:statusBroadcast', (data: any) => {
      if (
        mountedRef.current &&
        companionIdRef.current &&
        data?.companionId === companionIdRef.current &&
        data?.status
      ) {
        trigger(data.status);
      }
    });

    // Fallback poll (in case onWsEvent doesn't fire)
    let lastSeen = '';
    const poll = async () => {
      try {
        if (!mountedRef.current) return;
        const s = await api.storeGet('lastStatus');
        if (s && s !== lastSeen) {
          lastSeen = s;
          // Only fire if onWsEvent didn't already trigger for this
          // This is a fallback, so don't worry about double-fire
          trigger(s);
        }
      } catch {
        /* */
      }
    };
    poll();
    const interval = setInterval(poll, 1500);

    return () => {
      mountedRef.current = false;
      if (unsub) unsub();
      clearInterval(interval);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [trigger]);

  if (!isElectron || !status || !COLORS[status]) return null;

  const color = COLORS[status];

  return (
    <div className="esb-bar" key={`s-${tick}`}>
      <div className="esb-fill" style={{ background: color, color }} />
    </div>
  );
};

export default ElectronStatusBar;
