/**
 * 存单扣款口径（老板 2026-10-04）。
 *
 * 老板原话：「有时候你统计的并不准，以陪玩自己输入的为准吧。」
 *
 * 原来结束服务时一律按服务端计时算：`实际时长 × 单价`，直接从客户存单余额里扣。
 * 但计时偶尔会不准（忘了点结束、中途暂停没点、网络断线…），所以改成：
 *   - 陪玩在「结束服务」里填了金额 → **以他填的为准**；
 *   - 没填 → 才退回系统的 `实际时长 × 单价`；
 *   - 最多扣到客户当前存单余额（余额扣完就是 0，不做成负数，否则财务
 *     「未打存单预留」会被算花，还会凭空抬高可支取业绩）。
 */
export function resolveDepositDeduct(params: {
  /** 陪玩自己填的金额（元），没填传 null / undefined */
  wanted?: number | null;
  /** 系统按计时算出来的金额（元） */
  autoDeduct: number;
  /** 客户当前存单余额（元） */
  balance: number;
}): number {
  const auto =
    Number.isFinite(params.autoDeduct) && params.autoDeduct > 0 ? Number(params.autoDeduct) : 0;
  const raw = params.wanted == null ? NaN : Number(params.wanted);
  const useWanted = Number.isFinite(raw) && raw >= 0;
  const wanted = useWanted ? raw : auto;
  const balance = Number.isFinite(params.balance) ? Math.max(0, Number(params.balance)) : 0;
  const capped = Math.min(wanted, balance);
  return Math.round(capped * 100) / 100;
}
