// 客户微信隐私统一过滤：只有主陪、客服、店长、老板可见；副陪（搭档）一律隐藏。

export interface PrivacyUser {
  id: string;
  role: string;
  /** 所属工作室（全站老板为空）。判「这一单 / 这个客户是不是他家的」就看它。 */
  studioId?: string | null;
  companionId?: string;
}

export function maskCustomerWechat(order: any, user?: PrivacyUser | null): any {
  if (!order || !user) return order;
  if (user.role !== 'COMPANION') return order; // 客服/店长/老板可见
  if (order.companionId === user.companionId) return order; // 主陪可见
  if (order.coCompanionId !== user.companionId) return order; // 与当前陪玩无关，原样返回

  // 副陪（搭档）：隐藏客户微信与二维码
  return maskPartnerContactView(order);
}

/**
 * 强制按「副陪（搭档）视角」隐藏客户联系方式：客户微信 + 二维码抹掉，
 * 房间码 / YY / KOOK 这些服务时要用的留着（跟线下陪玩端看到的一样）。
 *
 * 用在「我服务的单」那一栏（老板 2026-10-03）：那一栏里凡是主陪不是我的单，
 * 一律看不到主陪的客户微信 —— 就算这张单的 `coCompanionId` 后来因为再转让变了，
 * 也不能把客户信息漏给曾经的搭档。
 */
export function maskPartnerContactView(order: any): any {
  if (!order || typeof order !== 'object') return order;
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
 * 沿革（别再把口径改回去）：
 *  - 2026-09-28：按「客服只显示自己发的单」把引流量号抹成 `***`（`canSeeSourceAccount`）；
 *  - 2026-09-30：老板「管理端的 订单管理 引流账号 怎么是 `*`？」+「所有页面显示一致」→
 *    抹号那条整条删掉，改成「只有陪玩端看不到」；
 *  - 2026-10-02：老板发现**桥接工作室的店长 / 客服**（角色不是陪玩）也能看到别家客户的来源，
 *    于是这条线从「按角色」改成「按**发单工作室**」—— 见下面 `canSeeCustomerSource`。
 */


/**
 * 客户来源（来源平台 / 引流账号 / 客户昵称 / 客户账号ID）能不能给这个人看。
 *
 * 老板 2026-10-02：「蠢驴电竞的客服孙可馨发单，为什么桥接工作室的黄浩那边没抢单就能显示
 * 客户的小红书信息？就算黄浩能抢到也只能看到客户的微信房间码之类的，跟蠢驴电竞线下陪玩端
 * 看的是一样的，**除了发单工作室的管理端能看到其他人一律看不到**。」
 *
 * 现在唯一的口径：
 *  - 只有**发单工作室**（订单 / 客户档案归属的 `studioId`）的客服 / 店长 / 老板能看到；
 *  - **全站老板**（不挂工作室的 OWNER）看全部；
 *  - 接单方一律看不到：桥接工作室的店长 / 客服、线上俱乐部、别的店，以及**所有陪玩**。
 *
 * 沿革：2026-09-29 这条线只按**角色**判（只要不是陪玩就看得见），于是桥接工作室的店长 / 客服
 * （角色是 ADMIN / CS）在抢单池 / 订单管理里就拿到了别家客户的来源 —— 就是老板 2026-10-02 报的这个洞。
 * 改成按**工作室归属**判之后，「陪玩端永远看不到」那条单独留着。
 *
 * @param item 这条数据本身（订单 / 客户档案），或者它的 `studioId`。
 */
export function canSeeCustomerSource(
  user?: PrivacyUser | null,
  item?: { studioId?: string | null } | string | null,
): boolean {
  if (!user) return false;
  // 全站老板（不挂工作室）：看所有工作室
  if (user.role === 'OWNER' && !user.studioId) return true;
  // 陪玩端一律看不到（本店的单也不给看）
  if (user.role === 'COMPANION') return false;
  const studioId = typeof item === 'string' ? item : item?.studioId;
  // 拿不到归属（老数据 / 调用没带）→ 从严，不给看
  if (!studioId) return false;
  return !!user.studioId && user.studioId === studioId;
}

/**
 * 订单里跟「客户来源」有关的一整组键：来源平台（小红书 / 抖音…）、引流账号、客户昵称
 * （小红书昵称）、客户账号ID。
 *
 * 这一组正好就是陪玩端一直看不到的那几项（前端 `COMPANION_HIDDEN_FIELDS`），
 * 也是 2026-10-02 起「**只有发单工作室的管理端**能看、接单方一律看不到」的那几项。
 */
const SOURCE_KEYS = [
  'customerSource',
  'customerSourceAccount',
  'customerNickname',
  'customerAccountId',
];

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
 * 把一个订单对象上的客户来源摘干净（**删键**，不是抹成 `***`）：
 * `customFields` 里的 `SOURCE_KEYS` 那四项 + `customer.platform`。
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
 * 这是「谁都别想看到」的版本：推给陪玩端 / 桥接工作室的 ws 推送走它。
 * 管理端接口（OrdersController / CustomersController）走的是 `stripCustomerSourceForViewer`
 * —— 那个会按每条数据自己的工作室归属判，本店管理端照常看得到。
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

/**
 * 按「这条数据属于哪个工作室」**逐条**判断后摘掉客户来源 —— 管理端接口响应用这个。
 *
 * `stripCustomerSourceDeep` 是「谁都别想看到」的版本（推给陪玩端 / 桥接工作室的推送用）；
 * 这个版本顺着对象自己的 `studioId` 判：
 *  - 带 `studioId` 的对象（订单 / 客户档案）→ `canSeeCustomerSource(user, studioId)` 说了算；
 *  - 不带 `studioId` 的（`{ code, data }` 这种包一层的、订单里嵌的 `customer`）→ 跟外层结论走，
 *    免得出现「订单本身能看，里面那个 `customer.platform` 却被清空」。
 *
 * 客服的订单管理、抢单池这些列表里混着自家和桥接工作室的单，只有逐条判才对。
 */
export function stripCustomerSourceForViewer<T>(
  payload: T,
  user?: PrivacyUser | null,
  opts: StripSourceOptions = {},
): T {
  return walkCustomerSource(payload, user, opts, undefined) as T;
}

function walkCustomerSource(
  value: any,
  user: PrivacyUser | null | undefined,
  opts: StripSourceOptions,
  inherited?: boolean,
): any {
  if (Array.isArray(value)) {
    return value.map((item) => walkCustomerSource(item, user, opts, inherited));
  }
  if (!value || typeof value !== 'object' || value instanceof Date) return value;

  const studioId = (value as any).studioId;
  const visible =
    typeof studioId === 'string' && studioId ? canSeeCustomerSource(user, studioId) : inherited;

  let out: any = value;
  if (visible === false) out = stripCustomerSource(value, opts);

  for (const [key, child] of Object.entries(out)) {
    if (child && typeof child === 'object') {
      const next = walkCustomerSource(child, user, opts, visible);
      if (next !== child) out = { ...out, [key]: next };
    }
  }
  return out;
}
