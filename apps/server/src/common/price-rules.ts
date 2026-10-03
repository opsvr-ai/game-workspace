import { yuanToCents, centsToYuan } from './money';

/**
 * 游戏价格规则：首单底价与续单/复购价格区间（元/小时/人）。
 * 陪玩可在底价之上上浮报价；续单/复购不得低于续单下限。
 */
export interface ModePriceRule {
  firstFloor: number;
  renewFloor: number;
  renewMax: number;
}

export const MODE_PRICE_RULES: Record<string, ModePriceRule> = {
  // 老板 2026-10-04：「机密续单/复购 40-60 之间是正常的，绝密续单/复购 60-80 是正常的」
  机密: { firstFloor: 35, renewFloor: 40, renewMax: 60 },
  绝密: { firstFloor: 45, renewFloor: 60, renewMax: 80 },
};

/**
 * 单价「底线」统计口径（老板 2026-10-04）：
 *   「我认为机密别低于 35，绝密别低于 45 就没啥问题，这个 35 跟 45 就是个统计」
 *   —— 低于这条线**不拦单**，只记账 + 提醒，老板拿这个去重点看人。
 */
export const PRICE_STATS_FLOOR: Record<string, number> = {
  机密: 35,
  绝密: 45,
};

/**
 * 续单 / 复购的统计底线（老板 2026-10-04）：
 *   「我不说说了机密续单/复购 40-60 之间是正常的，绝密续单/复购 60-80 是正常的」
 *   —— 续单 / 复购拿来量 35 / 45 就是漏报（徐泽宁那对复购填 35，只进了统计没标红）。
 */
export const PRICE_STATS_FLOOR_RENEWAL: Record<string, number> = {
  机密: 40,
  绝密: 60,
};

/**
 * 这一段算不算「续单 / 复购」：
 *   · 订单本身就是续单 / 复购（`RENEW` / `REPURCHASE`）；
 *   · 或者这张单已经打到第 2 段及以后（`seq > 1`）—— 陪玩在客户管理里点「续单」是在原单上加一段，
 *     单子类型还是首单，光看类型会漏。
 */
export function isRenewalSegment(orderType?: string | null, seq?: number | null): boolean {
  if (orderType === 'RENEW' || orderType === 'REPURCHASE') return true;
  return typeof seq === 'number' && Number.isFinite(seq) && seq > 1;
}

/**
 * 这一段打的是机密还是绝密：优先陪玩自己确认的 `claimedMode`；
 * 陪玩没填（双陪复购那条路不经过 startSession，`claimedMode` 一直是空的）就退回客服发单时填的
 * `deltaMission` / `gameMode` —— 否则低价判断会整段漏掉（2026-10-04：徐泽宁那对复购就是这么漏的）。
 */
export function resolvePriceMode(claimedMode?: string | null, customFields?: any): string | null {
  if (claimedMode) return claimedMode;
  const cf = customFields || {};
  return cf.deltaMission ?? cf.gameMode ?? null;
}

/** 取某模式 + 是否续单/复购的统计底线；未知模式返回 undefined */
export function priceStatsFloor(mode: string | null | undefined, isRenewal = false): number | undefined {
  if (!mode) return undefined;
  const table = isRenewal ? PRICE_STATS_FLOOR_RENEWAL : PRICE_STATS_FLOOR;
  return table[mode];
}

/**
 * 单价是否低于底线（未知模式 / 没填单价 → 不算）。
 * `isRenewal = true` 时按续单 / 复购的线判（机密 40 / 绝密 60）。
 */
export function isBelowPriceFloor(
  mode: string | null | undefined,
  priceYuan: number | null | undefined,
  isRenewal = false,
): boolean {
  if (!mode || priceYuan == null || !Number.isFinite(priceYuan)) return false;
  const floor = priceStatsFloor(mode, isRenewal);
  if (floor == null) return false;
  return priceYuan < floor;
}

/**
 * 副陪单价（元/小时）= 副陪这一段会话的总价 / 时长。
 * 老板 2026-10-04：副陪的钱也是主陪填的，所以「副陪单价」要跟主陪价一样盯底线
 * （首单 机密 35 / 绝密 45，续单 / 复购 机密 40 / 绝密 60）；填 0 或低于底线就要提醒。
 * 没搭档 / 没填 → null（不参与判断）。
 */
export function partnerUnitPriceYuan(
  coAmount: number | null | undefined,
  duration: number | null | undefined,
): number | null {
  if (coAmount == null || !Number.isFinite(coAmount)) return null;
  const hours = duration != null && Number.isFinite(duration) && duration > 0 ? duration : 1;
  return coAmount / hours;
}

export type OrderTypeForPrice = 'FIRST' | 'RENEW';

/** 获取某模式的底价（首单/续单），未知模式返回 null */
export function floorPriceYuan(mode: string, isRenewal: boolean): number | null {
  const rule = MODE_PRICE_RULES[mode];
  if (!rule) return null;
  return isRenewal ? rule.renewFloor : rule.firstFloor;
}

/** 审核金额（分）= 填写时长（小时）× 声明单价（元/小时） */
export function auditAmountCents(filledHours: number, declaredPriceYuan: number): number {
  const yuan = (Number.isFinite(filledHours) ? filledHours : 0) * (Number.isFinite(declaredPriceYuan) ? declaredPriceYuan : 0);
  return yuanToCents(yuan);
}

export type TransferClassification = 'OK' | 'SHORT' | 'EXTRA';

/**
 * 转账截屏合计 vs 审核金额：
 * - 合计 >= 审核金额 → OK（超出部分视为加价/小费）
 * - 合计 <  审核金额 → SHORT（钱未到位或漏传通道）
 */
export function classifyTransferTotal(transferTotalCents: number, auditCents: number): TransferClassification {
  if (transferTotalCents > auditCents) return 'EXTRA';
  if (transferTotalCents < auditCents) return 'SHORT';
  return 'OK';
}

/** 加价部分（分），无加价返回 0 */
export function extraCents(transferTotalCents: number, auditCents: number): number {
  return transferTotalCents > auditCents ? transferTotalCents - auditCents : 0;
}

/** 参考计费时长（小时）= 实付金额（分）÷ 声明单价（元/小时） */
export function referenceHours(transferTotalCents: number, declaredPriceYuan: number): number {
  if (!declaredPriceYuan) return 0;
  return centsToYuan(transferTotalCents) / declaredPriceYuan;
}
