import React, { useEffect, useState, useRef } from 'react';

const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

const STYLE_ID = 'esb-progress-styles';
const CSS = `
@keyframes esb-sweep {
  0%   { left: -100%; width: 40%; }
  50%  { left: 60%;  width: 40%; }
  100% { left: 100%; width: 0%; }
}
.esb-track {
  position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
  height: 4px; overflow: hidden;
  background: transparent;
}
.esb-sweep {
  position: absolute; top: 0; height: 100%;
  border-radius: 0 2px 2px 0;
  box-shadow: 0 0 8px currentColor;
  animation: esb-sweep 2s ease-in-out infinite;
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
  OFFLINE: '#9ca3af',
};

const ElectronStatusBar: React.FC = () => {
  const [color, setColor] = useState('#9ca3af');
  const [visible, setVisible] = useState(false);
  const mountedRef = useRef(true);
  const lastStatusRef = useRef('');

  useEffect(() => {
    mountedRef.current = true;
    if (!isElectron) return;
    injectStyles();

    const poll = async () => {
      try {
        const api = (window as any).electronAPI;
        if (!api || !mountedRef.current) return;
        const s = (await api.storeGet('lastStatus')) as string;
        if (s && s !== lastStatusRef.current) {
          lastStatusRef.current = s;
          setColor(COLORS[s] || '#9ca3af');
          setVisible(true);
        }
      } catch {
        /* */
      }
    };

    poll();
    const interval = setInterval(poll, 1500);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  if (!isElectron || !visible) return null;

  return (
    <div className="esb-track">
      <div className="esb-sweep" style={{ background: color, color }} />
    </div>
  );
};

export default ElectronStatusBar;
