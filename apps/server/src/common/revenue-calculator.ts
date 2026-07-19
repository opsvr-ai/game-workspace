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

const DEFAULT_TIERS: RevenueSplitTier[] = [
  { min: 0, max: 5999.99, companion: 50 },
  { min: 6000, max: 9999, companion: 60 },
  { min: 10000, max: null, companion: 70 },
];

/**
 * Resolve the applicable tier for a given total revenue.
 * Returns the highest-matching tier, or the last tier as fallback.
 */
export function resolveTier(totalRevenue: number, tiers: RevenueSplitTier[] = DEFAULT_TIERS): RevenueSplitTier {
  const match = tiers.find((t) => totalRevenue >= t.min && (t.max === null || totalRevenue <= t.max));
  return match ?? tiers[tiers.length - 1];
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

  // TIERED
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

  // TIERED
  const tiers = params.tiers ?? DEFAULT_TIERS;
  const tier = resolveTier(params.totalRevenue, tiers);
  return {
    mode: 'TIERED',
    companionPct: tier.companion,
    companionShare: tier.companion / 100,
    monthlyRevenue: params.monthlyRevenue != null ? Math.round(params.monthlyRevenue * 100) / 100 : undefined,
  };
}
