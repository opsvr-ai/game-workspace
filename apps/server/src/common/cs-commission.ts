/**
 * 客服提成的「按人一套」+「只算首单」口径（老板 2026-09-30）。
 *
 * 老板原话：「邵、孙各自底薪多少？……桥接、线上每单多少？孙也照用，还是他单独一套？」
 * 「客服提成只算首单（现在的口径），还是续单/复购也算？」→「我自己填写」。
 *
 * 所以这两件事都变成**他自己填**：
 *  1. 按人一套：`CsProfile.commissionConfig`（JSON）填了的项按这个人的算，
 *     没填的项继续用「本店店长填的 → 老板全局默认 → 代码内置默认」。**一个人不填 = 完全等于以前**。
 *  2. 只算首单：`commission.cs_include_renewal`（默认 false = 只算首单）。
 *
 * 这里只管「数值怎么合并」和「哪些订单算提成」，算钱的公式仍然只有 `CommissionService` 一处
 * （线上两家口径也是同一处：`onlineCommissionOf`）——这个项目已经在「两套口径」上翻过车。
 */

/** 一个人单独填的提成项（金额一律是**元**，跟设置页上填的一样；缺的项 = 用店里的） */
export interface CsCommissionOverride {
  /** 线下：流水 × 这个百分比，不足「线下保底」按保底发 */
  offlineRatePercent?: number;
  /** 线下保底（元/单） */
  offlineFloorYuan?: number;
  /** 线下每单封顶（元/单，0 = 不封顶） */
  offlineCapYuan?: number;
  /** 桥接每单（元/单） */
  bridgePerOrderYuan?: number;
  /** 桥接最低单数（低于它底薪打折） */
  bridgeMinThreshold?: number;
  bridgeTier3Threshold?: number;
  bridgeTier5Threshold?: number;
  bridgeTier3Yuan?: number;
  bridgeTier5Yuan?: number;
  /** 线上：'RATE' 按流水比例 / 'PER_ORDER' 按成功单数 × 每单单价 */
  onlineMode?: 'RATE' | 'PER_ORDER';
  onlineRatePercent?: number;
  onlinePerOrderYuan?: number;
}

const NUMBER_FIELDS: Array<keyof CsCommissionOverride> = [
  'offlineRatePercent',
  'offlineFloorYuan',
  'offlineCapYuan',
  'bridgePerOrderYuan',
  'bridgeMinThreshold',
  'bridgeTier3Threshold',
  'bridgeTier5Threshold',
  'bridgeTier3Yuan',
  'bridgeTier5Yuan',
  'onlineRatePercent',
  'onlinePerOrderYuan',
];

/** 把界面 / 库里存的 JSON 规范成能用的覆盖项：空的、负的、写错的都当「没填」。 */
export function normalizeCsCommissionOverride(raw: unknown): CsCommissionOverride {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: CsCommissionOverride = {};
  for (const field of NUMBER_FIELDS) {
    const v = src[field];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) (out as Record<string, number>)[field] = n;
  }
  const mode = String(src.onlineMode ?? '').toUpperCase();
  if (mode === 'RATE' || mode === 'PER_ORDER') out.onlineMode = mode;
  return out;
}

/** 这个人到底有没有单独填过提成 */
export function hasCsCommissionOverride(o: CsCommissionOverride): boolean {
  return Object.keys(o).length > 0;
}

/**
 * 把「按人的覆盖项」叠到「店里的那一套」上（谁近听谁的：按人 > 本店 > 老板 > 内置）。
 * 没填任何一项时**原样返回**，所以老数据一分钱都不变。
 */
export function applyCsCommissionOverride(base: any, override: CsCommissionOverride): any {
  if (!hasCsCommissionOverride(override)) return base;
  const next: any = { ...base };
  const set = (v: number | undefined, apply: (n: number) => void) => {
    if (typeof v === 'number' && Number.isFinite(v)) apply(v);
  };
  set(override.offlineRatePercent, (n) => (next.ratePercent = n));
  set(override.offlineFloorYuan, (n) => (next.floorCents = Math.round(n * 100)));
  set(override.offlineCapYuan, (n) => (next.perOrderCapCents = Math.round(n * 100)));
  set(override.bridgePerOrderYuan, (n) => (next.bridgePerOrderCents = Math.round(n * 100)));
  set(override.bridgeMinThreshold, (n) => (next.bridgeMin = n));
  set(override.bridgeTier3Threshold, (n) => (next.bridgeTier3 = n));
  set(override.bridgeTier5Threshold, (n) => (next.bridgeTier5 = n));
  set(override.bridgeTier3Yuan, (n) => (next.bridgeTier3Yuan = n));
  set(override.bridgeTier5Yuan, (n) => (next.bridgeTier5Yuan = n));
  set(override.onlineRatePercent, (n) => (next.onlineRatePercent = n));
  set(override.onlinePerOrderYuan, (n) => (next.onlinePerOrderCents = Math.round(n * 100)));
  if (override.onlineMode) next.onlineMode = override.onlineMode;
  return next;
}

/** 算客服提成时，哪些单类型的单算数：默认只算首单（NEW）。 */
export function csCommissionOrderTypes(includeRenewal: boolean): string[] {
  return includeRenewal ? ['NEW', 'RENEW', 'REPURCHASE', 'TIP'] : ['NEW'];
}

/** 这一张单算不算客服的提成单（类型口径）。 */
export function csCountsForCommission(order: { type?: string | null } | null | undefined, includeRenewal: boolean): boolean {
  return csCommissionOrderTypes(includeRenewal).includes(String(order?.type || ''));
}
