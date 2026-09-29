export enum UserRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  CS = 'CS',
  COMPANION = 'COMPANION',
}

export enum OrderType {
  NEW = 'NEW',
  RENEW = 'RENEW',
  REPURCHASE = 'REPURCHASE',
  TIP = 'TIP',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  CLAIMED = 'CLAIMED',
  GRABBED = 'GRABBED',
  CONFIRMED = 'CONFIRMED',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
}

export enum DispatchType {
  POOL = 'POOL',
  BROADCAST = 'BROADCAST',
  DIRECT = 'DIRECT',
}

export enum OrderSource {
  OFFLINE = 'OFFLINE',
  BRIDGE = 'BRIDGE',
}

/**
 * 这张单先给谁抢（老板 2026-09-29）：
 * - OFFLINE_FIRST：先给本店线下陪玩（老行为，默认）；
 * - ONLINE_FIRST：先给桥接工作室 + 线上俱乐部，本店线下陪玩先看不见，
 *   由发单客服/店长点「放给线下」或过了自动放行时间才放给本店。
 */
export enum PoolScope {
  OFFLINE_FIRST = 'OFFLINE_FIRST',
  ONLINE_FIRST = 'ONLINE_FIRST',
}

/** 线上 / 桥接单的接单方反馈（老板 2026-09-29）：没反馈 = 待反馈（null）。 */
export enum OrderOutcome {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export enum CompanionStatus {
  AVAILABLE = 'AVAILABLE',
  BUSY = 'BUSY',
  ENTERTAINMENT = 'ENTERTAINMENT',
  RESTING = 'RESTING',
  OFFLINE = 'OFFLINE',
}

export enum PCMode {
  ENTERTAINMENT = 'ENTERTAINMENT',
  WORK = 'WORK',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum StudioType {
  DIRECT = 'DIRECT',
  RENTAL = 'RENTAL',
}

export enum ServiceType {
  PLAY_WITH = 'PLAY_WITH',
  ESCORT = 'ESCORT',
  DO_TASK = 'DO_TASK',
}

export enum ContactResult {
  NOW = 'NOW',
  RESCHEDULE = 'RESCHEDULE',
  REJECT = 'REJECT',
  NO_REPLY = 'NO_REPLY',
  DELETED = 'DELETED',
  DONGGU = 'DONGGU',
  REFUND = 'REFUND',
}

export enum TrackType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  TEXT_IMAGE = 'TEXT_IMAGE',
}

export enum DeleteRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}
