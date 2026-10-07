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
  /**
   * 存单：客户先把钱存进来、这次还没打（OrdersService.markDeposit）。
   * 不是终态 —— 客人来了接着打（CONFIRMED）/ 打完（DONE）/ 不打了（CANCELLED）都还要能转。
   * 老板 2026-10-08 全链路复查：以前这个状态既不在枚举里、也不在状态机里，
   * 界面上直接把英文 DEPOSITED 打给用户看，单子之后也转不动了。
   */
  DEPOSITED = 'DEPOSITED',
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
 * 这张单先给谁抢（老板 2026-10-01 定的两条链）：
 * - OFFLINE_FIRST「线下→线上流转」：本店线下陪玩先抢
 *   `pool.offline_first_bridge_minutes` 分钟，没人接才轮到桥接工作室 + 线上俱乐部（默认）；
 * - ONLINE_FIRST「线上→线下流转」：桥接工作室 + 线上俱乐部**秒看到**，
 *   `pool.online_first_release_minutes` 分钟没人接再放到本店线下。
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
