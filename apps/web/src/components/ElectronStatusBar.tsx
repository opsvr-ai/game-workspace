import React, { useEffect, useState, useRef, useCallback } from 'react';

const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
const isElectron = !!api;

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

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || document.getElementById(STYLE_ID)) return;
  stylesInjected = true;
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
  const readyRef = useRef(false);

  const trigger = useCallback((s: string) => {
    if (!COLORS[s]) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setTick((n) => n + 1);
    setStatus(s);
    timerRef.current = setTimeout(() => setStatus(null), 1300);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!isElectron) return;
    injectStyles();

    // Step 1: get companionId first (needed to filter WS events)
    api.storeGet('companionId').then((id: string) => {
      if (!mountedRef.current) return;
      companionIdRef.current = (id || '').toString();
      readyRef.current = true;

      // Step 2: now listen to WebSocket status broadcasts
      const unsub = api.onWsEvent?.('ws:statusBroadcast', (data: any) => {
        if (!mountedRef.current) return;
        const cid = companionIdRef.current;
        if (cid && data?.companionId === cid && data?.status) {
          trigger(data.status);
        }
      });

      // Step 3: poll as safety net
      let lastSeen = '';
      const poll = async () => {
        try {
          if (!mountedRef.current) return;
          const s = await api.storeGet('lastStatus');
          if (s && s !== lastSeen) {
            lastSeen = s;
            trigger(s);
          }
        } catch {
          /* */
        }
      };
      poll();
      const interval = setInterval(poll, 2000);

      // Store cleanup reference
      const cleanup = () => {
        clearInterval(interval);
        if (unsub) unsub();
      };

      // Override the return cleanup
      const origCleanup = () => {
        cleanup();
      };

      // Schedule cleanup
      const cleanupTimer = setInterval(() => {
        if (!mountedRef.current) {
          clearInterval(cleanupTimer);
          cleanup();
        }
      }, 100);
    });

    return () => {
      mountedRef.current = false;
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
