import React from 'react';
import TierHorseIcon from './TierHorseIcon';
import { tierMeta } from '../constants/tiers';

interface Props {
  tier?: 'TOP' | 'MIDDLE' | 'LOW' | null;
  showLabel?: boolean;
}

/** 段位图标徽章：上等马=戴冠马+金色，中等马=银色，下等马=铜色。 */
const TierBadge: React.FC<Props> = ({ tier, showLabel = false }) => {
  const meta = tierMeta(tier);
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
      <TierHorseIcon tier={(tier || 'MIDDLE') as 'TOP' | 'MIDDLE' | 'LOW'} />
      {showLabel && <span>{meta.label}</span>}
    </span>
  );
};

export default TierBadge;
