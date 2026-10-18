/**
 * 一段服务「算不算数」的统一口径（老板 2026-10-18）。
 *
 * 背景：陪玩点「开始首单」后立刻点「结束服务」，就能刷首单成功率 / 续单率 / 复购率 /
 * 段位业绩。现在 KPI 只认「实际服务时长 ≥ 10 分钟」的段：
 *   · 不到 10 分钟：单子仍然可以结束（客户临时有事不能强行卡住），
 *     但不进首单成功率 / 续单率 / 复购率 / 最近 30 天业绩，也不参与段位；
 *   · 老数据 / 测试数据没有 startedAt/endedAt 的，按有效处理，避免误伤历史统计。
 *
 * 注意：这是 KPI 口径，不是「禁止结束服务」；客服/店长仍可正常结束短单。
 */
export const MIN_VALID_SERVICE_MINUTES = 10;
export const MIN_VALID_SERVICE_MS = MIN_VALID_SERVICE_MINUTES * 60 * 1000;

export function isValidServiceSession(s: {
  startedAt?: Date | string | null;
  endedAt?: Date | string | null;
  totalPausedSec?: number | null;
}): boolean {
  // 历史数据 / 单测 mock 没有时间戳：按有效处理（生产 DONE 段一定有 startedAt/endedAt）。
  if (!s.startedAt || !s.endedAt) return true;
  const start = new Date(s.startedAt).getTime();
  const end = new Date(s.endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  const pausedMs = Math.max(0, Number(s.totalPausedSec) || 0) * 1000;
  return end - start - pausedMs >= MIN_VALID_SERVICE_MS;
}
