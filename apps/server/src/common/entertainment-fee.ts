/**
 * 娱乐费唯一口径（老板 2026-09-20 定：全系统只能有一处算娱乐费）。
 *
 * 规则：
 * - 当日流水（含今天打掉的存单，见 sumDepositPlayedToday）>= 「娱乐模式门槛」
 *   (entertainment.revenue_threshold) → 免单，收 0
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

/** 营业日窗口（12:00 为界由调用方算好传进来） */
export interface EntertainmentWindow {
  start: Date;
  end: Date;
}

/**
 * 今天「打存单」打掉的金额怎么分摊到人头上（主陪按 单价×时长，副陪按判定的那段总价）。
 * 纯函数，方便单测。
 */
export function depositPlayedCredit(session: any): Array<{ companionId: string | null; amount: number }> {
  const hours = Number(session?.duration) || 0;
  const unit = Number(session?.claimedPrice) || 0;
  const main = unit > 0 && hours > 0 ? unit * hours : Number(session?.amount) || 0;
  const co = Number(session?.coAmount) || 0;
  return [
    { companionId: session?.companionId ?? null, amount: roundToJiao(main) },
    { companionId: session?.coCompanionId ?? null, amount: roundToJiao(co) },
  ];
}

/**
 * 今天「打存单」打掉的金额（老板 2026-10-04）。
 *
 * 老板原话：「每天可能要有存单要打，存单打了 9 个小时，新增流水可能就没有，那也不能娱乐了？
 * 我想改成打存单也算在娱乐那个门槛里。」
 *
 * 为什么按订单算的「当日流水」会漏：老客户的存单多半是**加在老的续单上**打的
 * （`addSession`，父单 `createdAt` 还是当初首单那天），而当日流水按「订单 createdAt」取数，自然算不到今天。
 * 所以这里按**会话**补一份：今天结束、且 `paidByDeposit` 的会话，按 `claimedPrice × duration` 折算。
 * 父单本身就是今天建的（那笔钱已经在当日流水里）就不重复加。
 *
 * 返回 Map<陪玩ID, 金额>；一个会话可能同时给主陪和副陪各记一份。
 */
export async function sumDepositPlayedToday(
  prisma: any,
  companionIds: Array<string | null | undefined>,
  window: EntertainmentWindow,
): Promise<Map<string, number>> {
  const ids = Array.from(new Set(companionIds.filter((id): id is string => !!id)));
  const map = new Map<string, number>();
  if (!ids.length) return map;
  let rows: any[] = [];
  try {
    const res = await prisma.orderSession.findMany({
      where: {
        status: 'DONE',
        paidByDeposit: true,
        endedAt: { gte: window.start, lt: window.end },
        OR: [{ companionId: { in: ids } }, { coCompanionId: { in: ids } }],
      },
      select: {
        companionId: true,
        coCompanionId: true,
        duration: true,
        claimedPrice: true,
        amount: true,
        coAmount: true,
        parentOrder: { select: { createdAt: true } },
      },
    });
    rows = Array.isArray(res) ? res : [];
  } catch {
    // 读不到就当没有：娱乐门槛少算一点，别把娱乐功能整个搞挂
    rows = [];
  }
  const idSet = new Set(ids);
  for (const row of rows as any[]) {
    const created = row?.parentOrder?.createdAt ? new Date(row.parentOrder.createdAt).getTime() : 0;
    // 父单今天建的 → 那笔已经在「今日流水」里，别重复加
    if (created >= window.start.getTime() && created < window.end.getTime()) continue;
    for (const credit of depositPlayedCredit(row)) {
      if (!credit.companionId || !idSet.has(credit.companionId) || credit.amount <= 0) continue;
      map.set(credit.companionId, roundToJiao((map.get(credit.companionId) || 0) + credit.amount));
    }
  }
  return map;
}

/**
 * 娱乐门槛用的「当日流水」= 今天 DONE 单的流水 + 今天打掉的存单。
 * 全系统只有这一处口径（看板 / 工作台 / 余额预警共用）。
 */
export function entertainmentBasisRevenue(todayRevenue: number, depositPlayed: number): number {
  const a = Number.isFinite(todayRevenue) ? todayRevenue : 0;
  const b = Number.isFinite(depositPlayed) ? depositPlayed : 0;
  return roundToJiao(a + b);
}
