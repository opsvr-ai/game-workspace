// craftsman-ignore: TS001
/**
 * 实时刷新（2026-10-17，配合「Socket 单连接收敛」）。
 *
 * 看板类页面以前只靠 15 秒轮询：一次抢单风暴里服务端连推十几个事件，
 * 页面上还是慢半拍才变。现在改成「推送为主 + 轮询兜底」：
 *
 *  - 收到订阅的 socket 事件 → 不在每次事件都打接口，而是把 500~1000ms 内的
 *    多次事件**合并成一次** refetch（一次抢单风暴最多每秒 1 次请求）；
 *  - 上一发还没回来时又收到事件 → 记一笔，回来之后再补刷一次，绝不并发打同一个接口；
 *  - 页面切到后台 / 客户端最小化时**不刷新**（和 usePolling 同一口径），
 *    记下来等回到前台立刻补一次 —— 看板常年挂在墙上，后台空转纯属浪费带宽；
 *  - 轮询本身不删：推送断了（服务端重启 / 网络抖动 / 事件漏发）还有轮询兜底。
 *
 * 事件名与 payload 语义不动，只订阅、不改。
 */
import { useEffect, useRef } from 'react';
import { useSocket } from './useSocket';

/**
 * 「整表刷新」类看板订阅的订单 / 状态事件。
 * 这些事件到达都意味着「谁在打什么、池子里有什么、钱和时长」可能变了，
 * 对看板来说刷新方式完全一样，所以合并成一套。
 */
export const LIVE_BOARD_EVENTS = [
  'status:broadcast',
  'order:new',
  'order:grabbed',
  'order:pool_updated',
  'order:transferred',
  'order:transfer_requested',
  'order:transfer_accepted',
  'order:transfer_rejected',
  'order:transfer_cancelled',
  'order:transfer_expired',
  'order:segment_finished',
] as const;

export interface UseLiveRefreshOptions {
  /** 要订阅的 socket 事件名（只用不改，事件名不能改）。 */
  events: readonly string[];
  /** 合并之后要执行的刷新函数（一般是页面的 fetchBoard(true)）。 */
  refetch: () => void | Promise<void>;
  /**
   * 节流窗口（毫秒），默认 800；限制在 500~1000 ——
   * 太短挡不住抢单风暴，太长看板就不像「实时」了。
   */
  delayMs?: number;
  /** 关掉订阅（比如权限不足时），默认开启。 */
  enabled?: boolean;
  /** socket 命名空间，默认 `/`（业务网关）。 */
  namespace?: string;
}

const MIN_DELAY_MS = 500;
const MAX_DELAY_MS = 1000;
const DEFAULT_DELAY_MS = 800;

function clampDelay(ms?: number): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_DELAY_MS;
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.round(ms)));
}

export function useLiveRefresh(options: UseLiveRefreshOptions): void {
  // 共享连接：这里只是一个「消费者」，不会为页面单开一条 Socket。
  const socketRef = useSocket({ namespace: options.namespace });

  // 用 ref 存最新的刷新函数 / 窗口，避免调用方每次渲染都重新订阅事件。
  const refetchRef = useRef(options.refetch);
  refetchRef.current = options.refetch;
  const delayRef = useRef(clampDelay(options.delayMs));
  delayRef.current = clampDelay(options.delayMs);
  const enabled = options.enabled !== false;

  // 节流窗口内的定时器（有它 = 已经在合并，别再加）
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 正在刷新中（防止同一个接口并发打）
  const runningRef = useRef(false);
  // 「还有没刷完的新变化」：刷新中又来事件 / 页面不可见时收到事件，都记在这里
  const dirtyRef = useRef(false);
  // 两个函数互相引用（刷新完成后可能还要再排一次），用 ref 打破循环依赖并保持引用稳定。
  const scheduleRef = useRef<() => void>(() => {});
  const runRef = useRef<() => void>(() => {});

  runRef.current = () => {
    if (runningRef.current) {
      dirtyRef.current = true;
      return;
    }
    runningRef.current = true;
    void (async () => {
      try {
        await refetchRef.current();
      } catch {
        // 刷新失败不在这里报错：页面自己的 catch / 轮询兜底会处理。
      } finally {
        runningRef.current = false;
        if (dirtyRef.current) {
          dirtyRef.current = false;
          scheduleRef.current();
        }
      }
    })();
  };

  scheduleRef.current = () => {
    // 页面不可见：不打接口（和 usePolling 一样），记下来等回到前台补一次。
    if (document.visibilityState !== 'visible') {
      dirtyRef.current = true;
      return;
    }
    if (runningRef.current) {
      dirtyRef.current = true;
      return;
    }
    // 已经在节流窗口里：这一批事件合并进那一次刷新，不延长窗口（
    // 避免连续事件把刷新一直往后推，看板反而更慢）。
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      runRef.current();
    }, delayRef.current);
  };

  // 事件名集合按「内容」比较：调用方每次渲染传新数组也不会重复订阅。
  const eventNames = Array.from(new Set(options.events)).join('|');

  useEffect(() => {
    if (!enabled) return;
    const socket = socketRef.current;
    if (!socket) return;

    const names = eventNames ? eventNames.split('|') : [];
    const onLiveEvent = () => scheduleRef.current();
    for (const name of names) socket.on(name as any, onLiveEvent);

    const onVisibility = () => {
      // 后台期间攒下的变化：回到前台立刻补一次（不用等下一轮 15 秒轮询）。
      if (document.visibilityState === 'visible' && dirtyRef.current) {
        dirtyRef.current = false;
        scheduleRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      for (const name of names) {
        try {
          socket.off(name as any, onLiveEvent);
        } catch {
          /* socket 已经销毁，摘不到也无所谓 */
        }
      }
      document.removeEventListener('visibilitychange', onVisibility);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, eventNames, socketRef]);
}
