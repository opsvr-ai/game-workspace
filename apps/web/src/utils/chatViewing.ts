/**
 * 「这个人现在是不是真的在看这个会话」——聊天已读 / 未读的唯一判据。
 *
 * 为什么不能只看 activeConversationId：
 *   客服开着一个聊天窗口，然后切去别的软件 / 最小化 / 被主窗口盖住，旧逻辑仍然算「正在看」，
 *   新消息一到就自动标已读、不响、不计未读 —— 徐瑜 2026-10-18 21:42 发邵泽慧的消息就是这样
 *   直接被标已读的（服务端日志里消息 13:42:59.493 落库，13:42:59.583 就来了 read）。
 *
 * 现在把「打开的是哪个会话」和「这个窗口有没有焦点 / 是否可见」分开：
 *   · 只有 **窗口可见 + 有焦点 + 当前会话就是它** 才算正在看；
 *   · 多个聊天窗口通过 BroadcastChannel 互相同步（客服同时开好几个聊天窗口，主窗口不能
 *     因为自己没焦点就把别的聊天窗口正在看的消息又算成未读）；
 *   · 窗口最小化 / 被遮挡 / 切到别的应用 → 不算正在看，新消息照常计未读、响、标红。
 *
 * jsdom / 老环境没有 BroadcastChannel 时退化为只看本窗口，不影响功能。
 */
type ViewState = { roomId: string | null; focused: boolean; at: number };

let ownRoomId: string | null = null;
let ownFocused = typeof document !== 'undefined' ? document.hasFocus() : true;
let ownVisible = typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true;

const remote = new Map<string, ViewState>();
const REMOTE_TTL_MS = 15_000;
const CHANNEL_NAME = 'chunlv-chat-viewing';
const WINDOW_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const channel: BroadcastChannel | null =
  typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(CHANNEL_NAME)
    : null;

function currentState(): ViewState {
  return { roomId: ownRoomId, focused: ownFocused, at: Date.now() };
}

function announce(): void {
  try {
    channel?.postMessage({ type: 'state', sender: WINDOW_ID, ...currentState() });
  } catch {
    /* 关窗瞬间可能抛，忽略 */
  }
}

if (channel) {
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data;
    if (data?.type === 'state' && data.sender) {
      remote.set(String(data.sender), {
        roomId: data.roomId ?? null,
        focused: !!data.focused,
        at: Number(data.at) || Date.now(),
      });
    } else if (data?.type === 'request') {
      announce();
    }
  };
}

if (typeof window !== 'undefined') {
  const refresh = () => {
    ownFocused = document.hasFocus();
    ownVisible = document.visibilityState !== 'hidden';
    announce();
  };
  window.addEventListener('focus', refresh);
  window.addEventListener('blur', refresh);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('beforeunload', () => {
    ownRoomId = null;
    ownFocused = false;
    announce();
  });
  // 定期心跳：另一个窗口刚打开时也能拿到「谁在看哪个会话」的现状。
  window.setInterval(() => {
    ownFocused = document.hasFocus();
    ownVisible = document.visibilityState !== 'hidden';
    announce();
  }, 5_000);
  announce();
}

/** 当前窗口切换到哪个会话（null = 没开聊天）。打开 / 关闭 / 最小化 / 还原时调用。 */
export function setChatViewRoom(roomId: string | null): void {
  ownRoomId = roomId;
  announce();
}

/** 当前窗口是否可见且有焦点（最小化 / 切到别的软件为 false）。 */
export function isWindowActivelyViewing(): boolean {
  return ownVisible && ownFocused;
}

/**
 * 这个会话是否正被**任意一个**窗口真正看着。
 * 本窗口有焦点优先；否则看其他聊天窗口上报的状态（15 秒内）。
 */
export function isRoomBeingViewed(roomId: string | null | undefined): boolean {
  if (!roomId) return false;
  if (ownRoomId === roomId && ownVisible && ownFocused) return true;
  const now = Date.now();
  for (const state of remote.values()) {
    if (state.roomId === roomId && state.focused && now - state.at < REMOTE_TTL_MS) return true;
  }
  return false;
}
