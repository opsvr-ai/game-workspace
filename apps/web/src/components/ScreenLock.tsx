import React, { useState, useEffect, useRef } from 'react';

const PASS = '123456';

const ScreenLock: React.FC<{ onUnlock: () => void }> = ({ onUnlock }) => {
  const [val, setVal] = useState('');
  const [err, setErr] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [locked, setLocked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'F4') e.preventDefault();
      if (e.ctrlKey && e.key === 'w') e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSubmit = () => {
    if (val === PASS) {
      onUnlock();
    } else {
      setErr(true); setVal('');
      const a = attempts + 1;
      setAttempts(a);
      if (a >= 5) {
        setLocked(true);
        setTimeout(() => { setLocked(false); setAttempts(0); setErr(false); }, 30000);
      }
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 999999, background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 60, marginBottom: 20 }}>🔒</div>
        <div style={{ color: '#fff', fontSize: 18, marginBottom: 10 }}>休息中 · 屏幕已锁定</div>
        <div style={{ color: '#888', fontSize: 12, marginBottom: 20 }}>输入 App 密码解锁</div>
        <input
          ref={inputRef}
          type="password"
          value={val}
          disabled={locked}
          onChange={(e) => { setVal(e.target.value); setErr(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          style={{
            padding: '10px 20px', fontSize: 16, textAlign: 'center',
            border: `2px solid ${err ? '#FF4757' : '#00D4FF'}`, borderRadius: 8,
            background: '#111', color: '#fff', outline: 'none', width: 200,
          }}
          placeholder={locked ? '请等待30秒...' : '输入密码'}
        />
        {err && <div style={{ color: '#FF4757', fontSize: 12, marginTop: 10 }}>密码错误</div>}
      </div>
    </div>
  );
};

export default ScreenLock;
