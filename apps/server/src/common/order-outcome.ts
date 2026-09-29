import { OrderOutcome, PoolScope } from '@chunlv/shared';

/**
 * 「这单算不算成功」的**唯一口径**（老板 2026-09-29 拍板）。
 *
 * 老板原话：「并不是订单派出去了，被抢走了就计算了，被线下抢走的好说，点开始首单就可以
 * 判定这个客户真消费没；线上不好判定，需要接单者给我反馈，比如派给桥接俱乐部一个订单，
 * 对方对陪玩不满意，那么这单就不成功。」
 *
 * 所以：
 *  - **线下单**（陪玩是本店自己的）：陪玩点了「开始首单」（有会话 `startedAt`）就算成功；
 *    历史上已经是 `DONE` 的单同样算成功（老口径不倒退）。
 *  - **桥接 / 线上单**（陪玩是别的店 / 线上俱乐部的）：**只有接单方反馈「成功」**才算成功，
 *    派出去了、被抢走了都不算；没反馈 = 待反馈（既不算成功也不算不成功）。
 *  - **退款单**一律不算成功（退款接口本来也会写 `refundedAt`）。
 *
 * 提成、看板、达标判断全部调这里，别再各写一份 —— 「客服那页看到的」和「真的算钱的」
 * 必须是同一套口径（这个项目已经在这种「两套口径」上翻过车）。
 */

/** 这单的渠道：本店线下 / 桥接别家店 / 线上俱乐部（租赁店）。 */
export type OrderChannel = 'offline' | 'bridge' | 'online';

export interface OrderChannelLike {
  companion?: { studioId?: string | null; studio?: { id?: string | null; type?: string | null } | null } | null;
}

export function orderChannelOf(order: OrderChannelLike, studioId: string): OrderChannel {
  const compStudio = order.companion?.studio;
  if (compStudio?.type === 'RENTAL') return 'online';
  const compStudioId = compStudio?.id ?? order.companion?.studioId ?? null;
  if (compStudioId && compStudioId !== studioId) return 'bridge';
  return 'offline';
}

/** Prisma where 片段：**算钱的成功单**（提成只看这个）。 */
export function successOrderWhere(studioId: string) {
  return {
    companionId: { not: null },
    refundedAt: null,
    status: { not: 'CANCELLED' },
    OR: [
      // 本店线下：点了「开始首单」就算（历史 DONE 单也算，口径只放宽不收紧）
      {
        companion: { studioId },
        OR: [{ status: 'DONE' }, { sessions: { some: { startedAt: { not: null } } } }],
      },
      // 桥接 / 线上：只有接单方反馈「成功」才算
      {
        companion: { studioId: { not: studioId } },
        outcome: OrderOutcome.SUCCESS,
      },
    ],
  };
}

/**
 * Prisma where 片段：**桥接达标口径**（每日/每月桥接目标）。
 * 达标是「这小子到底跑起来了多少桥接单」的勤奋指标，所以只排除明确不成功与退款的单：
 * 还没反馈的（接单方没回话）照算，免得客服替对方背锅、底薪被误扣。
 */
export function bridgeMetOrderWhere() {
  return {
    companionId: { not: null },
    refundedAt: null,
    status: { not: 'CANCELLED' },
    outcome: { not: OrderOutcome.FAILED },
  };
}

export interface OutcomeLike {
  status?: string | null;
  outcome?: string | null;
  refundedAt?: Date | string | null;
  companion?: { studioId?: string | null; studio?: { id?: string | null; type?: string | null } | null } | null;
  sessions?: Array<{ startedAt?: Date | string | null }> | null;
}

export type OutcomeState = 'SUCCESS' | 'FAILED' | 'PENDING' | 'NONE';

export interface OutcomeDecision {
  channel: OrderChannel;
  state: OutcomeState;
  /** 这张单算不算「成功」（= 提成里算钱的那种） */
  counted: boolean;
  /** 明细列表里显示的说明 */
  reason: string;
}

/** 给界面用：一张单现在是什么结果（成功 / 不成功 / 待反馈 / 不适用）。 */
export function outcomeOf(order: OutcomeLike, studioId: string): OutcomeDecision {
  const channel = orderChannelOf(order, studioId);
  const refunded = !!order.refundedAt;
  if (channel === 'offline') {
    if (refunded || order.status === 'CANCELLED') {
      return { channel, state: 'NONE', counted: false, reason: '已退款 / 已取消，不算成功' };
    }
    const started =
      order.status === 'DONE' || (order.sessions || []).some((s) => !!s.startedAt);
    return started
      ? { channel, state: 'SUCCESS', counted: true, reason: '已点「开始首单」' }
      : { channel, state: 'NONE', counted: false, reason: '还没开始首单' };
  }
  if (refunded || order.status === 'CANCELLED') {
    return { channel, state: 'NONE', counted: false, reason: '已退款 / 已取消，不算成功' };
  }
  if (order.outcome === OrderOutcome.SUCCESS) {
    return { channel, state: 'SUCCESS', counted: true, reason: '接单方反馈成功' };
  }
  if (order.outcome === OrderOutcome.FAILED) {
    return { channel, state: 'FAILED', counted: false, reason: '接单方反馈不成功' };
  }
  return { channel, state: 'PENDING', counted: false, reason: '等接单方反馈' };
}

/**
 * 「先给谁」：ONLINE_FIRST 的单，本店线下陪玩什么时候才看得见。
 * 客服/店长手动放给线下 → 立即；没人管 → 发单后 `releaseMinutes` 分钟自动放行。
 * 返回 null 表示这张单不是「先线上」，本店线下一直可见（老口径）。
 */
export function offlineVisibleAt(
  order: { poolScope?: string | null; createdAt?: Date | string | null; releasedToOfflineAt?: Date | string | null },
  releaseMinutes: number,
): number | null {
  if (order.poolScope !== PoolScope.ONLINE_FIRST) return null;
  if (order.releasedToOfflineAt) return new Date(order.releasedToOfflineAt).getTime();
  const created = order.createdAt ? new Date(order.createdAt).getTime() : 0;
  const minutes = Number.isFinite(releaseMinutes) ? releaseMinutes : 5;
  return created + Math.max(0, minutes) * 60_000;
}

/** 这张单现在对本店线下陪玩可见吗（只有 ONLINE_FIRST 会被拦）。 */
export function visibleToOwnOffline(
  order: { poolScope?: string | null; createdAt?: Date | string | null; releasedToOfflineAt?: Date | string | null },
  releaseMinutes: number,
  now: number = Date.now(),
): boolean {
  const at = offlineVisibleAt(order, releaseMinutes);
  if (at === null) return true;
  return now >= at;
}

export function normalizePoolScope(v: unknown): PoolScope {
  return v === PoolScope.ONLINE_FIRST ? PoolScope.ONLINE_FIRST : PoolScope.OFFLINE_FIRST;
}
