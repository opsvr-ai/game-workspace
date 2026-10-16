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

/** 营业日的日期键（YYYY-MM-DD），用于前端选择「补报哪一天」 */
export function businessDayKey(date: Date): string {
  const d = businessDayOf(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

/**
 * 当前营业日 12:00 起点 —— **按北京时间算出来的绝对时刻**。
 *
 * 上面那套 `businessDayOf` / `currentBusinessDayRange` 用的是「进程本地时区」：
 * 服务器跑在 UTC（腾讯云默认），拿它们算边界会比国内客服的浏览器差 8 小时 ——
 * 中午 12 点刚过、客服想看新营业日的数，结果还在旧营业日上（或者反过来）。
 * 凡是要跟浏览器（北京时间）对齐的营业日计算，一律走这个。
 */
export function currentBusinessDayStartCn(now: Date = new Date()): Date {
  const CN_OFFSET_MS = 8 * 60 * 60 * 1000;
  const cn = new Date(now.getTime() + CN_OFFSET_MS);
  if (cn.getUTCHours() < BUSINESS_DAY_BOUNDARY_HOUR) {
    cn.setUTCDate(cn.getUTCDate() - 1);
  }
  const boundaryUtcMs =
    Date.UTC(
      cn.getUTCFullYear(),
      cn.getUTCMonth(),
      cn.getUTCDate(),
      BUSINESS_DAY_BOUNDARY_HOUR,
      0,
      0,
      0,
    ) - CN_OFFSET_MS;
  return new Date(boundaryUtcMs);
}

/** 对局时长容忍度（分钟）：计时差异在此范围内不标记异常 */
export const ROUND_TOLERANCE_MINUTES = 20;
export const ROUND_TOLERANCE_MAX_MINUTES = 30;

/** 判断两个时长的分钟差是否在容忍度内 */
export function withinRoundTolerance(aMinutes: number, bMinutes: number): boolean {
  return Math.abs(aMinutes - bMinutes) <= ROUND_TOLERANCE_MAX_MINUTES;
}
