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
 * 来源账号（发笔记的那个小红书 / 抖音号）：**只有陪玩端看不到，管理端一律显示完整**。
 *
 * 老板 2026-09-30：「管理端的 订单管理 引流账号 怎么是 `*`？」——
 * 这一格本来是 2026-09-28 按「客服只显示自己的就可以了」抹成 `***` 的（`canSeeSourceAccount`），
 * 可同样是客服，「客户管理」里那一格一直显示的是完整账号（那边只按 `canSeeCustomerSource`
 * 对陪玩端隐藏）—— 同一个数据两个页面显示不一样，正是老板最烦的「每个页面显示的不一样」。
 * 老板 2026-09-30 的定调是「所有页面显示一致，只有陪玩端不展示」，所以这条抹号规则整条删掉：
 *  - 陪玩端：照样看不到（由 `canSeeCustomerSource` + `stripCustomerSourceDeep` 拦截器把
 *    来源 / 来源账号**整列摘掉**，连「小红书」三个字都不给看）；
 *  - 客服 / 店长 / 老板：一律看完整的引流账号。
 *
 * 删掉的只有「管理端抹成 `***`」这一步，陪玩端那边一个都没放开。
 */

/**
 * 客户来源（小红书 / 抖音 / 快手…）可见性 —— **陪玩端一律看不到**，客服 / 店长 / 老板照常。
 *
 * 老板 2026-09-29：「陪玩端 隐藏 客户小红书信息」。
 *
 * 这是现在唯一的口径：陪玩端看不到，客服 / 店长 / 老板照常
 * （以前那条「客服只看自己发的单」的抹号规则 2026-09-30 删了，见上面那段）。
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
   * 怎么处理 `customer.platform`：
   * - `'blank'`（默认，订单响应）：直接清空 —— 订单里这个字段存的就是来源（小红书 / 抖音…）；
   * - `'contactOnly'`（客户档案响应）：只有**不是**联系方式平台时才清空 —— 同一个字段在客户档案里
   *   还兼着「客户用的是微信 / QQ / 电话 / 其他」，一律清掉会让陪玩端把客户的 QQ / 电话显示成「未绑定」。
   */
  platform?: 'blank' | 'contactOnly';
}

/** 客户档案里 `customer.platform` 真正表示「联系方式平台」的取值（和前端 `platformLabels` 一致）。 */
const CONTACT_PLATFORMS = new Set(['WECHAT', 'QQ', 'PHONE', 'OTHER']);

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
  const platformMode = opts.platform ?? 'blank';
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
  const shouldClearPlatform =
    platformMode === 'blank' || !CONTACT_PLATFORMS.has(String(customer?.platform));
  if (customer && typeof customer === 'object' && customer.platform && shouldClearPlatform) {
    out = { ...out, customer: { ...customer, platform: '' } };
  }

  // 客户档案（`GET /customers`）里 `platform` 是直接挂在**客户对象自己**身上的
  // （订单里才是 `order.customer.platform`，上面那段管的就是它）。判据用客户档案独有的字段，
  // 免得误伤别的对象 —— 引流账号（TrafficAccount）也有个 `platform`，那是它自己的平台，不能清。
  const ownPlatform = (src as any).platform;
  const looksLikeCustomer = typeof src.customerCode === 'string' || typeof src.wechatId === 'string';
  const shouldClearOwn =
    platformMode === 'blank' || !CONTACT_PLATFORMS.has(String(ownPlatform));
  if (looksLikeCustomer && typeof ownPlatform === 'string' && ownPlatform && shouldClearOwn) {
    out = { ...out, platform: '' };
  }

  return out;
}

/**
 * 递归过一遍任意响应体：数组、`{ code, message, data }` 这类包一层的、
 * 订单里再嵌订单的（搭档邀请 / 会话），都能清理到。
 *
 * `opts` 一层层传下去（数组 / 嵌套对象都带同一个开关）。
 *
 * 挂在 OrdersController / CustomersController 的拦截器上，所以陪玩端**每个**接口都自动生效，
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

/**
 * 抢单池里**陪玩端一定看不到客户联系方式**（老板 2026-10-01：「订单池怎么还没抢的订单也能看到
 * 客户微信等信息？被抢过的怎么也显示？还没抢就显示微信 那还抢什么？」）。
 *
 * 以前这套系统只在「来源 / 引流账号 / 客户昵称 / 客户账号ID」四列上做了陪玩端隐藏，
 * 唯独把「客户联系方式」（微信号 / YY / KOOK / 房间码）漏在外边 —— 2026-09-30
 * 把订单 / 客户数据收成「唯一一份字段口径」时，抢单池那一行也跟着走同一份口径，
 * 于是顺着把微信显示出来了。这里把它按**同一份口径**补齐：
 *  - 陪玩端：没抢到的单、被别人抢走的单，联系方式一律看不到（抢到手自然有，走订单详情 / 抢单成功浮窗）；
 *  - 客服 / 店长 / 老板：一个字都不动，照常看全。
 *
 * 只删「联系方式」这几个键，**不动**来源 / 金额 / 游戏这些 —— 抢单池要靠它们挑单。
 */
const POOL_CONTACT_CUSTOM_KEYS = [
  "customerWechat",
  "customerWechatQr",
  "customerYy",
  "customerPlatformAccount",
  "customerRoomCode",
];

/** 把一个订单上的客户联系方式抹掉（删键，不是抹成 `***`）；返回新对象，不改传进来的那个。 */
export function stripPoolCustomerContact<T>(order: T): T {
  if (!order || typeof order !== "object") return order;
  const src = order as any;
  let out: any = src;

  const cf = src.customFields;
  if (cf && typeof cf === "object") {
    const next: any = { ...cf };
    let dirty = false;
    for (const key of POOL_CONTACT_CUSTOM_KEYS) {
      if (key in next) {
        delete next[key];
        dirty = true;
      }
    }
    if (dirty) out = { ...out, customFields: next };
  }

  // 老单的微信存在 customer.wechatId 上（前端兜底也会读它），一并清掉；
  // 客户编号（customerCode）留着，抢单池要靠它跟客户管理对号。
  if (src.customer && typeof src.customer === "object" && src.customer.wechatId) {
    out = { ...out, customer: { ...src.customer, wechatId: "" } };
  }
  return out;
}
