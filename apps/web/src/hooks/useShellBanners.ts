/**
 * 横幅 / 搭档邀请 / 转让申请的「状态与事件」—— 从 layouts/AppLayout.tsx 原样搬出。
 *
 * 收拢：
 *   - UrgentOrderPopup 的 urgentOrder / urgentGrabbed；
 *   - 搭档邀请：partnerInvites（共享 store）/ partnerInviteOpen / 3 秒清过期；
 *   - 订单转让：transferReqs / 30 分钟过期清理 / 断线重连补拉 / 同意·拒绝；
 *   - 主进程横幅：onOrderPoolFocus（跳到抢单池并高亮）、onBannerAction（打开转让/订单/报账/池子/聊天）、
 *     onBannerFsAdapted（全屏打游戏时自动改成只响提示音）。
 *
 * 轮询间隔（3000ms）、API 调用、事件名、文案全部沿用原值。
 */
import React, { useEffect } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { UserInfo } from '@chunlv/shared';
import { ordersApi } from '../api/orders';
import { message } from '../utils/feedback';
import { rolePage } from '../config/roleMenus';
import { recordNotice } from '../utils/notice';
import { usePartnerInviteStore } from '../stores/partnerInviteStore';

interface Deps {
  user: UserInfo | null;
  navigate: NavigateFunction;
  openDirectChat: (conversationId: string, participantName: string) => void;
  openGroupChat: (conversationId: string, groupName: string) => void;
}

