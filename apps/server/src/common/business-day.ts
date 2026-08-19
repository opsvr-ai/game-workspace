/**
 * 营业日边界：以每日 12:00 为界。
 * - 00:00–11:59 计入前一营业日
 * - 12:00–23:59 计入当日
 */

export const BUSINESS_DAY_BOUNDARY_HOUR = 12;

/** 返回某个时间点所属的营业日（归零到当日 00:00） */
export function businessDayOf(date: Date): Date {
  const d = new Date(date.getTime());
  if (d.getHours() < BUSINESS_DAY_BOUNDARY_HOUR) {
    d.setDate(d.getDate() - 1);
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 结算月范围：当月 1 日 12:00（含）至次月 1 日 12:00（不含） */
export function settlementMonthRange(month: string): { start: Date; end: Date } {
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(year, mon - 1, 1, BUSINESS_DAY_BOUNDARY_HOUR, 0, 0, 0);
  const end = new Date(year, mon, 1, BUSINESS_DAY_BOUNDARY_HOUR, 0, 0, 0);
  return { start, end };
}

/** 营业日范围：day='YYYY-MM-DD' 的营业日从当日 12:00 至次日 12:00（不含） */
export function businessDayRange(day: string): { start: Date; end: Date } {
  const [year, mon, d] = day.split('-').map(Number);
  const start = new Date(year, mon - 1, d, BUSINESS_DAY_BOUNDARY_HOUR, 0, 0, 0);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** 当前营业日范围：当日 12:00（含）至次日 12:00（不含） */
export function currentBusinessDayRange(now: Date = new Date()): { start: Date; end: Date } {
  const day = businessDayOf(now);
  const start = new Date(day);
  start.setHours(BUSINESS_DAY_BOUNDARY_HOUR, 0, 0, 0);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** 当前结算月范围：本月 1 日 12:00（含）至次月 1 日 12:00（不含） */
export function currentSettlementMonthRange(now: Date = new Date()): { start: Date; end: Date } {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return settlementMonthRange(month);
}

/** 对局时长容忍度（分钟）：计时差异在此范围内不标记异常 */
export const ROUND_TOLERANCE_MINUTES = 20;
export const ROUND_TOLERANCE_MAX_MINUTES = 30;

/** 判断两个时长的分钟差是否在容忍度内 */
export function withinRoundTolerance(aMinutes: number, bMinutes: number): boolean {
  return Math.abs(aMinutes - bMinutes) <= ROUND_TOLERANCE_MAX_MINUTES;
}
