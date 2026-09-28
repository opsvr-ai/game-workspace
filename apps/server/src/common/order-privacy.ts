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

/**
 * 客户来源（小红书 / 抖音 / 快手…）可见性 —— **陪玩端一律看不到**，客服 / 店长 / 老板照常。
 *
 * 老板 2026-09-29：「陪玩端 隐藏 客户小红书信息」。
 *
 * 和上面的 `canSeeSourceAccount`（只管「来源账号」那一串、客服还分自己的 / 别人的）不是一回事：
 * 这里只管「这个角色能不能看到客户的来源」，口径更狠也更简单 —— 只抹账号、留着「小红书」
 * 三个字，陪玩照样知道这单是从小红书来的，所以来源平台本身也得藏。
 */
export function canSeeCustomerSource(user?: PrivacyUser | null): boolean {
  if (!user) return false;
  return user.role !== 'COMPANION';
}

/** 订单里跟「客户来源」有关的键：来源平台 + 来源账号。 */
const SOURCE_KEYS = ['customerSource', 'customerSourceAccount'];

export interface StripSourceOptions {
  /**
   * 要不要连带清空 `customer.platform`。默认 **true**（订单响应要清，见下）；
   * 客户档案响应要传 **false** —— 同一个字段在客户档案里还兼着「微信 / QQ / 电话」，
   * 清掉会让陪玩端连客户的 QQ / 电话都显示成「未绑定」。
   */
  platform?: boolean;
}

/**
 * 把一个订单对象上的客户来源摘干净（**删键**，不是抹成 `***`）。
 *
 * `customer.platform` 一起清空：老单没有 `customFields.customerSource`，订单列表
 * 那一格的兜底就是它（`cf.customerSource || o.customer?.platform`），而 updateOrderInfo
 * 里又正好把客户来源同步进这个字段，所以它里面存的也可能就是「小红书」。
 *
 * 返回新对象，不改传进来的那个（调用方常常还要拿原对象去别的地方推送）。
 */
export function stripCustomerSource<T>(order: T, opts: StripSourceOptions = {}): T {
  if (!order || typeof order !== 'object') return order;
  const clearPlatform = opts.platform !== false;
  const src = order as any;
  let out: any = src;

  const cf = src.customFields;
  if (cf && typeof cf === 'object') {
    const next: any = { ...cf };
    let dirty = false;
    for (const key of SOURCE_KEYS) {
      if (key in next) {
        delete next[key];
        dirty = true;
      }
    }
    if (dirty) out = { ...out, customFields: next };
  }

  const customer = src.customer;
  if (clearPlatform && customer && typeof customer === 'object' && customer.platform) {
    out = { ...out, customer: { ...customer, platform: '' } };
  }

  return out;
}

/**
 * 递归过一遍任意响应体：数组、`{ code, message, data }` 这类包一层的、
 * 订单里再嵌订单的（搭档邀请 / 会话），都能清理到。
 *
 * 挂在 OrdersController 的拦截器上，所以陪玩端**每个**订单接口都自动生效，
 * 不用每个方法各写一遍，也不会「新加个接口忘了过滤」。
 */
export function stripCustomerSourceDeep<T>(payload: T, opts: StripSourceOptions = {}): T {
  if (Array.isArray(payload)) {
    return payload.map((item) => stripCustomerSourceDeep(item, opts)) as unknown as T;
  }
  if (!payload || typeof payload !== 'object' || payload instanceof Date) return payload;

  let out: any = stripCustomerSource(payload, opts);
  for (const [key, value] of Object.entries(out)) {
    if (value && typeof value === 'object') {
      const next = stripCustomerSourceDeep(value, opts);
      if (next !== value) out = { ...out, [key]: next };
    }
  }
  return out;
}
