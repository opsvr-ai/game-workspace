/**
 * WebSocket 实时推送的「总入口」—— 从 layouts/AppLayout.tsx 原样搬出，行为零变化。
 *
 * 收拢 useSocket 上挂的全部业务回调（约 40 个）：
 *   订单池 / 新单 / 指定单、订单转让、搭档邀请与双人广播、服务时长提醒、群聊广播、
 *   补单 / 工作微信 / 工作抽查 / 成交核对 / 支取 / 注册 / 桥接 / 营收差异等审核提醒，
 *   以及每条提醒对应的提示音、右下角通知、置顶横幅（showBannerNotification）。
 *
 * 只把「AppLayout 里的状态写入」通过参数传进来（user / 邀请与转让读写 / 新单弹窗 / 抽查红点），
 * 事件名、payload 判断、文案、去重时间、请求参数一律保持原样。
 */
import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { UserInfo } from '@chunlv/shared';
import { notification } from 'antd';
import { message } from '../utils/feedback';
import { notifyNotice, recordNotice } from '../utils/notice';
import { playNotificationSound, showBannerNotification, showSystemNotification } from '../utils/notify';
import { cancelCompanionUpdateForService } from '../utils/companionUpdate';
import { rolePage } from '../config/roleMenus';
import http from '../api/client';
import { useSocket } from './useSocket';
import { speakVoiceReminder } from '../utils/voiceReminder';

export interface ShellRealtimeDeps {
  user: UserInfo | null;
  addPartnerInvite: (invite: any) => void;
  removePartnerInvite: (sessionId: string) => void;
  addTransferReq: (req: any) => void;
  removeTransferReq: (requestId: string) => void;
  setUrgentOrder: (order: any | null) => void;
  setReviewBadge: Dispatch<SetStateAction<number>>;
}

