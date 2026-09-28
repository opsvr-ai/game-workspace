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

/**
 * 来源账号（发笔记的那个小红书 / 抖音号）可见性 —— 全站只有这一处定义。
 *
 * 老板 2026-09-28：「客服只显示自己的就可以了，店长跟老板可以看到全局的」：
 *  - 陪玩：看不到（陪玩端那一列本来也不渲染来源账号，抢单池也写着「抢单后可见客户联系方式」）；
 *  - 客服：只看得到**自己发布的**单（别人发的单这一格显示 `***`）；
 *  - 店长 / 老板：全店 / 全平台都看得到。
 *
 * 背景：以前订单列表里写的是 `o.csUserId !== user.id`，店长 / 老板的 id 永远不等于客服 id，
 * 于是管理端整张「订单管理」表的来源账号全变成 `***`（老板报「客户的小红书信息怎么不显示」）。
 */
export function canSeeSourceAccount(user: PrivacyUser | null | undefined, order: any): boolean {
  if (!user) return false;
  if (user.role === 'COMPANION') return false;
  if (user.role === 'CS') return order?.csUserId === user.id;
  return true; // ADMIN / OWNER：看全局
}
