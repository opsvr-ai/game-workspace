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
