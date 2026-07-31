import React, { useEffect, useState, useRef } from 'react';

const eapi = typeof window !== 'undefined' ? (window as any).electronAPI : null;
const isElectron = !!eapi;

const CSS = `
@keyframes esb-fill {
  0%   { width: 0%; }
  100% { width: 100%; }
}
.esb-bar {
  position: fixed; top: 0; left: 0; z-index: 99999;
  height: 5px; pointer-events: none;
}
.esb-fill {
  height: 100%;
  border-radius: 0 3px 3px 0;
  box-shadow: 0 0 10px currentColor, 0 0 4px currentColor;
  animation: esb-fill 1s ease-out forwards;
}
`;

let injected = false;
function inject() {
  if (injected || document.getElementById('esb-bar-css')) return;
  injected = true;
  const s = document.createElement('style');
  s.id = 'esb-bar-css';
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
  const [tick, setTick] = useState(0);
  const [color, setColor] = useState('');
  const refs = useRef({ cid: '', last: '', alive: true, tm: null as any });

  // Trigger bar animation
  const fire = (s: string) => {
    const c = COLORS[s];
    if (!c) return;
    clearTimeout(refs.current.tm);
    // Use tick change to remount <div> → replay CSS animation
    setTick((n) => n + 1);
    setColor(c);
    refs.current.tm = setTimeout(() => setColor(''), 1300);
  };

  useEffect(() => {
    refs.current.alive = true;
    if (!isElectron) return;
    inject();

    // Get companion ID first, then subscribe
    eapi.storeGet('companionId').then((id: any) => {
      if (!refs.current.alive) return;
      refs.current.cid = String(id || '');

      // Listen to ws:statusBroadcast forwarded from main process
      const unsub = eapi.onWsEvent?.('ws:statusBroadcast', (data: any) => {
        if (refs.current.alive && refs.current.cid && data?.companionId === refs.current.cid && data?.status) {
          fire(data.status);
        }
      });

      // Fallback poll
      const poll = async () => {
        try {
          if (!refs.current.alive) return;
          const s: any = await eapi.storeGet('lastStatus');
          if (s && s !== refs.current.last) {
            refs.current.last = String(s);
            fire(String(s));
          }
        } catch {
          /* */
        }
      };
      poll();
      const iv = setInterval(poll, 2000);

      // cleanup
      const cleanup = () => {
        unsub?.();
        clearInterval(iv);
      };
      // poll for unmount
      const deathWatch = setInterval(() => {
        if (!refs.current.alive) {
          clearInterval(deathWatch);
          cleanup();
        }
      }, 200);
    });

    return () => {
      refs.current.alive = false;
      clearTimeout(refs.current.tm);
    };
  }, []);

  if (!isElectron || !color) return null;

  return (
    <div className="esb-bar" key={`k${tick}`}>
      <div className="esb-fill" style={{ background: color, color }} />
    </div>
  );
};

export default ElectronStatusBar;
