/**
 * 聊天浮窗系统的「打开逻辑」—— 从 layouts/AppLayout.tsx 原样搬出，行为零变化。
 *
 * 收拢：
 *   - 全局聊天弹窗（globalChatPartner）：铃铛通知点聊天 / 其他页面派发 open-chat-modal 时打开；
 *   - 优先开「独立的系统窗口」（openChatWindow），被浏览器拦下才退回页内浮窗；
 *   - openDirectChat / openGroupChat：左侧消息面板、订单/客户页「沟通」、横幅动作都走这里。
 *
 * 通知面板的开合状态仍在 AppLayout，这里通过 closeNotif 参数在打开聊天前把它收起来。
 */
import { useCallback, useEffect, useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import { openChatWindow } from '../utils/chatWindow';

export interface ShellChatPartner {
  conversationId: string;
  participant?: { userId: string; username: string; displayName?: string; avatar?: string; role: string };
  orderInfo?: string | null;
}

interface Deps {
  /** 打开聊天前把右上角通知面板收起来（原 setNotifOpen(false)） */
  closeNotif: () => void;
}

export function useShellChat({ closeNotif }: Deps) {
  const [globalChatPartner, setGlobalChatPartner] = useState<ShellChatPartner | null>(null);
  // Chat 3.0: notification handled by ChatProvider

  // 打开一个聊天窗口：优先开成「独立的系统窗口」（陪玩端 / 客服端是真的应用窗口，任务栏有
  // 按钮、能原生最小化；浏览器里是弹窗），弹窗被浏览器拦了才退回页内那个全局浮窗。
  // 同一个人只会有一个窗口：Electron 主进程按 userId 去重，浏览器按窗口名去重。
  const openChatTarget = useCallback((target: any) => {
    closeNotif();
    if (target?.conversationId && openChatWindow(target)) return;
    setGlobalChatPartner(target);
  }, [closeNotif]);

  // Listen for open-chat-modal event from CSDispatchView / 订单页 / 客户页 / 订单池
  useEffect(() => {
    const handler = (e: CustomEvent) => openChatTarget(e.detail);
    window.addEventListener('open-chat-modal', handler as EventListener);
    return () => window.removeEventListener('open-chat-modal', handler as EventListener);
  }, [openChatTarget]);

  // 打开和某个人的私聊：左侧消息面板点人、订单/客户页点「沟通」都走这里
  const openDirectChat = useCallback((conversationId: string, participantName: string) => {
    const conv = useChatStore.getState().conversations[conversationId];
    closeNotif();
    openChatTarget({
      conversationId,
      participant: conv?.participant || {
        // 未知对方时不要用 roomId 冒充 userId，否则会在服务端建出幽灵会话。
        userId: '',
        username: participantName,
        role: '',
      },
      // 从铃铛进入时不要主动清掉已有订单上下文；若是从订单沟通发起的会话，双方仍应看到该订单信息。
      orderInfo: conv?.orderInfo,
    });
    useChatStore.getState().markRead(conversationId);
  }, [openChatTarget]);

  // Open the studio group chat from the persistent left-side message panel.
  const openGroupChat = useCallback((conversationId: string, groupName: string) => {
    const conv = useChatStore.getState().conversations[conversationId];
    openChatTarget({
      conversationId,
      participant: conv?.participant || {
        userId: '',
        username: groupName,
        displayName: groupName,
        role: 'GROUP',
      },
    });
    useChatStore.getState().markRead(conversationId);
  }, [openChatTarget]);

  return {
    globalChatPartner,
    setGlobalChatPartner,
    openChatTarget,
    openDirectChat,
    openGroupChat,
  };
}
