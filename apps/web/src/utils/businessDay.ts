/**
 * 营业日边界：以每日 12:00 为界。
 * - 00:00–11:59 计入前一营业日
 * - 12:00–23:59 计入当日
 */
export function currentBusinessDayStart(now: Date = new Date()): Date {
  const d = new Date(now);
  if (d.getHours() < 12) {
    d.setDate(d.getDate() - 1);
  }
  d.setHours(12, 0, 0, 0);
  return d;
}

/**
 * 营业日的日期键（YYYY-MM-DD）：12:00 之前算前一天。
 * 跟服务端 `common/business-day.ts` 的 businessDayKey 是同一套算法 ——
 * 「每日数据」按营业日取数，前端算区间必须跟服务端对齐，否则会差一天。
 */
export function businessDayKeyOf(when: Date | string | number = new Date()): string {
  const d = new Date(when);
  if (d.getHours() < 12) {
    d.setDate(d.getDate() - 1);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