export function useShellBanners({ user, navigate, openDirectChat, openGroupChat }: Deps) {
  // ── Urgent order + dual-companion popup ──
  const [urgentOrder, setUrgentOrder] = React.useState<any>(null);
  const [urgentGrabbed, setUrgentGrabbed] = React.useState<any>(null);
  // 待处理搭档邀请（老板 2026-10-03）：状态放共享 store，右下角「客服广播那种横幅」点一下
  // → 订单管理页，在最上面那张卡片里同意 / 拒绝；不再弹软件内模态框。
  // 右上角铃铛只留作兜底入口。
  const [partnerInviteOpen, setPartnerInviteOpen] = React.useState(false);
  const partnerInvites = usePartnerInviteStore((s) => s.invites);
  const addPartnerInvite = usePartnerInviteStore((s) => s.add);
  const removePartnerInvite = usePartnerInviteStore((s) => s.remove);
  const prunePartnerInvites = usePartnerInviteStore((s) => s.prune);
  // 待我确认的订单转让申请（老板 2026-10-03：「想转让的订单，需要被转让方同意才能过来，要不然乱套了」）：
  // 主入口是**订单列表里那一行的「接手 / 拒绝」**（老板 2026-10-03 否掉了自动弹窗：
  // 「放在订单列表那一行点转让或者点接受不行么」）；顶栏这个铃铛只是再留一份，
  // 方便在别的页面也能一眼看到有几单在等我确认。
  const [transferReqs, setTransferReqs] = React.useState<any[]>([]);
  const [transferReqOpen, setTransferReqOpen] = React.useState(false);

  // 点 Windows 新单横幅 → 跳到抢单池并把这一单标出来（老板 2026-10-01：「跳转进池子再抢」）。
  // 不直接抢：正在打游戏的人万一误点了，会把不该报的单抢到手里。
  React.useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onOrderPoolFocus) return;
    const off = api.onOrderPoolFocus((p: any) => {
      const orderId = String(p?.orderId || '');
      const path = rolePage(user?.role, 'pool') || '/companion/pool';
      window.dispatchEvent(new CustomEvent('chunlv:order-focus', { detail: { orderId } }));
      navigate(path, { state: { highlightOrderId: orderId } });
    });
    return () => {
      try {
        off?.();
      } catch {
        /* 已经卸载了 */
      }
    };
  }, [navigate, user?.role]);

  // 点横幅上的动作 → 打开对应界面（老板 2026-10-03：「所有涉及弹窗或者邀请的，
  // 都给我做成客服发布订单时广播那个效果，点了能直接跳转」）。
  // 跟新单横幅那条 order-pool-focus 同一套：主进程先把窗口拉到前台，再把动作回执给界面。
  React.useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onBannerAction) return;
    const off = api.onBannerAction((msg: any) => {
      const action = String(msg?.action || '');
      const payload = msg?.payload || {};
      try {
        if (action === 'open-transfer') {
          setTransferReqOpen(true);
        } else if (action === 'open-orders') {
          navigate(rolePage(user?.role, 'orders') || '/companion/orders');
        } else if (action === 'open-billing') {
          navigate(rolePage(user?.role, 'billing') || '/companion/orders');
        } else if (action === 'open-pool') {
          navigate(rolePage(user?.role, 'pool') || '/companion/pool');
        } else if (action === 'open-chat') {
          const convId = String(payload?.conversationId || '');
          if (convId) {
            if (payload?.isGroup) openGroupChat(convId, String(payload?.groupName || '工作室群聊'));
            else openDirectChat(convId, String(payload?.participantName || '会话'));
          }
        }
      } catch {
        /* 打不开也不影响接单主流程 */
      }
    });
    return () => {
      try {
        off?.();
      } catch {
        /* 已经卸载了 */
      }
    };
  }, [navigate, user?.role, openDirectChat, openGroupChat]);

  // 主进程通知：这台电脑全屏打游戏时会被弹窗顶出游戏，已自动改成「只响提示音 + 闪任务栏」
  // （老板 2026-10-08 童祥瑞那台）。跟主进程那套「压住横幅」配套 —— 得让人知道这台机器为什么
  // 以后打游戏时不弹了，以及去哪儿改回来。
  React.useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onBannerFsAdapted) return;
    const off = api.onBannerFsAdapted(() => {
      message.info(
        '这台电脑全屏打游戏时会被弹窗顶出游戏，已自动改成「只响提示音 + 闪任务栏」，退出全屏后补弹；想改回去「设置 → 通知设置」里选',
        8,
      );
      recordNotice({
        icon: '🖥️',
        title: '全屏打游戏时已自动不弹窗',
        desc: '检测到本机被弹窗顶出过游戏，已自动改成响提示音 + 闪任务栏（退出全屏后补弹），可在「设置 → 通知设置」改回',
        href: '/companion',
      });
    });
    return () => {
      try {
        off?.();
      } catch {
        /* 已经卸载了 */
      }
    };
  }, []);

  const addTransferReq = React.useCallback((req: any) => {
    setTransferReqs((prev) => {
      const key = req?.requestId || req?.id;
      if (!key || prev.some((p) => (p.requestId || p.id) === key)) return prev;
      return [...prev, req];
    });
  }, []);

  const removeTransferReq = React.useCallback((requestId: string) => {
    setTransferReqs((prev) => prev.filter((p) => (p.requestId || p.id) !== requestId));
  }, []);

  const acceptTransferReq = React.useCallback(
    async (req: any) => {
      const requestId = req?.requestId || req?.id;
      if (!requestId) return;
      try {
        await ordersApi.acceptTransfer(requestId);
        message.success('已同意转让，这张单现在归你了');
        removeTransferReq(requestId);
        window.dispatchEvent(new Event('chunlv:transfer-updated'));
        window.dispatchEvent(new Event('chunlv:order-pool-updated'));
      } catch (e: any) {
        message.error(e?.response?.data?.message || '同意失败');
      }
    },
    [removeTransferReq],
  );

  const rejectTransferReq = React.useCallback(
    async (req: any) => {
      const requestId = req?.requestId || req?.id;
      if (!requestId) return;
      try {
        await ordersApi.rejectTransfer(requestId);
        message.success('已拒绝，这张单还在对方名下');
      } catch (e: any) {
        message.error(e?.response?.data?.message || '拒绝失败');
      }
      removeTransferReq(requestId);
      window.dispatchEvent(new Event('chunlv:transfer-updated'));
    },
    [removeTransferReq],
  );

  // 转让申请有 30 分钟有效期：过期自己从铃铛里消失。
  useEffect(() => {
    const t = setInterval(() => {
      setTransferReqs((prev) => {
        const now = Date.now();
        const next = prev.filter((p) => !p.expiresAt || p.expiresAt > now);
        return next.length === prev.length ? prev : next;
      });
    }, 3000);
    return () => clearInterval(t);
  }, []);

  // 刷新 / 断线重连后把还没处理的转让申请补回来（WS 只在发生时推一次）。
  useEffect(() => {
    if (!user?.companionId) return;
    const load = () => {
      ordersApi
        .myTransferRequests()
        .then((res: any) => {
          const incoming = res?.data?.data?.incoming || [];
          setTransferReqs(incoming.filter((r: any) => r.valid !== false));
        })
        .catch(() => {});
    };
    load();
    const onUpdated = () => load();
    window.addEventListener('chunlv:transfer-updated', onUpdated);
    return () => window.removeEventListener('chunlv:transfer-updated', onUpdated);
  }, [user?.companionId]);

  // 自动清理已过期的搭档邀请，避免铃铛里残留（订单管理页那张卡片里也会兜底清理）。
  useEffect(() => {
    const t = setInterval(prunePartnerInvites, 3000);
    return () => clearInterval(t);
  }, [prunePartnerInvites]);

  return {
    urgentOrder,
    urgentGrabbed,
    setUrgentOrder,
    setUrgentGrabbed,
    partnerInviteOpen,
    setPartnerInviteOpen,
    partnerInvites,
    addPartnerInvite,
    removePartnerInvite,
    transferReqOpen,
    setTransferReqOpen,
    transferReqs,
    addTransferReq,
    removeTransferReq,
    acceptTransferReq,
    rejectTransferReq,
  };
}
