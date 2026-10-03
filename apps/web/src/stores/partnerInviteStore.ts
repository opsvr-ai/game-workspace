// craftsman-ignore: TS001
import { create } from 'zustand';

/**
 * 待我确认的「搭档邀请 / 广播找搭档」（老板 2026-10-03）。
 *
 * 老板原话：「现在邀请搭档的链接还是 windows 弹窗 + 软件内弹窗，点这个 windows 弹窗并不能实现跳转，
 * 现在把邀请的 windows 弹窗删除掉，改用客服广播的那种弹窗，陪玩点击就能跳转到软件的订单管理，
 * 然后去同意邀请」。
 *
 * 所以：右下角只留「客服广播那种横幅」（点一下 → 订单管理），接受 / 拒绝统一放到订单管理页最上面。
 * 状态放 store 里是因为 AppLayout（收 WS 事件）和订单管理页（渲染 + 操作）是两棵子树。
 */
export interface PartnerInvite {
  sessionId: string;
  inviterName: string;
  gameName: string;
  amount: number;
  duration: number;
  /** 到这个时刻还没处理就自动作废（服务端也会取消） */
  expiresAt: number;
}

interface PartnerInviteState {
  invites: PartnerInvite[];
  add: (invite: PartnerInvite) => void;
  remove: (sessionId: string) => void;
  /** 清掉已经过期的（服务端超时也会推事件，这里只是兜底） */
  prune: () => void;
}

export const usePartnerInviteStore = create<PartnerInviteState>((set) => ({
  invites: [],
  add: (invite) =>
    set((s) =>
      !invite?.sessionId || s.invites.some((p) => p.sessionId === invite.sessionId)
        ? s
        : { invites: [...s.invites, invite] },
    ),
  remove: (sessionId) =>
    set((s) => ({ invites: s.invites.filter((p) => p.sessionId !== sessionId) })),
  prune: () =>
    set((s) => {
      const now = Date.now();
      const next = s.invites.filter((p) => p.expiresAt > now);
      return next.length === s.invites.length ? s : { invites: next };
    }),
}));
