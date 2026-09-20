import { BadRequestException } from '@nestjs/common';

/**
 * 百分比（工作室 / 陪玩 / 店长 / 客服）的归一化。
 *
 * 老板 2026-09-21 要求：涉及百分比的地方都按「填一个、另一个自动算」处理，
 * 避免出现「工作室 60% + 陪玩 60% = 120%」这种配置。
 *
 * 口径：**陪玩那一栏才是真正参与算钱的比例**，工作室 = 剩余份额，
 * 所以这里以 `companion` 为准，把 `studio` 归一化成 `100 − companion − 店长 − 客服`。
 * （`deductPercent` 就是店长 + 客服那两个比例之和 —— 老板 2026-09-21：
 * 不管线下还是线上，一单流水由 工作室 / 店长 / 客服 / 陪玩 四个人分，
 * 店长与客服拿的也是工作室那一份，所以工作室真正到手的份额要把这两项减掉。）
 * 对账（`reconciliation.service.ts` 用 `tier.studio` 算工作室流水）与
 * 结算（`settlement.service.ts` 用 `companion` 算陪玩分成）因此永远自洽，
 * 界面上「工作室」那一行显示的数字也和库里存的一致。
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

/**
 * 把阶梯归一化成「工作室 = 100 − 陪玩 − `deductPercent`」。
 *
 * `deductPercent` 传「店长 + 客服」的比例之和（默认 0 = 只有陪玩和工作室两个人分）。
 * 结果不会小于 0（配错成负数时留给上层的四人口径校验去报错，这里只保证不出现负比例）。
 */
export function normalizeShareTiers<T extends ShareTierLike>(
  tiers: T[],
  deductPercent = 0,
): Array<T & { companion: number; studio: number }> {
  const deduct = Number.isFinite(Number(deductPercent)) ? Number(deductPercent) : 0;
  return tiers.map((tier) => {
    const companion = parseCompanionPercent(tier?.companion);
    const studio = Math.round((100 - companion - deduct) * 100) / 100;
    return { ...tier, companion, studio };
  });
}
