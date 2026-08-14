/**
 * Pure-function utilities for companion/studio revenue split calculations.
 * Callers are responsible for loading config from the database and passing
 * the resolved values to these functions.
 */

export interface RevenueSplitTier {
  min: number;
  max: number | null;
  companion: number; // percentage, e.g. 50 means 50%
}

export interface RevenueSplitResult {
  mode: 'TIERED' | 'FIXED';
  /** Companion's percentage (0-100), e.g. 60 means 60% */
  companionPct: number;
  /** Companion's share as a decimal fraction (0.0-1.0), e.g. 0.6 */
  companionShare: number;
  /** Rounded monthly revenue (only populated for TIERED mode display) */
  monthlyRevenue?: number;
}

/** 线下阶梯（老板确认口径）：<5200 五五、5200–10000 六四、≥10000 七三（需满 6 个月） */
export const DEFAULT_TIERS: RevenueSplitTier[] = [
  { min: 0, max: 5199.99, companion: 50 },
  { min: 5200, max: 9999.99, companion: 60 },
  { min: 10000, max: null, companion: 70 },
];

/** 享受最高档（七三）所需的最低工龄（月） */
export const TENURE_MONTHS_FOR_TOP_TIER = 6;

/**
 * Resolve the applicable tier for a given total revenue.
 * Returns the last tier whose `min` is not greater than totalRevenue.
 * Robust against gaps between adjacent tier boundaries.
 */
export function resolveTier(totalRevenue: number, tiers: RevenueSplitTier[] = DEFAULT_TIERS): RevenueSplitTier {
  let match = tiers[0];
  for (const t of tiers) {
    if (totalRevenue >= t.min) match = t;
  }
  return match;
}

/**
 * Resolve companion percentage for TIERED mode with tenure gate:
 * the top 70% tier only applies when tenureMonths >= 6, otherwise falls back to 60%.
 */
export function resolveCompanionPctTiered(
  totalRevenue: number,
  tenureMonths: number,
  tiers: RevenueSplitTier[] = DEFAULT_TIERS,
): number {
  const tier = resolveTier(totalRevenue, tiers);
  if (tier.companion === 70 && tenureMonths < TENURE_MONTHS_FOR_TOP_TIER) {
    return 60;
  }
  return tier.companion;
}

/**
 * Compute companion percentage (0-100) for either TIERED or FIXED mode.
 */
export function computeSharePct(params: {
  splitMode: string;
  monthlyRevenue: number;
  tenureMonths?: number;
  revenueShare?: number | null;
  defaultClubSharePct?: number;
  tiers?: RevenueSplitTier[];
}): number {
  if (params.splitMode === 'FIXED') {
    const pct = params.revenueShare ? Math.round(params.revenueShare * 100) : (params.defaultClubSharePct ?? 80);
    return pct;
  }
  return resolveCompanionPctTiered(params.monthlyRevenue, params.tenureMonths ?? 0, params.tiers);
}

/**
 * Compute the companion's revenue split (as a decimal share 0.0-1.0).
 *
 * - FIXED mode: uses the companion's individual revenueShare, or defaults
 *   to the studio-wide defaultClubShare.
 * - TIERED mode: finds the tier matching totalRevenue and returns the tier's
 *   companion percentage.
 */
export function computeRevenueShare(params: {
  splitMode: string;
  totalRevenue: number;
  revenueShare?: number | null;
  defaultClubSharePct?: number;
  tiers?: RevenueSplitTier[];
}): number {
  const isFixed = params.splitMode === 'FIXED';

  if (isFixed) {
    const pct = params.revenueShare ? Math.round(params.revenueShare * 100) : (params.defaultClubSharePct ?? 80);
    return pct / 100;
  }

  const tiers = params.tiers ?? DEFAULT_TIERS;
  const tier = resolveTier(params.totalRevenue, tiers);
  return tier.companion / 100;
}

/**
 * Compute the full revenue split result with display-friendly fields.
 * Suitable for the workbench tierInfo response.
 */
export function computeRevenueSplit(params: {
  splitMode: string;
  totalRevenue: number;
  revenueShare?: number | null;
  defaultClubSharePct?: number;
  tiers?: RevenueSplitTier[];
  monthlyRevenue?: number;
}): RevenueSplitResult {
  const isFixed = params.splitMode === 'FIXED';

  if (isFixed) {
    const companionPct = params.revenueShare
      ? Math.round(params.revenueShare * 100)
      : (params.defaultClubSharePct ?? 80);
    return {
      mode: 'FIXED',
      companionPct,
      companionShare: companionPct / 100,
    };
  }

  const tiers = params.tiers ?? DEFAULT_TIERS;
  const tier = resolveTier(params.totalRevenue, tiers);
  return {
    mode: 'TIERED',
    companionPct: tier.companion,
    companionShare: tier.companion / 100,
    monthlyRevenue: params.monthlyRevenue != null ? Math.round(params.monthlyRevenue * 100) / 100 : undefined,
  };
}
