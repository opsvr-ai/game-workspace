import { BadRequestException } from '@nestjs/common';

/**
 * 成对百分比（工作室 / 陪玩）的归一化。
 *
 * 老板 2026-09-21 要求：涉及百分比的地方都按「填一个、另一个自动算」处理，
 * 避免出现「工作室 60% + 陪玩 60% = 120%」这种配置。
 *
 * 口径：**陪玩那一栏才是真正参与算钱的比例**，工作室 = 剩余份额，
 * 所以这里以 `companion` 为准，把 `studio` 归一化成 `100 - companion`。
 * 对账（`reconciliation.service.ts` 用 `tier.studio` 算工作室流水）与
 * 结算（`settlement.service.ts` 用 `companion` 算陪玩分成）因此永远自洽。
 */
export interface ShareTierLike {
  min?: number | null;
  max?: number | null;
  companion?: number | null;
  studio?: number | null;
  [key: string]: unknown;
}

/** 陪玩分成比例必须在 0-100 之间。 */
export function parseCompanionPercent(value: unknown, label = '陪玩分成比例'): number {
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new BadRequestException(`${label}必须在 0-100 之间`);
  }
  return pct;
}

/** 把阶梯归一化成「工作室 = 100 - 陪玩」，两栏合计恒为 100%。 */
export function normalizeShareTiers<T extends ShareTierLike>(
  tiers: T[],
): Array<T & { companion: number; studio: number }> {
  return tiers.map((tier) => {
    const companion = parseCompanionPercent(tier?.companion);
    return { ...tier, companion, studio: 100 - companion };
  });
}
