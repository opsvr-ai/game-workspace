/**
 * 娱乐费唯一口径（老板 2026-09-20 定：全系统只能有一处算娱乐费）。
 *
 * 规则：
 * - 当日业绩（含今天打掉的存单，见 sumDepositPlayedToday）>= 「娱乐模式门槛」
 *   (entertainment.revenue_threshold) → 免单，收 0
 * - 否则按 entertainment.hourly_rate（元/小时）折算到分钟，四舍五入到角
 *
 * 费率由老板在「系统设置」里填，线上填 0 就是全免。
 * 看板、工作台、搭档接单结算、娱乐业绩预警一律走这里，避免四处算法不一致。
 */
import { roundToJiao } from './money';
import { resolveConfigsRaw } from './studio-config';
import { companionOrderRevenue } from './order-revenue';
import { currentBusinessDayRange } from './business-day';

/** 没配置时的兜底费率（元/小时） */
export const DEFAULT_ENTERTAINMENT_HOURLY_RATE = 60;
/** 没配置时的兜底免单线（元/当日业绩） */
export const DEFAULT_ENTERTAINMENT_FREE_REVENUE = 0;

export interface EntertainmentRule {
  /** 元/小时 */
  hourlyRate: number;
  /** 当日业绩达到这个数就免单 */
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
  /** 该陪玩当日已完成业绩（元） */
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

/** 当日业绩是否已达免单线 */
export function isEntertainmentFree(todayRevenue: number, freeThreshold: number): boolean {
  return freeThreshold > 0 && todayRevenue >= freeThreshold;
}
/**
 * 刚进娱乐的宽限（秒）：这段时间内不因为「业绩判定」把人踢回空闲。
 * 见 checkEntertainmentEligibility 的注释 —— 防的是「刚进去就被踢」那种秒级来回。
 */
export const ENTERTAINMENT_GRACE_SECONDS = 60;

/** 业绩 + 押金还能玩多少分钟（费率 ≤ 0 = 全免 → 无限；钱为负/NaN 一律按 0 算）。 */
export function entertainmentMinutesLeft(availableFunds: number, hourlyRate: number): number {
  const rate = Number(hourlyRate);
  if (!Number.isFinite(rate) || rate <= 0) return Number.POSITIVE_INFINITY;
  const funds = Math.max(0, Number(availableFunds) || 0);
  return Math.floor(funds / (rate / 60));
}

export interface EntertainmentEligibility {
  /** 能不能进 / 该不该留在娱乐 */
  ok: boolean;
  /** 不给进 / 该踢回去的原因（给陪玩看的中文；ok = true 时是空串） */
  reason: string;
  /** 业绩还能玩几分钟（Infinity = 全免） */
  minutesLeft: number;
}

/**
 * 「能不能进 / 留不留在娱乐」的唯一判定（老板 2026-10-08）。
 *
 * 老板报的原话：「刚才张权选择娱乐模式，怎么把 python 杀了，三角洲也进不去？」
 * 查到的是这条链：**切娱乐时压根没判过「玩不玩得起」** —— 先让他进去，
 * 下一个心跳（≤30 秒）才发现业绩撑不住，再把他踢回空闲。
 * 这一进一出十几秒里，**娱乐名单（python.exe）和空闲名单（三角洲）各套了一遍**：
 * python 被杀、他一启动三角洲又被杀，而他根本没真正玩上娱乐。
 * 线上 2026-10-07 16:05:24 进娱乐 → 16:05:29 杀 python → 16:05:39 踢回空闲，就是这条链。
 *
 * 所以：**进之前先问一次**（context = 'enter'，撑不住就当场拒绝，娱乐名单根本不下发）；
 * 心跳里的兜底继续保留（context = 'stay'，玩到中途钱花完了才踢），而且刚进去的
 * ENTERTAINMENT_GRACE_SECONDS 内不踢，免得再出现「刚进去就被踢」的秒级来回。
 *
 * 判定口径跟扣费同一个：免单线到了随便玩；否则看业绩 + 押金够不够玩满 1 分钟。
 */
export function checkEntertainmentEligibility(params: {
  availableFunds: number;
  hourlyRate: number;
  freeThreshold: number;
  freeToday: boolean;
  /** enter = 切状态时判「能不能进」；stay = 心跳兜底判「该不该踢回空闲」。默认 enter。 */
  context?: 'enter' | 'stay';
  /** context = stay 时用：已经在娱乐里待了多久（秒）。 */
  elapsedSeconds?: number;
}): EntertainmentEligibility {
  const minutesLeft = entertainmentMinutesLeft(params.availableFunds, params.hourlyRate);
  if (params.freeToday || minutesLeft > 0) return { ok: true, reason: '', minutesLeft };
  // 宽限只管「已经进去了的人」：切状态那一下（enter）不能宽限，否则等于没判。
  const grace = params.context === 'stay' && (Number(params.elapsedSeconds) || 0) < ENTERTAINMENT_GRACE_SECONDS;
  if (grace) return { ok: true, reason: '', minutesLeft };
  const funds = Math.max(0, Number(params.availableFunds) || 0);
  const rate = Math.max(0, Number(params.hourlyRate) || 0);
  const line = Number(params.freeThreshold) > 0
    ? `今天业绩到 ¥${params.freeThreshold} 就免单`
    : '今天业绩免单线没开';
  return {
    ok: false,
    minutesLeft,
    reason: `业绩 + 押金不够玩娱乐（现在 ¥${funds}，娱乐 ¥${rate}/小时，${line}）—— 先充值或交押金，或者今天多打几单再进。`,
  };
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
 * 老板原话：「每天可能要有存单要打，存单打了 9 个小时，新增业绩可能就没有，那也不能娱乐了？
 * 我想改成打存单也算在娱乐那个门槛里。」
 *
 * 为什么按订单算的「当日业绩」会漏：老客户的存单多半是**加在老的续单上**打的
 * （`addSession`，父单 `createdAt` 还是当初首单那天），而当日业绩按「订单 createdAt」取数，自然算不到今天。
 * 所以这里按**会话**补一份：今天结束、且 `paidByDeposit` 的会话，按 `claimedPrice × duration` 折算。
 * 父单本身就是今天建的（那笔钱已经在当日业绩里）就不重复加。
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
    // 父单今天建的 → 那笔已经在「今日业绩」里，别重复加
    if (created >= window.start.getTime() && created < window.end.getTime()) continue;
    for (const credit of depositPlayedCredit(row)) {
      if (!credit.companionId || !idSet.has(credit.companionId) || credit.amount <= 0) continue;
      map.set(credit.companionId, roundToJiao((map.get(credit.companionId) || 0) + credit.amount));
    }
  }
  return map;
}

