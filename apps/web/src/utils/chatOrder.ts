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
}

/** 把「显示文本 + 订单 id」编成聊天室里存的那一个字符串。 */
export function encodeOrderInfo(text?: string | null, orderId?: string | null): string | undefined {
  const shown = (text || '').trim();
  if (!orderId) return shown || undefined;
  return JSON.stringify({ t: shown, o: orderId });
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
        if (text || orderId) return { text, orderId };
      }
    } catch {
      /* 不是 JSON 就当纯文本显示 */
    }
  }
  return { text: raw };
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
