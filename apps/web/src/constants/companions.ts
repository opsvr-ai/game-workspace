/**
 * 陪玩/员工管理统一常量 — 所有角色共用
 *
 * 之前 ONLINE/BUSY 颜色在 CompanionListPage 中与 admin/CS 端相反，
 * 现在统一：ONLINE=red, IDLE=green, BUSY=gold, OFFLINE=default
 */

import { CompanionStatus } from '@chunlv/shared';

export const companionStatusConfig: Record<string, { color: string; label: string }> = {
  AVAILABLE:     { color: 'green',  label: '空闲' },
  BUSY:          { color: 'red',    label: '接单' },
  ENTERTAINMENT: { color: 'gold',   label: '娱乐' },
  RESTING:       { color: 'orange', label: '休息' },
  OFFLINE:       { color: 'default',label: '离线' },
};

/** 状态排序权重（用于列表排序，空闲排最前） */
export const STATUS_SORT: Record<string, number> = {
  AVAILABLE: 0,
  BUSY: 1,
  ENTERTAINMENT: 3,
  RESTING: 4,
  OFFLINE: 5,
};

export const modeLabels: Record<string, string> = {
  ENTERTAINMENT: '娱乐模式',
  WORK: '工作模式',
};

/** 心跳超时阈值（毫秒），超过此时间视为离线 */
export const HEARTBEAT_THRESHOLD = 120_000;

export interface PersonnelLike {
  id?: string | null;
  role?: string | null;
  status?: string | null;
  lastHeartbeat?: string | null;
}

/** 该人员当前是否在线：统一按最后心跳判断（陪玩 + 客服/店长/老板），无心跳时回退到陪玩状态。 */
export function isPersonnelOnline(p: PersonnelLike): boolean {
  if (p.lastHeartbeat) {
    return Date.now() - new Date(p.lastHeartbeat).getTime() < HEARTBEAT_THRESHOLD;
  }
  if (p.status) return p.status !== CompanionStatus.OFFLINE;
  return false;
}

/**
 * 人员列表分组权重 — 列表自上而下依次为：
 * 群聊（各页面单独固定在列表最上方，不走这里）→ 客服 → 店长/老板 →
 * 在线且空闲的陪玩 → 在线且接单中的陪玩 → 在线且娱乐中的陪玩 → 离线人员。
 *
 * 说明：只要处于离线状态，不论角色一律归到最后的「离线人员」，
 * 避免早已不上线的客服/店长长期占在最上面。
 */
export function personnelGroupRank(p: PersonnelLike): number {
  if (!isPersonnelOnline(p)) return 90; // 离线人员
  switch (p.role) {
    case 'CS':
      return 10; // 客服
    case 'ADMIN':
    case 'OWNER':
      return 20; // 店长 / 老板
    case 'COMPANION':
      switch (p.status) {
        case CompanionStatus.AVAILABLE:
          return 30; // 在线且空闲
        case CompanionStatus.BUSY:
          return 40; // 在线且接单中
        case CompanionStatus.ENTERTAINMENT:
          return 50; // 在线且娱乐中
        case CompanionStatus.RESTING:
          return 60; // 在线但休息，排在离线之前
        default:
          return 65; // 在线但状态未知
      }
    default:
      return 70;
  }
}
