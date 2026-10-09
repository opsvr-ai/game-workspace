// craftsman-ignore: TS001
/**
 * 「独立聊天窗口 ↔ 主程序窗口」的语音通道。
 *
 * 老板 2026-10-10：「为什么点聊天框的语音按钮没反应？」
 *
 * 根因：聊天现在默认开成**独立的系统窗口**（老板 2026-10-05「跟微信一样，一个联系人一个窗口」），
 * 而语音通话整套东西（useVoiceCall + 来电弹窗 + 通话条 + 那个 `start-voice-call` 监听）
 * **只装在 AppLayout 里**（= 主程序窗口）。聊天窗口渲染的 ChatHeader 一样有电话按钮，
 * 点下去只是往自己窗口里 dispatch 了一个没人听的 CustomEvent —— 所以「一点反应都没有」，
 * 连一句提示都没有。（这条路径 2026-10-05 起就是坏的：在那之前点人是开页内浮窗，浮窗在 AppLayout 里，语音是好的。）
 *
 * 为什么不让聊天窗口自己也打：一个账号的所有 socket 都进服务端 `user:<id>` 房间，
 * `notifyUser()` 是往这个房间广播 —— 聊天窗口要是也装了语音，**开 3 个聊天窗口，来电话就同时响 3 个**。
 * 所以规矩是：**一个窗口（主程序）管打/接，别的窗口只显示**。
 *   · 聊天窗口点电话 → 请主程序窗口去打（跨窗口通道 + 回执，跟 utils/windowNav.ts 同一套写法：
 *     localStorage 写一个键，同源的其他窗口收 storage 事件；写的人自己收不到，正好不会自己叫自己）；
 *   · 主程序窗口把通话状态镜像出来 → 聊天窗口顶上照样能看到「正在语音通话 mm:ss」；
 *   · 主程序窗口不在（被关了）→ 明确告诉人「去任务栏打开主程序再点」，不再是一点没反应。
 */

import { message } from './feedback';
import { useVoiceCallStore, type ActiveVoiceCall } from '../stores/voiceCallStore';

const REQ_KEY = 'chunlv:voice-call-request';
const ACK_KEY = 'chunlv:voice-call-ack';
const STATE_KEY = 'chunlv:voice-call-state';

export interface VoiceCallRequest {
  id: string;
  targetUserId: string;
  targetUserName?: string;
  at: number;
}

interface VoiceCallAck {
  id: string;
  ok: boolean;
  reason?: string;
  at: number;
}

let voiceOwnerMounted = false;

/** 主程序窗口（AppLayout）挂载时标记自己「有语音能力」；聊天窗口永远不会标记。 */
export function setVoiceOwner(on: boolean): void {
  voiceOwnerMounted = on;
}

/** 这个窗口自己能不能直接打电话（主程序窗口 / 页内浮窗 = 能；独立聊天窗口 = 不能）。 */
export function isVoiceOwner(): boolean {
  return voiceOwnerMounted;
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * 主程序窗口这边：听到「请打这个电话」就去打。
 * handler 返回 null = 已受理；返回字符串 = 打不了（原因会原样回给点按钮的那个窗口，比如「正在通话中，请先挂断」）。
 */
export function installVoiceCallRequestListener(handler: (req: VoiceCallRequest) => string | null): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== REQ_KEY || !e.newValue) return;
    let req: VoiceCallRequest;
    try {
      req = JSON.parse(e.newValue) as VoiceCallRequest;
    } catch {
      return; // 不是我们写的，忽略
    }
    if (!req?.id || !req?.targetUserId) return;
    let reason: string | null = null;
    try {
      reason = handler(req);
    } catch {
      reason = '发起通话失败，请重试';
    }
    try {
      // Windows 有前台锁定，顶不顶得到最前看系统；通话界面（通话条 / 来电弹窗）在主程序窗口里。
      window.focus();
    } catch {
      /* 忽略 */
    }
    try {
      const ack: VoiceCallAck = { id: req.id, ok: !reason, reason: reason || undefined, at: Date.now() };
      localStorage.setItem(ACK_KEY, JSON.stringify(ack));
    } catch {
      /* 存不下就算了 */
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/** 聊天窗口这边：请主程序窗口发起通话 —— 拿到回执（或超时）就结束。 */
export function requestVoiceCallInOtherWindow(
  targetUserId: string,
  targetUserName: string,
  timeoutMs = 900,
): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    let done = false;
    const id = newId();
    const finish = (result: { ok: boolean; reason?: string }) => {
      if (done) return;
      done = true;
      window.removeEventListener('storage', onStorage);
      window.clearTimeout(timer);
      resolve(result);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ACK_KEY || !e.newValue) return;
      try {
        const ack = JSON.parse(e.newValue) as VoiceCallAck;
        if (ack?.id === id) finish({ ok: !!ack.ok, reason: ack.reason });
      } catch {
        /* 不是我们写的，忽略 */
      }
    };
    window.addEventListener('storage', onStorage);
    const timer = window.setTimeout(() => finish({ ok: false }), timeoutMs);
    try {
      const req: VoiceCallRequest = { id, targetUserId, targetUserName, at: Date.now() };
      localStorage.setItem(REQ_KEY, JSON.stringify(req));
    } catch {
      finish({ ok: false });
    }
  });
}

/**
 * 点「语音通话」按钮的唯一入口 —— ChatPanel 里就调这一个。
 * 本窗口有语音能力就自己打；没有（独立聊天窗口）就交给主程序窗口去打，并把结果说清楚。
 */
export function startVoiceCallFromCurrentWindow(
  targetUserId: string,
  targetUserName: string,
): void {
  if (!targetUserId) return;
  if (isVoiceOwner()) {
    window.dispatchEvent(
      new CustomEvent('start-voice-call', { detail: { targetUserId, targetUserName } }),
    );
    return;
  }
  void requestVoiceCallInOtherWindow(targetUserId, targetUserName).then((res) => {
    if (res.ok) {
      message.info(`已让主程序发起通话：${targetUserName || '对方'}`);
      return;
    }
    if (res.reason) {
      message.warning(res.reason);
      return;
    }
    message.warning('没找到主程序窗口，先在任务栏（或右下角托盘）打开主程序，再点一次语音按钮');
  });
}

/** 主程序窗口：把通话状态镜像出去（存储键一改，同源的其他窗口都收得到）。 */
export function publishVoiceCallState(call: ActiveVoiceCall): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...call, at: Date.now() }));
  } catch {
    /* 忽略 */
  }
}

/** 聊天窗口：把主程序窗口镜像出来的通话状态搬进本窗口的 store —— 顶上那行「正在语音通话」才会显示。 */
export function installVoiceCallStateMirror(): () => void {
  const apply = (raw: string | null) => {
    if (!raw) return;
    try {
      const state = JSON.parse(raw) as ActiveVoiceCall;
      if (!state?.status) return;
      useVoiceCallStore.getState().setCall({
        status: state.status,
        peerId: state.peerId,
        peerName: state.peerName,
        duration: state.duration,
      });
    } catch {
      /* 忽略 */
    }
  };
  apply(localStorage.getItem(STATE_KEY));
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STATE_KEY) return;
    apply(e.newValue);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
