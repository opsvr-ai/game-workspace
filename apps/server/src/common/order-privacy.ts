// 客户微信隐私统一过滤：只有主陪、客服、店长、老板可见；副陪（搭档）一律隐藏。

export interface PrivacyUser {
  id: string;
  role: string;
  companionId?: string;
}

export function maskCustomerWechat(order: any, user?: PrivacyUser | null): any {
  if (!order || !user) return order;
  if (user.role !== 'COMPANION') return order; // 客服/店长/老板可见
  if (order.companionId === user.companionId) return order; // 主陪可见
  if (order.coCompanionId !== user.companionId) return order; // 与当前陪玩无关，原样返回

  // 副陪（搭档）：隐藏客户微信与二维码
  const cf = order.customFields as any;
  return {
    ...order,
    customer: order.customer ? { ...order.customer, wechatId: '' } : order.customer,
    customFields: cf ? { ...cf, customerWechat: '', customerWechatQr: undefined } : cf,
  };
}

export function maskCustomerWechatList(orders: any[], user?: PrivacyUser | null): any[] {
  return orders.map((o) => maskCustomerWechat(o, user));
}
