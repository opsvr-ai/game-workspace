import React from 'react';
import TierHorseIcon from './TierHorseIcon';

const TIER_META: Record<string, { label: string; color: string }> = {
  TOP: { label: '上等马', color: '#D4A017' },
  MIDDLE: { label: '中等马', color: '#A9A9A9' },
  LOW: { label: '下等马', color: '#CD7F32' },
};

interface Props {
  tier?: 'TOP' | 'MIDDLE' | 'LOW' | null;
  showLabel?: boolean;
}

/** 段位图标徽章：上等马=戴冠马+金色，中等马=银色，下等马=铜色。 */
const TierBadge: React.FC<Props> = ({ tier, showLabel = false }) => {
  const meta = TIER_META[tier || 'LOW'] || TIER_META.LOW;
  return (
    <span
      title={meta.label}
      style={{
        color: meta.color,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <TierHorseIcon tier={(tier || 'LOW') as 'TOP' | 'MIDDLE' | 'LOW'} />
      {showLabel && <span>{meta.label}</span>}
    </span>
  );
};

export default TierBadge;
