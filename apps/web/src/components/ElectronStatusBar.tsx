import React, { useEffect, useState, useRef } from 'react';

const COLORS: Record<string, string> = {
  AVAILABLE: '#22c55e',
  BUSY: '#ef4444',
  ENTERTAINMENT: '#eab308',
  RESTING: '#f97316',
};

// Always-on debug bar to verify rendering
const DEBUG = true;

const ElectronStatusBar: React.FC = () => {
  const [key, setKey] = useState(0);
  const [color, setColor] = useState('');
  const refs = useRef({ alive: true, tm: null as any });

  const fire = (c: string) => {
    clearTimeout(refs.current.tm);
    setKey((n) => n + 1);
    setColor(c);
    refs.current.tm = setTimeout(() => setColor(''), 1500);
  };

  useEffect(() => {
    refs.current.alive = true;

    // Inject CSS
    if (!document.getElementById('esb-css')) {
      const s = document.createElement('style');
      s.id = 'esb-css';
      s.textContent = `@keyframes esb-fill{0%{width:0%}100%{width:100%}}.esb-bar{position:fixed;top:0;left:0;z-index:99999;height:5px;pointer-events:none}.esb-fill{height:100%;border-radius:0 3px 3px 0;box-shadow:0 0 10px currentColor,0 0 4px currentColor;animation:esb-fill 1s ease-out forwards}`;
      document.head.appendChild(s);
    }

    // Debug: flash green/red on mount to confirm component loaded
    if (DEBUG) fire('#22c55e');

    const api = (window as any).electronAPI;
    if (!api) {
      // Not Electron: debug bar already flashed green, component verified working
      return;
    }

    (async () => {
      try {
        const id = await api.storeGet('companionId');
        if (!refs.current.alive) return;
        const cid = String(id || '');

        const unsub = api.onWsEvent?.('ws:statusBroadcast', (data: any) => {
          if (refs.current.alive && cid && data?.companionId === cid && data?.status) {
            const c = COLORS[data.status];
            if (c) fire(c);
          }
        });

        let last = '';
        const iv = setInterval(async () => {
          if (!refs.current.alive) return;
          try {
            const s = await api.storeGet('lastStatus');
            if (s && s !== last) { last = String(s); const c = COLORS[String(s)]; if (c) fire(c); }
          } catch { /* */ }
        }, 1500);

        const dw = setInterval(() => { if (!refs.current.alive) { clearInterval(dw); unsub?.(); clearInterval(iv); } }, 200);
      } catch { /* */ }
    })();

    return () => { refs.current.alive = false; };
  }, []);

  if (!color) return null;

  return (
    <div className="esb-bar" key={`k${key}`}>
      <div className="esb-fill" style={{ background: color, color }} />
    </div>
  );
};

export default ElectronStatusBar;
