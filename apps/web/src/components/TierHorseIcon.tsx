import React from 'react';

interface Props {
  tier: 'TOP' | 'MIDDLE' | 'LOW';
}

/**
 * 段位马图标：上等马显示「王冠戴在马头顶」的竖排组合（纯 emoji 没有现成的戴冠马）。
 */
const TierHorseIcon: React.FC<Props> = ({ tier }) => {
  if (tier === 'TOP') {
    return (
      <span
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          lineHeight: 1,
          verticalAlign: 'middle',
        }}
      >
        <span style={{ fontSize: '0.6em', lineHeight: 1 }}>👑</span>
        <span style={{ fontSize: '1em', lineHeight: 1, marginTop: '-0.12em' }}>🐴</span>
      </span>
    );
  }
  return <span>{tier === 'MIDDLE' ? '🐎' : '🐴'}</span>;
};

export default TierHorseIcon;