export function useShellRealtime({
  user,
  addPartnerInvite,
  removePartnerInvite,
  addTransferReq,
  removeTransferReq,
  setUrgentOrder,
  setReviewBadge,
}: ShellRealtimeDeps) {
  // 陪玩端全局状态心跳：不管他停在首页 / 订单 / 客户页面，每分钟都让服务端补一次
  // 「当前状态」的计时日志——否则只看首页心跳会漏掉一直在别的页面挂机的陪玩。
  useEffect(() => {
    if (user?.role !== 'COMPANION' || !user?.companionId) return;
    // 接单中弹窗开关同步到本机主进程，主进程才知道哪些 Windows 通知要拦。
    http.get('/companions/me/notify-prefs')
      .then(({ data }: any) => {
        const next = !!data?.data?.notifyWhileBusy;
        (window as any).electronAPI?.storeSet?.('notifyWhileBusy', next);
      })
      .catch(() => {});
    const ping = () => {
      http.post('/companions/me/status-heartbeat').catch(() => {});
    };
    ping();
    const timer = setInterval(ping, 60_000);
    return () => clearInterval(timer);
  }, [user?.role, user?.companionId]);

  // WebSocket connection for real-time updates
  const voiceSocketRef = useSocket({
    onOrderNew: (data: any) => {
      if (data?.type !== 'DUAL_INVITE') {
        // 非搭档邀请的 order:new 通常就是“新订单进池/广播”。
        // 2026-10-18：陪玩端**不要**在这里立刻刷新订单池 —— 新单弹窗要按段位延迟，
        // 这里先刷会让「订单池先出现、几秒后弹窗」；改成等 order:urgent 到达时一起刷新
        // （见下面 onOrderUrgent 的 chunlv:order-pool-updated）。管理端 / 客服仍立即刷新。
        const isPoolBroadcast =
          (data?.dispatchType === 'POOL' || data?.dispatchType === 'BROADCAST')
          && data?.status === 'PENDING'
          && !data?._isAssignment;
        if (user?.role === 'COMPANION' && isPoolBroadcast) return;
        if (data?.dispatchType === 'POOL' || data?.dispatchType === 'BROADCAST' || data?._notify) {
          window.dispatchEvent(new Event('chunlv:order-pool-updated'));
        }
        return;
      }
      if (!user?.companionId || data?.coCompanionId !== user.companionId) return;
      if (cancelCompanionUpdateForService()) message.info('软件正在更新，已推迟到空闲后');
      const inviter = data.inviterName || '有陪玩';
      const isProxy = data.proxyMode === true;
      const desc = isProxy
        ? `${inviter}让你代打：${data.gameName || ''} · 代打金额 ¥${Number((data.coAmount ?? data.amount) || 0).toFixed(1)} · ${data.duration || 1}h`
        : `${inviter}邀请你搭档服务：${data.gameName || ''} · 搭档金额 ¥${Number((data.coAmount ?? data.amount) || 0).toFixed(1)} · ${data.duration || 1}h`;
      const ttl = data.expiresInSec ?? 15;
      addPartnerInvite({
        sessionId: data.id,
        inviterName: inviter,
        gameName: data.gameName || '',
        amount: Number((data.coAmount ?? data.amount) || 0),
        duration: data.duration || 1,
        proxyMode: isProxy,
        expiresAt: Date.now() + ttl * 1000,
      });
      recordNotice({
        kind: 'invite',
        icon: isProxy ? '🎯' : '🤝',
        title: isProxy ? `代打任务 · ${inviter}` : `搭档邀请 · ${inviter}`,
        desc,
        dedupeKey: `partner-invite:${data.id}`,
        dedupeMs: 60_000,
      });
      // 老板 2026-10-03：删掉 Windows 弹窗，只留「客服广播那种」置顶横幅 ——
      // 点一下直接打开「订单管理」，在最上面那张卡片里同意 / 拒绝。
      showBannerNotification({
        title: isProxy ? '🎯 代打任务' : '🤝 搭档邀请',
        body: desc,
        icon: isProxy ? '🎯' : '🤝',
        seconds: 20,
        hint: isProxy
          ? '点这里 → 打开订单管理，接受代打任务'
          : '点这里 → 打开订单管理，同意搭档邀请',
        action: 'open-orders',
        actionPayload: { sessionId: data.id },
      });
      playNotificationSound();
    },
    onOrderTransferred: (data: any) => {
      // 有人把单转给我（老板 2026-09-29）：弹一条提醒并刷新接单记录，
      // 别让陪玩端着电脑还不知道自己名下来了单。
      if (data?.toCompanionId && user?.companionId && data.toCompanionId !== user.companionId) return;
      notifyNotice({
        kind: 'order',
        icon: '🔁',
        title: '🔁 有人把订单转让给你',
        desc: `${data?.fromName || '同事'}把「${data?.gameName || ''}」转给了你，去「接单记录」看`,
        href: rolePage(user?.role, 'orders'),
        toast: 'info',
        duration: 6,
      });
      try {
        playNotificationSound();
      } catch {
        /* 声音播不出来不影响提醒 */
      }
      window.dispatchEvent(new Event('chunlv:order-pool-updated'));
    },
    onTransferRequested: (data: any) => {
      // 有人想把单转给我：先问我要不要（老板 2026-10-03，转让必须经被转让方同意）。
      if (!user?.companionId || !data?.requestId) return;
      const fromName = data.fromName || '同事';
      const expiresAt = Date.now() + (Number(data.expiresInSec) || 1800) * 1000;
      addTransferReq({ ...data, fromName, expiresAt });
      const desc = `${data.orderCode || ''} ${data.gameName || ''} · ¥${Number(data.amount || 0).toFixed(1)}${
        data.reason ? ` · ${data.reason}` : ''
      }`;
      recordNotice({
        kind: 'invite',
        icon: '🔁',
        title: `🔁 ${fromName} 想把订单转给你`,
        desc,
        dedupeKey: `transfer-req:${data.requestId}`,
        dedupeMs: 60_000,
      });
      showBannerNotification({
        title: '🔁 订单转让',
        body: `${fromName} 想把「${data.gameName || '订单'}」转给你`,
        icon: '🔁',
        seconds: 20,
        hint: '点这里 → 打开「待我确认的转让」',
        action: 'open-transfer',
        actionPayload: { requestId: data.requestId },
      });
      playNotificationSound();
    },
    onTransferAccepted: (data: any) => {
      notifyNotice({
        kind: 'order',
        icon: '✅',
        title: '✅ 转让已被同意',
        desc: `${data?.toName || '对方'} 同意了，这张单已经转到他名下`,
        href: rolePage(user?.role, 'orders'),
        toast: 'success',
        duration: 5,
      });
      window.dispatchEvent(new Event('chunlv:transfer-updated'));
      window.dispatchEvent(new Event('chunlv:order-pool-updated'));
    },
    onTransferRejected: (data: any) => {
      notifyNotice({
        kind: 'order',
        icon: '🙅',
        title: '🙅 转让被拒绝',
        desc: `${data?.byName || '对方'} 没接这张单${data?.reason ? `（${data.reason}）` : ''}，单还在你名下`,
        href: rolePage(user?.role, 'orders'),
        toast: 'warning',
        duration: 6,
      });
      window.dispatchEvent(new Event('chunlv:transfer-updated'));
    },
    onTransferCancelled: (data: any) => {
      // 两条路都走这里：对方撤回了申请，或我重新发起把旧申请顶掉了。
      if (data?.requestId) removeTransferReq(data.requestId);
      window.dispatchEvent(new Event('chunlv:transfer-updated'));
    },
    onTransferExpired: (data: any) => {
      if (data?.requestId) removeTransferReq(data.requestId);
      notifyNotice({
        kind: 'order',
        icon: '⏰',
        title: '⏰ 转让申请已作废',
        desc: data?.message || '这条转让申请长时间没人确认，已自动作废',
        toast: 'info',
        duration: 5,
      });
      window.dispatchEvent(new Event('chunlv:transfer-updated'));
    },
    onFeedbackChase: (data: any) => {
      // 发单那边的客服在催这一单的结果（老板 2026-09-30：「待反馈……看得见、催得动」）。
      // 这条推给**接单工作室**（桥接店 / 线上俱乐部）的客服和店长：提醒他们去「接单看板」记结果。
      notification.warning({
        message: '📣 对方在催这一单的结果',
        description: `${data?.fromName || '发单客服'} 催「${data?.orderCode || ''} ${data?.gameName || ''}」的接单结果${
          data?.chaseCount ? `（已催 ${data.chaseCount} 次）` : ''
        }，去「客服提成 · 今日看板 → 今天我们店接的单」记一下成功 / 不成功`,
        placement: 'bottomRight',
        duration: 10,
      });
      try {
        playNotificationSound();
      } catch {
        /* 声音播不出来不影响提醒 */
      }
      window.dispatchEvent(new Event('chunlv:received-board-updated'));
    },
    onPartnerAccepted: (data: any) => {
      notifyNotice({
        kind: 'invite',
        icon: '✅',
        title: '✅ 搭档已同意',
        desc: '开始计时，进入接单中，用心服务',
        toast: 'success',
        duration: 4,
      });
      (window as any).electronAPI?.sessionWatch?.(data.sessionId);
      window.dispatchEvent(new Event('chunlv:service-started'));
    },
    onPartnerRejected: (data: any) => {
      notifyNotice({
        kind: 'invite',
        icon: '🙅',
        title: '🙅 搭档已拒绝',
        desc: `${data?.partnerName || '搭档'} 拒绝了你的搭档邀请`,
        toast: 'warning',
        duration: 4,
      });
      window.dispatchEvent(new Event('chunlv:dual-invite-expired'));
    },
    onPartnerTimeout: (data: any) => {
      notifyNotice({
        kind: 'invite',
        icon: '⏰',
        title: '⏰ 搭档未回应',
        desc: '搭档在倒计时内未回应，邀请已自动取消',
        toast: 'info',
        duration: 4,
      });
      window.dispatchEvent(new Event('chunlv:dual-invite-expired'));
    },
    onDualInvite: (data: any) => {
      // 广播找搭档：主陪未指定搭档，工作室任意陪玩可接受，第一个接受者成为搭档
      if (!user?.companionId || !data?.sessionId) return;
      if (data?.companionId === user.companionId) return; // 主陪自己不看自己的广播
      if (cancelCompanionUpdateForService()) message.info('软件正在更新，已推迟到空闲后');
      const inviter = data.inviterName || '有陪玩';
      const desc = `${inviter}广播找搭档：${data.gameName || ''} · 搭档金额 ¥${Number(data.amount || 0).toFixed(1)} · ${data.duration || 1}h`;
      const ttl = data.expiresInSec ?? 15;
      addPartnerInvite({
        sessionId: data.sessionId,
        inviterName: inviter,
        gameName: data.gameName || '',
        amount: Number(data.amount || 0),
        duration: data.duration || 1,
        expiresAt: Date.now() + ttl * 1000,
      });
      recordNotice({
        kind: 'invite',
        icon: '📣',
        title: '📣 广播找搭档',
        desc,
        dedupeKey: `dual-invite:${data.sessionId}`,
        dedupeMs: 60_000,
      });
      showBannerNotification({
        title: '📣 广播找搭档',
        body: desc,
        icon: '📣',
        seconds: 20,
        hint: '点这里 → 打开订单管理，同意搭档邀请',
        action: 'open-orders',
        actionPayload: { sessionId: data.sessionId },
      });
      playNotificationSound();
    },
    onDualInviteExpired: (data: any) => {
      const sid = data?.sessionId;
      if (sid) {
        notification.destroy(`dual-invite-${sid}`);
        notification.destroy(`dual-broadcast-${sid}`);
        removePartnerInvite(sid);
      }
      window.dispatchEvent(new Event('chunlv:dual-invite-expired'));
    },
    onServiceHandoff: (data: any) => {
      // 换主陪：原主陪把订单交给自己启动，这里开启自己的计时和工作记录
      notifyNotice({
        kind: 'order',
        icon: '🤝',
        title: '🤝 有陪玩把订单交给你',
        desc: '已进入接单中，用心服务',
        href: rolePage(user?.role, 'orders'),
        toast: 'success',
        duration: 4,
      });
      (window as any).electronAPI?.sessionWatch?.(data?.sessionId);
      window.dispatchEvent(new Event('chunlv:service-started'));
    },
    onSegmentFinished: (data: any) => {
      const amount = Number(data?.amount || 0).toFixed(1);
      const desc = data?.message || `你这一段服务已结束，本段计入业绩 ¥${amount}`;
      notifyNotice({
        kind: 'order',
        icon: '🏁',
        title: '🏁 这一段服务已结束',
        desc,
        href: rolePage(user?.role, 'orders'),
        toast: 'info',
        duration: 6,
      });
      showBannerNotification({
        title: '🏁 这一段服务已结束',
        body: desc,
        icon: '🏁',
        seconds: 12,
        hint: '点这里 → 去接单记录看',
        action: 'open-orders',
      });
    },
    onServiceDurationReminder: (data: any) => {
      // 老板 2026-10-05：「不点结束不会计入影响评分增加，让他们主动点」——
      // 这条提醒现在带「不点结束不计业绩/不算分」，而且服务端每 30 分钟会再推一次（没结束就一直提醒）。
      const desc =
        data?.message ||
        '服务时间已到，请引导客户续单；打完记得点「结束服务」，不点结束这一单不算业绩也不算分';
      const overdue = Number(data?.overdueMin) || 0;
      const title = overdue >= 5 ? '⏰ 还没点「结束服务」' : '⏰ 时间到了';
      notifyNotice({
        kind: 'order',
        icon: '⏰',
        title,
        desc,
        href: rolePage(user?.role, 'orders'),
        toast: 'warning',
        duration: 8,
        // 同一段服务 30 分钟内只在铃铛里留一条，别把通知中心刷满
        dedupeKey: `duration-reminder:${data?.sessionId || ''}`,
        dedupeMs: 30 * 60 * 1000,
      });
      const electronApi = (window as any).electronAPI;
      if (electronApi?.durationReminderPopup) {
        electronApi.durationReminderPopup({
          title,
          body: desc,
          hint: '点这里 → 去接单记录点「结束服务」',
          seconds: 20,
        });
      } else {
        showBannerNotification({
          title,
          body: desc,
          icon: '⏰',
          seconds: 20,
          hint: '点这里 → 去接单记录点「结束服务」',
          action: 'open-orders',
        });
      }
      // 到点语音提醒：店长在后台设内容，陪玩自己选声线/音量。
      // 先取配置；取不到就用固定短句，避免把整段说明念几十秒。
      http.get('/config', { params: { keys: 'service.voice_reminder_text' } })
        .then(({ data }: any) => {
          const text = String(data?.data?.['service.voice_reminder_text'] || '').trim()
            || '服务时间到了，请结束服务';
          if (!speakVoiceReminder(text)) playNotificationSound();
        })
        .catch(() => {
          if (!speakVoiceReminder('服务时间到了，请结束服务')) playNotificationSound();
        });
    },
    onServiceAutoEnded: (data: any) => {
      showSystemNotification(
        '⏰ 服务已自动结束',
        data?.message || '服务到点后仍未处理，已自动结束并计入业绩；游戏不会退出，打完后请切回空闲',
      );
    },
    onStateSync: (data: any) => {
      // 服务端心跳对账后的权威状态：只覆盖本地，不反向再发 status，避免来回打架。
      const status = String(data?.status || '');
      if (!['AVAILABLE', 'BUSY', 'ENTERTAINMENT', 'RESTING', 'OFFLINE'].includes(status)) return;
      try {
        (window as any).__showStatusBar?.(status);
        (window as any).electronAPI?.storeSet?.('lastStatus', status);
        window.dispatchEvent(new CustomEvent('chunlv:runtime-state', { detail: data }));
      } catch {}
    },
    onEntertainmentForceIdle: (data: any) => {
      // 服务端因娱乐余额不足把状态切成 AVAILABLE 时，必须同步客户端本地 lastStatus；
      // 否则本地还停在 ENTERTAINMENT，黑名单继续按娱乐列表走，三角洲就不会被杀。
      try {
        (window as any).__showStatusBar?.('AVAILABLE');
        (window as any).electronAPI?.onStatusChanged?.('AVAILABLE');
        window.dispatchEvent(new Event('chunlv:entertainment-force-idle'));
      } catch {}
      showBannerNotification({
        title: '娱乐余额不足，已切回空闲',
        body: data?.message || '业绩/押金不够继续娱乐，已自动切回空闲；请先接单或休息。',
        icon: '⏰',
        seconds: 12,
      });
    },
    onOrderPoolUpdated: (data: any) => {
      // 同 onOrderNew：陪玩端的新广播单要等弹窗那一下再刷新，避免订单池先出现。
      const isNewPending =
        data?.status === 'PENDING'
        && (data?.dispatchType === 'POOL' || data?.dispatchType === 'BROADCAST');
      if (user?.role === 'COMPANION' && isNewPending) return;
      window.dispatchEvent(new Event('chunlv:order-pool-updated'));
    },
    // 群聊广播：客服/店长发广播后，陪玩电脑右下角弹 Windows 提醒，5 秒后自动消失
    onChatBroadcast: (data: any) => {
      if (user?.role !== 'COMPANION') return;
      const senderName = data?.senderName || '客服';
      const content = String(data?.content || '').trim();
      if (!content) return;
      const title = `📢 ${senderName} 广播`;
      // 群聊广播也走 Windows 通知，不再画置顶窗。
      showSystemNotification(title, content);
      playNotificationSound();
    },
    onOrderUrgent: (data: any) => {
      if (user?.role === 'COMPANION') {
        // 老板 2026-10-01：新单只弹 Windows 桌面横幅（15 秒），软件里那张右下角卡片不再弹。
        // 横幅只在陪玩客户端里有；浏览器里打开时没有横幅，保留卡片兑底，免得什么都看不见。
        if (!(window as any).electronAPI?.orderBannerClick) setUrgentOrder(data);
        window.dispatchEvent(new Event('chunlv:order-pool-updated'));
        // 老板 2026-09-22 报「邵泽慧发广播单，所有人都没弹窗提示」：
        // 以前只有窗口里那张右下角卡片，窗口被游戏挡住 / 缩到托盘时看不到也听不到，
        // 一单就这么错过了。这里补上提示音 + Windows 系统通知，后台也能被叫到。
        playNotificationSound();
        const urgentDesc = `${data?.gameName || '新订单'} · ¥${Number(data?.amount || 0).toFixed(0)} · ${
          data?.duration || 1
        }h · ${data?._createdBy || '系统'} 发布，快去抢`;
        recordNotice({
          kind: 'order',
          icon: data?._direct ? '🎯' : '⚡',
          title: data?._direct ? '🎯 客服指定给你接单' : `⚡ 新订单 · ${data?.gameName || ''}`,
          desc: urgentDesc,
          href: '/companion/pool',
          dedupeKey: `urgent:${data?.id || data?.orderCode || urgentDesc}`,
          dedupeMs: 5 * 60_000,
        });
        // 统一由网页侧发 Windows 通知；主进程只闪任务栏，避免一条单弹两次。
        showSystemNotification(
          data?._direct ? '🎯 客服指定给你接单' : `⚡ 新订单 · ${data?.gameName || ''}`,
          urgentDesc,
        );
      }
    },
    onScheduledReminder: (data: any) => {
      if (user?.role === 'CS' || user?.role === 'ADMIN' || user?.role === 'OWNER') {
        const text = data.message || '你发布的预约单已超时未接，请跟进对接客户';
        message.warning({ content: text, duration: 10 });
        recordNotice({
          kind: 'order',
          icon: '⏰',
          title: '预约单超时未接',
          desc: text,
          href: rolePage(user?.role, 'orders'),
        });
      }
    },
    onWalletReviewed: (data: any) => {
      const text = data.message || `支取 ¥${data.amount} ${data.status === 'APPROVED' ? '已通过' : '已拒绝'}`;
      message.info(text);
      recordNotice({
        kind: 'finance',
        icon: '💰',
        title: data.status === 'APPROVED' ? '支取已通过' : '支取被拒绝',
        desc: text,
        href: rolePage(user?.role, 'billing'),
      });
    },
    onUserAuthorized: (data: any) => {
      const text = data.message || '注册申请已通过审核';
      message.success(text, 6);
      recordNotice({ kind: 'audit', icon: '✅', title: '注册申请已通过审核', desc: text });
    },
    onUserRejected: (data: any) => {
      const text = data.message || '注册申请未通过审核';
      message.warning(text, 6);
      recordNotice({ kind: 'audit', icon: '⛔', title: '注册申请未通过审核', desc: text });
    },
    onWorkWechatRequest: (data: any) => {
      // 陪玩自己填了工作微信，等管理端审核（老板 2026-10-02）
      const text = data?.wechatId
        ? `有陪玩提交了工作微信「${data.wechatId}」，待审核`
        : '有陪玩提交了工作微信，待审核';
      message.info(text, 8);
      recordNotice({
        kind: 'audit',
        icon: '📱',
        title: '待审核：陪玩提交的工作微信',
        desc: text,
        href: rolePage(user?.role, 'work-wechats'),
      });
      // 左侧「陪玩工作微信」的数字直接按服务端待审数刷新，不靠这条消息本身“活着”。
      window.dispatchEvent(new Event('chunlv:work-wechat-refresh'));
    },
    onSupplementRequest: (data: any) => {
      // 陪玩点了「添加失败」提交补单申请（老板 2026-10-04：这种交互双方都要有提示）
      const isMgmt = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS';
      if (!isMgmt) return;
      const text = data?.message || '有陪玩提交了补单申请，待审核';
      message.info(text, 8);
      recordNotice({
        kind: 'audit',
        icon: '🧾',
        title: '待审核：补单申请',
        desc: text,
        href: rolePage(user?.role, 'orders'),
        dedupeKey: `supplement-req-${data?.orderId || data?.companionId || ''}`,
        dedupeMs: 60 * 1000,
      });
      // 让「订单管理 → 补单审核」的红点立刻刷新（否则要等它自己的 60 秒轮询）
      window.dispatchEvent(new CustomEvent('supplement:refresh'));
    },
    onSupplementDecided: (data: any) => {
      // 管理端同意 / 驳回补单 → 实时告诉陪玩本人（老板 2026-10-04）
      if (user?.role !== 'COMPANION') return;
      const approved = data?.approved !== false;
      const text =
        data?.message || (approved ? '管理端已同意补单，你的抢单次数 +1' : '管理端驳回了补单申请');
      if (approved) message.success(text, 8);
      else message.warning(text, 8);
      recordNotice({
        kind: 'audit',
        icon: approved ? '✅' : '⛔',
        title: approved ? '补单已同意：抢单次数 +1' : '补单被驳回',
        desc: data?.note ? `${text}（备注：${data.note}）` : text,
        href: rolePage(user?.role, 'orders'),
      });
    },
    onOrderContactReminder: (data: any) => {
      // 抢单后迟迟没标「添加成功 / 添加失败」→ 定期提醒陪玩本人（老板 2026-10-04）
      const text = data?.message || '订单还没标记「添加成功 / 添加失败」，记得处理';
      const stage = Number(data?.stage) || 1;
      const title = stage > 1 ? `🔔 再次提醒（第 ${stage} 次）` : '🔔 记得标记客户微信';
      notifyNotice({
        kind: 'order',
        icon: '🔔',
        title,
        desc: text,
        href: rolePage(user?.role, 'orders'),
        toast: 'warning',
        duration: 8,
      });
      showBannerNotification({
        title,
        body: text,
        icon: '🔔',
        seconds: 15,
        hint: '点这里 → 去订单管理标记',
        action: 'open-orders',
      });
    },
    onReviewNotice: (data: any) => {
      // 通用「审核 / 交互」提醒（老板 2026-10-04）：
      // 报账 / 支取 / 战绩图 / 客户删除申请 / 封存解封 / 桥接 / 注册 —— 提交方和审核方双方都能收到。
      const isMgmt = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS';
      const isCompanion = user?.role === 'COMPANION';
      const audience = data?.audience;
      if (audience === 'MGMT' && !isMgmt) return;
      if (audience === 'COMPANION' && !isCompanion) return;
      notifyNotice({
        kind: data?.kind || 'audit',
        icon: data?.icon || '🔔',
        title: data?.title || '有新的待办',
        desc: data?.desc || '',
        href: rolePage(user?.role, data?.hrefKey || 'orders'),
        toast: data?.toast || 'info',
        duration: 8,
        dedupeKey: data?.dedupeKey,
        dedupeMs: data?.dedupeMs || 60 * 1000,
      });
    },
    onOrderContactReminderAdmin: (data: any) => {
      // 客户微信满 3 天 / 满 7 天没处理（老板 2026-10-04）：
      // 只落进「待办」（右上角铃铛，带红点角标），不弹窗打扰；
      // 人工去对应的小红书账号私信问问客户还加不加，客户也不回就把客户封存起来。
      const isMgmt = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS';
      if (!isMgmt) return;
      const long = data?.kind === 'LONG_PENDING';
      const count = Number(data?.count) || 0;
      const text =
        data?.message ||
        (long ? '有客户挂满 7 天还没通过，请核实' : '有客户 3 天没标记「添加成功 / 添加失败」，请核实');
      recordNotice({
        kind: 'order',
        icon: long ? '🧊' : '🧹',
        title: long
          ? `长期挂起客户${count ? ` ${count} 个` : ''}：去小红书问问 / 该封存了`
          : `客户微信没标记${count ? ` ${count} 个` : ''}：去核实`,
        desc: text,
        href: rolePage(user?.role, 'customers'),
        dedupeKey: `contact-reminder-${data?.kind || 'unknown'}`,
        dedupeMs: 12 * 60 * 60 * 1000,
      });
    },
    onOrderUnstartedReminder: (data: any) => {
      // 老板 2026-10-06：「次日弹一次、后边第七天弹一次，然后进历史记录。」
      // 抢了单一直没点「开始首单」、也没报结果的，服务端只在满 24 小时、满 7 天各催一次（共 2 次）。
      const text =
        data?.message ||
        '你有订单抢到手还没点「开始首单」也没报结果：打成了就点「开始首单」；没打成请点「报结果」，选原因 + 贴截图';
      const count = Number(data?.count) || 0;
      const stage = Number(data?.stage) || 1;
      const maxReminders = Number(data?.maxReminders) || 2;
      const what = count > 1 ? `有 ${count} 单抢了还没点「开始首单」` : '抢了单还没点「开始首单」';
      const title = stage >= maxReminders ? `🔔 最后一次提醒：${what}` : `🔔 ${what}`;
      notifyNotice({
        kind: 'order',
        icon: '🔔',
        title,
        desc: text,
        href: rolePage(user?.role, 'orders'),
        toast: 'warning',
        duration: 8,
        // 同一个人半天内只在铃铛里留一条，别把通知中心刷满
        dedupeKey: `unstarted-reminder:${user?.id || 'me'}`,
        dedupeMs: 12 * 60 * 60 * 1000,
      });
      showBannerNotification({
        title,
        body: text,
        icon: '🔔',
        seconds: 15,
        hint: '点这里 → 去订单管理点「报结果」',
        action: 'open-orders',
      });
    },
    onOrderOutcomeReport: (data: any) => {
      // 接单方报了结果（老板 2026-10-06）：成功 → 计入考核；不成功 → 先由发单客服跟接单方核对，
      // 核对完才轮到店长拍板。所以失败这条只找发单客服（服务端就只推给他）。
      const failed = data?.outcome === 'FAILED';
      const code = data?.orderCode || '这一单';
      const text =
        data?.message ||
        (failed ? `接单方报了「不成功」（${code}），先跟接单方核对一下` : `接单方报了「成功」（${code}）`);
      const title = failed ? `🔔 先跟接单方核对：${code}` : `✅ 接单方报了成功：${code}`;
      notifyNotice({
        kind: 'order',
        icon: failed ? '🔔' : '✅',
        title,
        desc: text,
        href: rolePage(user?.role, 'orders'),
        toast: failed ? 'warning' : 'success',
        duration: 8,
        dedupeKey: `outcome-report:${data?.orderId || code}`,
        dedupeMs: 6 * 60 * 60 * 1000,
      });
      if (failed && user?.role !== 'COMPANION') {
        // 陪玩没有「成交核对」页（发单人不是他时不该弹），所以横幅只给客服 / 店长 / 老板。
        showBannerNotification({
          title,
          body: text,
          icon: '🔔',
          seconds: 15,
          hint: '点这里 → 去「订单管理 → 成交核对」核对',
          action: 'open-orders',
        });
      }
    },
    onOrderOutcomeCsConfirmed: (data: any) => {
      // 客服核对完 → 该店长 / 老板拍板了（老板 2026-10-06）。接单方那边只留一条通知，不弹窗。
      const code = data?.orderCode || '这一单';
      const isReviewer = user?.role === 'OWNER' || user?.role === 'ADMIN';
      notifyNotice({
        kind: 'audit',
        icon: '🧾',
        title: `可以拍板了：${code}`,
        desc: data?.message || '发单客服已跟接单方核对完（双方无异议），等店长拍板',
        href: rolePage(user?.role, 'orders'),
        toast: isReviewer ? 'info' : 'none',
        duration: 8,
        dedupeKey: `outcome-cs-confirmed:${data?.orderId || code}`,
        dedupeMs: 6 * 60 * 60 * 1000,
      });
    },
    onOrderOutcomeRejected: (data: any) => {
      // 店长 / 老板把接单方的「不成功」说明打回了（老板 2026-10-06：乱写就驳回）：
      // 接单方要重新填原因 + 重贴截图再报一次；发单客服先不用核对这张，只留个通知。
      const code = data?.orderCode || '这一单';
      const note = (data?.note || '').toString().trim();
      const isCompanion = user?.role === 'COMPANION';
      notifyNotice({
        kind: 'order',
        icon: '↩️',
        title: isCompanion ? `店长把你的说明打回了：${code}` : `接单方说明被打回：${code}`,
        desc:
          data?.message ||
          (isCompanion
            ? `店长把这张单的「不成功」说明打回了${note ? `（${note}）` : ''}，请重新填清楚原因、重新贴截图再报一次`
            : `店长把接单方的「不成功」说明打回了${note ? `（${note}）` : ''}，让他重填，你先不用核对这张`),
        href: rolePage(user?.role, 'orders'),
        toast: isCompanion ? 'warning' : 'none',
        duration: 10,
        dedupeKey: `outcome-rejected:${data?.orderId || code}`,
        dedupeMs: 6 * 60 * 60 * 1000,
      });
      if (isCompanion) {
        showBannerNotification({
          title: `↩️ 店长打回了 ${code} 的说明`,
          body: (note ? `${note}
` : '') + '请重新填清楚原因、重新贴截图，再报一次结果',
          icon: '↩️',
          seconds: 20,
          hint: '点这里 → 去「订单管理」重新报结果',
          action: 'open-orders',
        });
      }
    },
    onOrderUnstartedReminderAdmin: (data: any) => {
      // 满 7 天还没处理 → 只落进「待办」（右上角铃铛），不弹窗打扰；人工去「成交核对 → 抢了没结果」核。
      const isMgmt = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS';
      if (!isMgmt) return;
      const count = Number(data?.count) || 0;
      recordNotice({
        kind: 'order',
        icon: '🧾',
        title: `抢了没结果的单${count ? ` ${count} 个` : ''}：满 7 天了，去核一下`,
        desc:
          data?.message ||
          '有订单抢走满 7 天还没点「开始首单」也没报结果，去「订单管理 → 成交核对 → 抢了没结果」处理',
        href: rolePage(user?.role, 'orders'),
        dedupeKey: 'unstarted-reminder-admin',
        dedupeMs: 12 * 60 * 60 * 1000,
      });
    },
    onBridgeResponded: (data: any) => {
      const text = data.message || (data.accepted ? '对方已同意桥接申请' : '对方已拒绝桥接申请');
      message.info(text);
      recordNotice({
        kind: 'system',
        icon: data.accepted ? '🔗' : '🚫',
        title: data.accepted ? '桥接申请已同意' : '桥接申请被拒绝',
        desc: text,
      });
    },
    onRevenueDiff: (data: any) => {
      const isMgmt = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS';
      if (isMgmt && data.message) {
        message.warning({ content: data.message, duration: 10 });
        recordNotice({ kind: 'finance', icon: '📉', title: '营收差异提醒', desc: data.message });
      }
    },
    onReviewAlert: (data: any) => {
      const isMgmt = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS';
      if (isMgmt) {
        setReviewBadge((p) => p + 1);
        const text = `工作抽查：${data.companionName} 存在异常（${data.reason || data.level || '异常'}），请到「陪玩管理 → 陪玩列表」核查他的工作记录`;
        message.warning({ content: text, duration: 10 });
        // 「查看」直接落到这个人的工作记录，并把异常那一条高亮出来（老板 2026-10-05：
        // 以前只跳到陪玩列表 / 实名审核，什么都没标出来，根本找不到是哪一条）。
        const base = user?.role === 'CS' ? '/cs/employees' : '/admin/companions';
        const params = new URLSearchParams({ role: 'COMPANION' });
        if (data.companionId) params.set('workCompanion', data.companionId);
        if (data.sessionId) params.set('workSession', data.sessionId);
        if (data.companionName) params.set('workName', data.companionName);
        recordNotice({
          kind: 'audit',
          icon: '🛡️',
          title: `工作抽查异常 · ${data.companionName || ''}`,
          desc: text,
          href: data.companionId ? `${base}?${params.toString()}` : rolePage(user?.role, 'audits'),
        });
      }
    },
    onCsAccountAnomaly: (data: any) => {
      if (user?.role === 'CS' && data.message) {
        message.warning({ content: data.message, duration: 12 });
        showBannerNotification({
          title: '⚠️ 账目异常',
          body: data.message,
          icon: '⚠️',
          seconds: 15,
          hint: '点这里 → 去账目看',
          action: 'open-billing',
        });
        recordNotice({
          kind: 'finance',
          icon: '⚠️',
          title: '账目异常',
          desc: data.message,
          href: rolePage(user?.role, 'billing'),
        });
      }
    },
  });


  return voiceSocketRef;
}
