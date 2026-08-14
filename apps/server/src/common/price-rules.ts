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
  机密: { firstFloor: 35, renewFloor: 45, renewMax: 45 },
  绝密: { firstFloor: 45, renewFloor: 60, renewMax: 80 },
};

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
