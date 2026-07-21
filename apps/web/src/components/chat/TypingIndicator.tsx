// craftsman-ignore: TS001,TS002
import React from 'react';

const TypingIndicator: React.FC = () => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', marginLeft: 48 }}>
      <div
        style={{
          background: '#F2F3F5',
          borderRadius: '18px 18px 18px 4px',
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="typing-dot"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#A0A4AC',
              display: 'inline-block',
              animation: `typingDot 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
        <style>{`
          @keyframes typingDot {
            0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
            30% { transform: translateY(-6px); opacity: 1; }
          }
        `}</style>
      </div>
      <span style={{ color: '#949BA4', fontSize: 12 }}>正在输入...</span>
    </div>
  );
};

export default React.memo(TypingIndicator);
