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
 * 口径：
 * - 主陪：amount - 搭档金额 - 分给其他人的 splits
 * - 搭档：coAmount
 * - 仅出现在 splits 里的跨工作室陪玩：其 split 金额
 * 该口径同时供两套结算服务使用，避免 coAmount / splits 各算各的。
 */
export function companionOrderRevenue(order: OrderRevenueInput, companionId: string): number {
  const splits: Array<{ companionId: string; amount: number }> = (order.customFields as any)?.splits || [];
  const isPrimary = order.companionId === companionId;
  const isCo = order.coCompanionId === companionId;

  if (isPrimary) {
    const coOut = order.coCompanionId && order.coCompanionId !== companionId ? (order.coAmount || 0) : 0;
    const splitOut = splits
      .filter((s) => s.companionId !== companionId)
      .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    return (Number(order.amount) || 0) - coOut - splitOut;
  }

  if (isCo) {
    return Number(order.coAmount) || 0;
  }

  return splits
    .filter((s) => s.companionId === companionId)
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
}