/**
 * 娱乐门槛用的「当日业绩」= 今天 DONE 单的业绩 + 今天打掉的存单。
 * 全系统只有这一处口径（看板 / 工作台 / 业绩预警共用）。
 */
export function entertainmentBasisRevenue(todayRevenue: number, depositPlayed: number): number {
  const a = Number.isFinite(todayRevenue) ? todayRevenue : 0;
  const b = Number.isFinite(depositPlayed) ? depositPlayed : 0;
  return roundToJiao(a + b);
}
/** 「能不能玩娱乐」要用到的全部数（业绩、费率、免单线、今日业绩 + 打掉的存单） */
export interface EntertainmentStanding {
  /** 业绩 + 押金 */
  availableFunds: number;
  hourlyRate: number;
  freeThreshold: number;
  /** 今日订单业绩（口径 A：主陪拿主陪金额、搭档拿搭档金额，谁的钱算谁的） */
  todayRevenue: number;
  /** 今天「打掉的存单」金额（老板 2026-10-04：也算进娱乐门槛） */
  depositPlayed: number;
  /** 门槛口径：今日业绩 + 打掉的存单 */
  basisRevenue: number;
  /** 今天业绩是否已到免单线 */
  freeToday: boolean;
  /** 数据库里此刻的状态（心跳那条要拿它确认「人还在娱乐里」） */
  status: string | null;
}

/**
 * 把「娱乐能不能玩 / 该收多少钱」需要的数一次查齐。
 *
 * 为什么抽成一个：**切状态**（能不能进娱乐）和**心跳兜底**（该不该踢回空闲）原来是各查各的，
 * 两处口径一旦不一致就会出现「能进、进去又被踢」（老板 2026-10-08 报的张权那单就是这个）。
 * 现在两处都走这里，判断也只有一个 checkEntertainmentEligibility。
 *
 * 查不到人（数据异常）时返回 null —— 调用方按「不拦人」处理，别因为查库失败把人卡在门外。
 */
export async function loadEntertainmentStanding(
  prisma: any,
  companionId: string,
  now: Date = new Date(),
): Promise<EntertainmentStanding | null> {
  const wallet = await prisma.companion
    .findUnique({
      where: { id: companionId },
      select: { balance: true, deposit: true, status: true, studioId: true },
    })
    .catch(() => null);
  if (!wallet) return null;

  const { hourlyRate, freeThreshold } = await loadEntertainmentRule(prisma, wallet.studioId ?? null);
  const { start: dayStart, end: dayEnd } = currentBusinessDayRange(now);
  const dayOrders = await prisma.order
    .findMany({
      where: {
        status: 'DONE',
        createdAt: { gte: dayStart, lt: dayEnd },
        OR: [{ companionId }, { coCompanionId: companionId }],
      },
      select: { companionId: true, coCompanionId: true, amount: true, coAmount: true, customFields: true },
    })
    .catch(() => [] as any[]);
  const todayRevenue = (dayOrders as any[]).reduce(
    (acc: number, o: any) => acc + companionOrderRevenue(o, companionId),
    0,
  );
  const depositPlayed = await sumDepositPlayedToday(prisma, [companionId], { start: dayStart, end: dayEnd })
    .then((m) => m.get(companionId) || 0)
    .catch(() => 0);
  const basisRevenue = entertainmentBasisRevenue(todayRevenue, depositPlayed);

  return {
    availableFunds: (wallet.balance || 0) + (wallet.deposit || 0),
    hourlyRate,
    freeThreshold,
    todayRevenue,
    depositPlayed,
    basisRevenue,
    freeToday: isEntertainmentFree(basisRevenue, freeThreshold),
    status: wallet.status ?? null,
  };
}

