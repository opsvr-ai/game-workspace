/**
 * 娱乐费唯一口径（老板 2026-09-20 定：全系统只能有一处算娱乐费）。
 *
 * 规则：
 * - 当日流水 >= 「娱乐模式门槛」(entertainment.revenue_threshold) → 免单，收 0
 * - 否则按 entertainment.hourly_rate（元/小时）折算到分钟，四舍五入到角
 *
 * 费率由老板在「系统设置」里填，线上填 0 就是全免。
 * 看板、工作台、搭档接单结算、娱乐余额预警一律走这里，避免四处算法不一致。
 */
import { roundToJiao } from './money';
import { resolveConfigsRaw } from './studio-config';

/** 没配置时的兜底费率（元/小时） */
export const DEFAULT_ENTERTAINMENT_HOURLY_RATE = 60;
/** 没配置时的兜底免单线（元/当日流水） */
export const DEFAULT_ENTERTAINMENT_FREE_REVENUE = 0;

export interface EntertainmentRule {
  /** 元/小时 */
  hourlyRate: number;
  /** 当日流水达到这个数就免单 */
  freeThreshold: number;
}

/**
 * 从配置读取娱乐计费规则（找不到配置就用兜底值）。
 *
 * `studioId` 传入时按「本店店长填的 → 老板全局默认 → 代码兜底」解析，
 * 不传就是老板全局值（原来的行为）。
 */
export async function loadEntertainmentRule(
  prisma: any,
  studioId?: string | null,
): Promise<EntertainmentRule> {
  const cfg = await resolveConfigsRaw(prisma, studioId, [
    'entertainment.hourly_rate',
    'entertainment.revenue_threshold',
  ]);
  const rateRaw = cfg['entertainment.hourly_rate'];
  const thresholdRaw = cfg['entertainment.revenue_threshold'];
  return {
    hourlyRate: typeof rateRaw === 'number' ? rateRaw : DEFAULT_ENTERTAINMENT_HOURLY_RATE,
    freeThreshold:
      typeof thresholdRaw === 'number' ? thresholdRaw : DEFAULT_ENTERTAINMENT_FREE_REVENUE,
  };
}

/** 这笔娱乐该收多少钱（元，四舍五入到角） */
export function computeEntertainmentFee(params: {
  /** 娱乐分钟数，允许小数 */
  minutes: number;
  /** 该陪玩当日已完成流水（元） */
  todayRevenue: number;
  hourlyRate: number;
  freeThreshold: number;
}): number {
  const minutes = Number.isFinite(params.minutes) ? params.minutes : 0;
  const hourlyRate = Number.isFinite(params.hourlyRate) ? params.hourlyRate : 0;
  const todayRevenue = Number.isFinite(params.todayRevenue) ? params.todayRevenue : 0;
  const freeThreshold = Number.isFinite(params.freeThreshold) ? params.freeThreshold : 0;
  if (minutes <= 0 || hourlyRate <= 0) return 0;
  if (freeThreshold > 0 && todayRevenue >= freeThreshold) return 0;
  return roundToJiao(minutes * (hourlyRate / 60));
}

/** 当日流水是否已达免单线 */
export function isEntertainmentFree(todayRevenue: number, freeThreshold: number): boolean {
  return freeThreshold > 0 && todayRevenue >= freeThreshold;
}
