// craftsman-ignore: TS001,TS003
export interface OrderRevenueInput {
  amount: number;
  coAmount?: number | null;
  companionId?: string | null;
  coCompanionId?: string | null;
  customFields?: any;
}

/**
 * 统一计算某陪玩在一笔已完成订单中的业绩流水（元）。
 * 口径（老板 2026-10-07 定稿「口径 A：谁的钱算谁的」）：
 * - 主陪：amount（他自己那一份「主陪金额」）- 分给其他人的 splits
 * - 搭档：coAmount（他自己那一份）
 * - 仅出现在 splits 里的跨工作室陪玩：其 split 金额
 * 为什么不再扣掉搭档金额：派单时「主陪金额 / 搭档金额」填的**本来就是各自那一份**
 * （线上 703 单：主陪 105、搭档 150，搭档那份比主陪还多）。以前按「amount 是客户付的整单、
 * 得减掉搭档那份」算，等于把搭档的钱从主陪身上又扣一遍 —— 双陪主陪被算成负流水
 * （703 = 105 − 150 = −45），首页本月 / 评分流水 / 结算工资 / 可支取全跟着错。
 * 该口径同时供两套结算服务使用，避免 coAmount / splits 各算各的。
 */
export function companionOrderRevenue(order: OrderRevenueInput, companionId: string): number {
  const splits: Array<{ companionId: string; amount: number }> = (order.customFields as any)?.splits || [];
  const isPrimary = order.companionId === companionId;
  const isCo = order.coCompanionId === companionId;

  if (isPrimary) {
    const splitOut = splits
      .filter((s) => s.companionId !== companionId)
      .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    return (Number(order.amount) || 0) - splitOut;
  }

  if (isCo) {
    return Number(order.coAmount) || 0;
  }

  return splits
    .filter((s) => s.companionId === companionId)
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
}
