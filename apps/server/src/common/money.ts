/**
 * 金额统一以「整数分」存储与计算：1 元 = 100 分。
 * 对外 API / 前端仍以元为单位，服务端在边界完成转换。
 */

export const CENTS_PER_YUAN = 100;

/** 元 → 分（四舍五入取整，避免浮点误差） */
export function yuanToCents(yuan: number): number {
  return Math.round((Number.isFinite(yuan) ? yuan : 0) * CENTS_PER_YUAN);
}

/** 分 → 元 */
export function centsToYuan(cents: number): number {
  return (Number.isFinite(cents) ? cents : 0) / CENTS_PER_YUAN;
}

/** 元 → 四舍五入到「毛」（1 位小数），用于报账/统计展示，避免精确到分 */
export function roundToJiao(yuan: number): number {
  return Math.round((Number.isFinite(yuan) ? yuan : 0) * 10) / 10;
}

/** 分求和（多笔金额累加，结果仍为整数分） */
export function sumCents(values: number[]): number {
  return values.reduce((sum, v) => sum + (Number.isFinite(v) ? Math.round(v) : 0), 0);
}

/** 元求和后转分 */
export function sumYuanToCents(values: number[]): number {
  return yuanToCents(values.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0));
}
