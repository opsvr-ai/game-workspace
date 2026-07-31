import React, { useEffect, useState, useRef, useCallback } from 'react';

const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

const STYLE_ID = 'esb-loading-bar';
const CSS = `
@keyframes esb-load {
  0%   { left: -100%; width: 30%; }
  30%  { left: 10%;  width: 50%; }
  60%  { left: 50%;  width: 40%; }
  90%  { left: 90%;  width: 10%; }
  100% { left: 100%; width: 0%; }
}
.esb-bar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
  height: 4px; overflow: hidden; pointer-events: none;
}
.esb-fill {
  position: absolute; top: 0; height: 100%;
  border-radius: 0 3px 3px 0;
  box-shadow: 0 0 10px currentColor, 0 0 4px currentColor;
  animation: esb-load 1.2s ease-in-out forwards;
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
  // Increment key to re-mount <div> so CSS animation replays
  const [tick, setTick] = useState(0);
  const mountedRef = useRef(true);
  const lastRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = useCallback((s: string) => {
    if (!COLORS[s]) return;
    setStatus(s);
    setTick((n) => n + 1);
    // Auto-hide after animation completes
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStatus(null), 1500);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!isElectron) return;
    injectStyles();

    const poll = async () => {
      try {
        const api = (window as any).electronAPI;
        if (!api || !mountedRef.current) return;
        const s = (await api.storeGet('lastStatus')) as string;
        if (s && s !== lastRef.current) {
          lastRef.current = s;
          trigger(s);
        }
      } catch {
        /* */
      }
    };

    poll();
    const interval = setInterval(poll, 1000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [trigger]);

  if (!isElectron || !status || !COLORS[status]) return null;

  const color = COLORS[status];

  return (
    <div className="esb-bar" key={tick}>
      <div className="esb-fill" style={{ background: color, color }} />
    </div>
  );
};

export default ElectronStatusBar;
