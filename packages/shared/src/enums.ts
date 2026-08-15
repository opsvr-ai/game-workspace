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
  DIRECT = 'DIRECT',
}

export enum OrderSource {
  OFFLINE = 'OFFLINE',
  BRIDGE = 'BRIDGE',
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
