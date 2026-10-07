/**
 * 「发现新版前端页面了，要不要现在整页刷新」的判定（老板 2026-10-08）。
 *
 * 以前这段判断写在 AppLayout 的心跳里，规则散着、还漏了一条最要紧的：
 * **有人在写东西（有没提交的内容）时不能刷** —— 老板报的「发布订单 / 聊天时软件刷新、输入全没了」。
 * 现在收成这一个纯函数：规则看得见、改得动、有测试（apps/web/src/__tests__/draft-protect.test.tsx）。
 * 客户端主进程那一侧的硬刷新（每次发版号就 webContents.reload）由 busyGuard.ts 的 beforeunload 拦。
 */

/** 刚打开页面先等 2 分钟再考虑刷新（避免「一进页面就被刷」）。 */
export const RELOAD_MIN_PAGE_AGE_MS = 2 * 60 * 1000;
/** 两次换版刷新之间至少隔 5 分钟。 */
export const RELOAD_MIN_INTERVAL_MS = 5 * 60 * 1000;

export interface BuildRefreshInput {
  /** localStorage 里记着的上一次构建号。 */
  prev: string | null;
  /** 这一次心跳拿到的构建号（拿不到就当没有新版本）。 */
  next: string | undefined;
  /** 这个页面已经开了多久（毫秒）。 */
  pageAgeMs: number;
  /** 上一次因为换版刷新的时间戳（0 = 从没刷过）。 */
  lastReloadAt: number;
  /** 正在接单 / 服务中。 */
  inService: boolean;
  /** 有还没提交的内容（有人在写东西）。 */
  busy: boolean;
  now?: number;
}

export interface BuildRefreshDecision {
  reload: boolean;
  /** 要不要把这个构建号记下来（记了就不会反复判断同一版）。 */
  remember: boolean;
  reason: string;
}

export function decideBuildRefresh(input: BuildRefreshInput): BuildRefreshDecision {
  const now = input.now ?? Date.now();
  const { prev, next } = input;
  if (!next) return { reload: false, remember: false, reason: '没拿到构建号' };
  if (!prev) return { reload: false, remember: true, reason: '第一次见到构建号，先记下来' };
  if (prev === next) return { reload: false, remember: false, reason: '还是同一个构建' };
  if (input.inService) return { reload: false, remember: true, reason: '正在接单 / 服务中，不刷' };
  if (input.pageAgeMs < RELOAD_MIN_PAGE_AGE_MS) {
    return { reload: false, remember: false, reason: '页面刚打开没多久，再等等' };
  }
  if (now - input.lastReloadAt < RELOAD_MIN_INTERVAL_MS) {
    return { reload: false, remember: false, reason: '5 分钟内刚刷过' };
  }
  if (input.busy) return { reload: false, remember: false, reason: '有还没提交的内容，等他写完 / 提交' };
  return { reload: true, remember: true, reason: '有新版本且现在安全' };
}
