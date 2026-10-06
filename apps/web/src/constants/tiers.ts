import { TIER_TINT } from '../styles/tokens';

/** 段位（「马级」）。服务端只发这三个值。 */
export type Tier = 'TOP' | 'MIDDLE' | 'LOW';

export interface TierMeta {
  /** 界面上怎么叫 */
  label: string;
  /** 徽章 / 标签 / 进度条的颜色（金 / 银 / 铜，色值在 styles/tokens.ts 的 TIER_TINT） */
  color: string;
}

/**
 * 段位的显示信息 —— 全站唯一一份。
 *
 * 以前这四份各写各的（TierBadge / ExcellenceRuleModal / CompanionHomeBoard / OperationsBoard），
 * 而且**互相打架**：「中等马」在两处是蓝色、两处是银灰；「下等马」一处灰、一处铜。
 * 同一匹马换个页面就换一种颜色，看着像两套系统。现在统一走这里。
 */
export const TIER_META: Record<Tier, TierMeta> = {
  TOP: { label: '上等马', color: TIER_TINT.top },
  MIDDLE: { label: '中等马', color: TIER_TINT.middle },
  LOW: { label: '下等马', color: TIER_TINT.low },
};

/** 按接口返回的字符串取段位信息；认不出 / 没给，一律当「中等马」（跟以前行为一致）。 */
export function tierMeta(tier?: string | null): TierMeta {
  return TIER_META[tier as Tier] || TIER_META.MIDDLE;
}
