import React, { useEffect, useState, useRef } from 'react';

const COLORS: Record<string, string> = {
  AVAILABLE: '#22c55e',
  BUSY: '#ef4444',
  ENTERTAINMENT: '#eab308',
  RESTING: '#f97316',
};

const ElectronStatusBar: React.FC = () => {
  const [key, setKey] = useState(0);
  const [color, setColor] = useState('');
  const refs = useRef({ cid: '', last: '', alive: true, tm: null as any, initDone: false });

  const fire = (c: string) => {
    if (!c) return;
    clearTimeout(refs.current.tm);
    setKey((n) => n + 1);
    setColor(c);
    refs.current.tm = setTimeout(() => setColor(''), 1500);
  };

  useEffect(() => {
    refs.current.alive = true;
    const api = (window as any).electronAPI;
    if (!api) return; // Not in Electron

    // Inject CSS once
    if (!document.getElementById('esb-bar-css')) {
      const s = document.createElement('style');
      s.id = 'esb-bar-css';
      s.textContent = `
@keyframes esb-fill{0%{width:0%}100%{width:100%}}
.esb-bar{position:fixed;top:0;left:0;z-index:99999;height:5px;pointer-events:none}
.esb-fill{height:100%;border-radius:0 3px 3px 0;box-shadow:0 0 10px currentColor,0 0 4px currentColor;animation:esb-fill 1s ease-out forwards}
`;
      document.head.appendChild(s);
    }

    // Start init
    (async () => {
      try {
        const id: any = await api.storeGet('companionId');
        if (!refs.current.alive) return;
        refs.current.cid = String(id || '');
        refs.current.initDone = true;

        // Listen for WebSocket status broadcasts
        const unsub = api.onWsEvent?.('ws:statusBroadcast', (data: any) => {
          if (refs.current.alive && refs.current.cid && data?.companionId === refs.current.cid && data?.status) {
            const c = COLORS[data.status];
            if (c) fire(c);
          }
        });

        // Fallback: poll store
        const poll = async () => {
          try {
            if (!refs.current.alive) return;
            const s: any = await api.storeGet('lastStatus');
            if (s && s !== refs.current.last) {
              refs.current.last = String(s);
              const c = COLORS[String(s)];
              if (c) fire(c);
            }
          } catch { /* */ }
        };
        const iv = setInterval(poll, 1500);

        const deathWatch = setInterval(() => {
          if (!refs.current.alive) { clearInterval(deathWatch); unsub?.(); clearInterval(iv); }
        }, 200);
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
