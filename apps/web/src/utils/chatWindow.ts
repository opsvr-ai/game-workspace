// craftsman-ignore: TS001
/**
 * 把聊天开成「独立的系统窗口」（老板 2026-10-05：跟微信一样，同一个联系人一个窗口、
 * 能同时开好几个、每个都能最小化到任务栏）。
 *
 *  - Electron 客户端（陪玩端 / 客服端）：走主进程 IPC 新建真正的应用窗口（任务栏有按钮、
 *    原生最小化）；同一个人已经开着就把它拉到前台，不会重复开。
 *  - 浏览器 / 还没更新的老客户端：退回 window.open，窗口名按人算 —— 同名只开一个，
 *    重复点会把已开的那个拉到前面。
 *
 * 返回 false 表示弹窗被浏览器拦了，调用方可以退回页内浮窗。
 */
export interface ChatWindowTarget {
  conversationId: string;
  participant?: {
    userId?: string;
    username?: string;
    displayName?: string;
    avatar?: string;
    role?: string;
  } | null;
  orderInfo?: string | null;
}

/** 窗口去重键：优先按「对方的 userId」，群聊按会话 id。同一个人永远只对应一个窗口名。 */
export function chatWindowKey(target: ChatWindowTarget): string {
  return String(target.participant?.userId || target.conversationId || '');
}

export function chatWindowUrl(target: ChatWindowTarget): string {
  const params = new URLSearchParams();
  params.set('room', String(target.conversationId || ''));
  if (target.participant?.userId) params.set('uid', target.participant.userId);
  const name = target.participant?.displayName || target.participant?.username || '';
  if (name) params.set('name', name);
  if (target.participant?.avatar) params.set('avatar', target.participant.avatar);
  if (target.participant?.role) params.set('role', target.participant.role);
  // 订单上下文三种叫法要跨窗口原样带过去：
  //   undefined = 不带这个参数 → 聊天窗口那边保持服务端记着的那一单；
  //   null / 空串 = 带一个空的 order= → 明确清掉（人员列表的普通会话）。
  const orderValue = target.orderInfo === undefined ? undefined : target.orderInfo || '';
  if (orderValue !== undefined) params.set('order', orderValue);
  return '/chat-window?' + params.toString();
}

export function openChatWindow(target: ChatWindowTarget): boolean {
  if (!target || !target.conversationId) return false;
  const ea = (window as any).electronAPI;
  if (typeof ea?.openChatWindow === 'function') {
    try {
      ea.openChatWindow({
        conversationId: target.conversationId,
        userId: target.participant?.userId || '',
        name: target.participant?.displayName || target.participant?.username || '聊天',
        avatar: target.participant?.avatar || '',
        role: target.participant?.role || '',
        orderInfo: target.orderInfo === undefined ? undefined : target.orderInfo || '',
      });
      return true;
    } catch {
      /* IPC 失败就退回下面的 window.open */
    }
  }
  try {
    const win = window.open(
      chatWindowUrl(target),
      'chunlv-chat-' + chatWindowKey(target),
      'popup=yes,width=430,height=620,left=80,top=60',
    );
    return !!win;
  } catch {
    return false;
  }
}
