// 系统级通知：当陪玩端最小化/在聊微信时，也能弹出 Windows 通知。
export function showSystemNotification(title: string, body: string) {
  try {
    const electronApi = (window as any).electronAPI;
    if (electronApi?.notify) {
      electronApi.notify(title, body);
      return;
    }
    const N = (window as any).Notification;
    if (!N) return;
    const show = () => {
      try {
        new N(title, { body });
      } catch {
        /* ignore */
      }
    };
    if (N.permission === 'granted') {
      show();
    } else if (N.permission !== 'denied' && typeof N.requestPermission === 'function') {
      const p = N.requestPermission();
      if (p && typeof p.then === 'function') {
        p.then((res: string) => {
          if (res === 'granted') show();
        }).catch(() => {});
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * 统一提醒（老板 2026-10-03）。
 *
 * 原话：「王昊通过客户管理点开始首单邀请王甲振，王甲振弹了 windows 弹窗 + 软件弹窗，
 * 但点 windows 的弹窗并没有跳转到软件内；客服发布订单时的弹窗就挺好的，
 * 陪玩游戏画面右下角也能弹出来消息，点击能直接跳转到软件内。
 * 所有涉及弹窗或者邀请的，你都给我做成客服发布订单时广播那个效果吧。」
 *
 * 所以：搭档邀请 / 找搭档 / 订单转让 / 有人@你 / 服务结束 / 时间提醒 / 账目异常
 * 全部改成陪玩端那张置顶横幅（游戏中也在最上层），点一下就把客户端拉到前台并打开对应界面。
 * 以前走的是 new Notification —— 点了本来就不跳，全屏游戏里还常被系统静默吞掉。
 *
 * 浏览器里打开时没有横幅能力，退回原来的系统通知，行为不变。
 */
export interface BannerNotificationOptions {
  title: string;
  body: string;
  icon?: string;
  seconds?: number;
  /** 横幅下面那行黄色提示，例如「点这里 → 打开搭档邀请」 */
  hint?: string;
  /** 点击后要打开什么：open-partner-invite / open-transfer / open-orders / open-pool / open-billing / open-chat */
  action?: string;
  /** 动作需要的数据（例如 open-chat 的 conversationId） */
  actionPayload?: Record<string, unknown> | null;
  /** 没有横幅能力时（浏览器）是否仍发系统通知，默认 true */
  fallbackNotification?: boolean;
}

export function showBannerNotification(opts: BannerNotificationOptions) {
  try {
    const electronApi = (window as any).electronAPI;
    if (electronApi?.broadcastPopup) {
      electronApi.broadcastPopup({
        title: opts.title,
        body: opts.body,
        icon: opts.icon,
        seconds: opts.seconds,
        hint: opts.hint,
        action: opts.action,
        actionPayload: opts.actionPayload,
      });
      return;
    }
  } catch {
    /* 横幅失败时退回系统通知，别两边都看不到 */
  }
  if (opts.fallbackNotification !== false) showSystemNotification(opts.title, opts.body);
}

// 提示音：搭配重要提醒（如搭档邀请）一起用，陪玩端最小化/在打游戏时也能听到。
export function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const play = (freq: number, at: number, dur: number) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur + 0.05);
    };
    const t = ctx.currentTime;
    play(880, t, 0.12);
    play(880, t + 0.16, 0.12);
    setTimeout(() => { try { ctx.close(); } catch {} }, 600);
  } catch {
    /* ignore */
  }
}
