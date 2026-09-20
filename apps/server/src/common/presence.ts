/**
 * 客户端在线注册表（纯内存，不落库）。
 *
 * 背景：老板 2026-09-21 报「hanlei1 又掉线了」。
 * 客服 / 店长 / 老板 的在线状态以前只有一个来源——网页里那个「窗口可见才上报」的
 * cs-heartbeat（60 秒一次，窗口最小化 / 收进托盘就完全不发），判定阈值还只有 2 分钟。
 * 客户端明明开着，人员列表里 2 分钟后就掉进「离线人员」，看起来就是「又掉线了」。
 * 陪玩端没这个问题：主进程那条 WebSocket 每 30 秒发一次心跳，不受窗口可见性影响。
 *
 * 现在把「客户端连接还在」也算作在线：网页版、陪玩端主进程、客服端主进程都算。
 * 只要客户端进程活着（哪怕窗口最小化在托盘里），人员列表就显示在线；
 * 真的退出客户端 / 断网才会变成离线。
 */

type Entry = { sockets: number; lastSeen: number };

const entries = new Map<string, Entry>();

function touch(userId: string): Entry {
  let entry = entries.get(userId);
  if (!entry) {
    entry = { sockets: 0, lastSeen: 0 };
    entries.set(userId, entry);
  }
  return entry;
}

/** WebSocket 连上：连接数 +1 */
function addSocket(userId: string): void {
  if (!userId) return;
  const entry = touch(userId);
  entry.sockets += 1;
  entry.lastSeen = Date.now();
}

/** WebSocket 断开：连接数 -1（同一客户端可能有网页 + 主进程两条连接） */
function removeSocket(userId: string): void {
  if (!userId) return;
  const entry = entries.get(userId);
  if (!entry) return;
  entry.sockets = Math.max(0, entry.sockets - 1);
  entry.lastSeen = Date.now();
}

/** 任何带身份的请求 / 心跳：刷新一下「最后一次见到他」的时间 */
function markSeen(userId: string): void {
  if (!userId) return;
  touch(userId).lastSeen = Date.now();
}

/** 这个用户现在有没有活着的客户端连接 */
function hasSocket(userId: string): boolean {
  return (entries.get(userId)?.sockets ?? 0) > 0;
}

function lastSeenAt(userId: string): number | null {
  const at = entries.get(userId)?.lastSeen ?? 0;
  return at > 0 ? at : null;
}

/**
 * 人员列表用：客户端连接还在 → 返回「现在」；否则返回最后一次见到的时刻；都没有 → null。
 */
function onlineAs(userId: string): Date | null {
  if (!userId) return null;
  if (hasSocket(userId)) return new Date();
  const at = lastSeenAt(userId);
  return at ? new Date(at) : null;
}

export const presence = {
  addSocket,
  removeSocket,
  markSeen,
  hasSocket,
  lastSeenAt,
  onlineAs,
  /** 仅测试用 */
  reset(): void {
    entries.clear();
  },
  snapshot(): Array<{ userId: string; sockets: number; lastSeen: number }> {
    return [...entries.entries()].map(([userId, entry]) => ({ userId, ...entry }));
  },
};
