/**
 * 百分比（0-100）通用工具。
 *
 * 老板 2026-09-21 要求：凡是**成对**的百分比（工作室 / 陪玩、陪玩 / 工作室），
 * 填一个另一个自动补足 100%，从源头上不可能出现「60 + 60 = 120%」这种配置。
 *
 * 口径：阶梯里**真正参与算钱的是陪玩那一栏**（工作室 = 剩余份额），
 * 所以两个框谁被改动，另一个一定是「100 − 改动值」，页面上显示的合计恒为 100%。
 */

/** 百分比的满值。 */
export const FULL_PERCENT = 100;

/** 夹到 [min, max]（默认 0-100），非数字一律按 min 处理。 */
export const clampPercent = (value: unknown, min = 0, max = FULL_PERCENT): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
};

/** 互补比例：填 60 就返回 40。 */
export const complementPercent = (value: unknown, total = FULL_PERCENT): number =>
  clampPercent(total - clampPercent(value, 0, total), 0, total);

/** 一组百分比是否刚好合计 100%（留 0.001 的浮点余量）。 */
export const isFullPercentTotal = (values: Array<number | null | undefined>): boolean =>
  Math.abs(sumPercent(values) - FULL_PERCENT) < 0.001;

/** 求和，非法值按 0 处理。 */
export const sumPercent = (values: Array<number | null | undefined>): number =>
  values.reduce<number>((sum, v) => sum + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);

/** 求和后抹掉浮点尾巴（0.1 + 0.2 = 0.30000000000000004）。 */
export const sumPercentRounded = (values: Array<number | null | undefined>): number =>
  Math.round(sumPercent(values) * 100) / 100;
