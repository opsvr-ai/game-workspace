/**
 * 会话里的「这一单」—— 客服在聊天框顶上点一下就跳到那张单。
 *
 * 老板 2026-09-30：「陪玩 在抢单池/订单管理/客户管理点对应订单的沟通时，客服跟陪玩的聊天框
 * 不是显示某个订单么，能不能客服点击这个位置会跳转到该订单方便查看客户信息，要不然很多时候
 * 陪玩点沟通，客服都不知道是哪一个订单」。
 *
 * 聊天框顶上那行小灰字以前只是一句「三角洲行动 · ¥35」（存在 ChatRoom.orderInfo 里），
 * 同样的游戏 + 金额根本分不清是哪一单。现在这行字同时带上订单 id 和单号，客服点一下就跳到
 * 订单管理（四个角色各自的页面）并把那一单的详情弹窗打开 —— 来源 / 引流账号 / 客户昵称 /
 * 客户账号ID / 客户联系方式 / 备注 都在里面。
 *
 * 服务端（ChatRoom.orderInfo）只把它当**字符串**存（会话搜索也是 `includes` 匹配，文本照样搜得到），
 * 所以这里直接塞一小段 JSON；老会话存的是纯文本，parseOrderInfo 会原样返回，不会把 JSON 显示出来。
 */

export interface ChatOrderInfo {
  /** 显示在聊天框顶上那行字（如「单号 250 · 三角洲行动 · ¥35 · 2h」） */
  text: string;
  /** 点这行字要跳哪一单；没有（老会话 / 不带订单的会话）就不给点 */
  orderId?: string;
  /** 什么时候点的「沟通」（毫秒时间戳）。老会话没有这个值 → 当作已过期，不再显示。 */
  at?: number;
}

/**
 * 聊天框顶上那行「这一单」只挂这么久。
 *
 * 老板 2026-10-05：「从沟通点聊天订单消息只显示 10 分钟，10 分钟后自动消失，
 * 管理端要是想确定哪个订单，可以让陪玩再次点对应订单的沟通」。
 * 这样也就不怕聊天框顶上永远挂着一单不知道多久以前的（点人员列表进来时看到的常是这种）。
 */
export const ORDER_INFO_TTL_MS = 10 * 60 * 1000;

/** 把「显示文本 + 订单 id」编成聊天室里存的那一个字符串。 */
export function encodeOrderInfo(text?: string | null, orderId?: string | null): string | undefined {
  const shown = (text || '').trim();
  if (!orderId) return shown || undefined;
  // 带上「点沟通」的时间：聊天框顶上那行字 10 分钟后自己消失。
  return JSON.stringify({ t: shown, o: orderId, at: Date.now() });
}

/** 反过来解：老会话（纯文本）原样返回，只是不给点。 */
export function parseOrderInfo(raw?: string | null): ChatOrderInfo | null {
  if (!raw) return null;
  if (raw.charAt(0) === '{') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const text = typeof parsed.t === 'string' ? parsed.t : '';
        const orderId = typeof parsed.o === 'string' ? parsed.o : undefined;
        const at = typeof parsed.at === 'number' ? parsed.at : undefined;
        if (text || orderId) return { text, orderId, at };
      }
    } catch {
      /* 不是 JSON 就当纯文本显示 */
    }
  }
  return { text: raw };
}

/**
 * 这行「这一单」现在还要不要显示：
 *   ① 得是「点沟通」写进去的（带时间戳）；
 *   ② 距那次点沟通不超过 10 分钟。
 * 老数据（纯文本 / 没有时间戳）一律当过期 —— 免得顶上永远挂着一单不知多久以前的。
 */
export function orderInfoVisible(raw?: string | null, now = Date.now()): boolean {
  const info = parseOrderInfo(raw);
  if (!info || !info.at) return false;
  return now - info.at < ORDER_INFO_TTL_MS;
}

/** 订单在聊天框顶上那行字：单号 · 游戏 · 金额 · 时长（单号就是老板嘴里「250 单」那个号，放最前面）。 */
export function orderInfoTextOf(order: any): string {
  if (!order) return '';
  // 单号放最前面：聊天框那一条很窄，后面会被截断，而客服最需要看到的就是这个单号。
  return [
    order.orderCode ? `单号 ${order.orderCode}` : '',
    order.gameName || '',
    order.amount !== null && order.amount !== undefined && order.amount !== '' ? `¥${Number(order.amount).toFixed(0)}` : '',
    order.duration ? `${order.duration}h` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 点「查看订单」跳到哪个订单管理页（四个角色四套路由，见 router.tsx）。 */
export function ordersPathForRole(role?: string | null): string {
  if (role === 'COMPANION') return '/companion/orders';
  if (role === 'CS') return '/cs/orders';
  if (role === 'ADMIN') return '/admin/orders';
  return '/owner/orders';
}

/** 带「打开这一单」参数的订单管理地址（OrdersPage 认 orderId 这个参数）。 */
export function ordersPathWithOrder(role: string | null | undefined, orderId: string): string {
  return `${ordersPathForRole(role)}?orderId=${encodeURIComponent(orderId)}`;
}

/** 订单管理窗口的窗口名：同名窗口浏览器自己会复用 + 聚焦，不会点一次开一个。 */
const ORDERS_WINDOW_NAME = 'chunlv-orders';
const ORDERS_WINDOW_FEATURES = 'popup=yes,width=1320,height=860,left=120,top=80';
let ordersWindow: Window | null = null;

/**
 * 单独开一个「订单管理」窗口，并把这一单标出来（整行高亮 + 自动打开它的详情）。
 *
 * 谁需要它：**独立聊天窗口**（一个联系人一个系统窗口，见 ChatWindowPage / utils/chatWindow.ts）
 * 里点聊天框顶上那行「查看订单」。
 *
 * 为什么不能直接 navigate（老板 2026-10-07 报的就是这个）：
 * 聊天窗口自己就是一个独立窗口，拿 react-router 的 navigate 跳订单管理，
 * 等于把「跟某人的聊天」整个换成了订单管理页 —— 老板原话「关闭对话框就是订单管理页面，
 * 点击任务栏宋树祥显示的还是订单管理页面，找不到跟宋树祥的聊天内容了」。
 * 所以独立窗口里一律走这里：订单管理另开一个窗口，聊天窗口原地不动、消息一条不少。
 *
 * 已经开着就复用（先把地址换成新的这一单，再拉到最前）。返回 false = 弹窗被拦。
 */
export function openOrdersWindow(role?: string | null, orderId?: string): boolean {
  const url = ordersPathWithOrder(role, orderId || '');
  try {
    if (ordersWindow && !ordersWindow.closed) {
      ordersWindow.location.href = url;
      ordersWindow.focus();
      return true;
    }
  } catch {
    /* 拿不到旧窗口（被拦 / 已经不能访问）就当没开过，下面重新开一个 */
  }
  try {
    ordersWindow = window.open(url, ORDERS_WINDOW_NAME, ORDERS_WINDOW_FEATURES) || null;
    return !!ordersWindow;
  } catch {
    return false;
  }
}
