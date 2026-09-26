/**
 * 「这个人是不是已经离职了」的统一判断。
 *
 * 2026-09-26 之前只有陪玩有离职概念，判断散落在各处写 `companion?.isResigned`；
 * 现在陪玩 / 客服 / 店长共用 `User.resignedAt`，陪玩的 `Companion.isResigned`
 * 只作为历史数据的兜底。
 */
export function isResignedUser(user: {
  role?: string | null;
  resignedAt?: Date | string | null;
  companion?: { isResigned?: boolean | null } | null;
}): boolean {
  if (user.resignedAt) return true;
  return user.role === 'COMPANION' && !!user.companion?.isResigned;
}

export const RESIGNED_LOGIN_MESSAGE = '该账号已离职，无法登录';

/**
 * Prisma where 片段：「只算没离职的人」。
 *
 * `resignedAt` 是新的统一字段；`Companion.isResigned` 只兜历史数据，
 * 所以非陪玩（companion 为 null）也要能通过，必须写成 OR。
 */
export function notResignedWhere() {
  return {
    resignedAt: null,
    OR: [{ companion: null }, { companion: { isResigned: false } }],
  };
}

/**
 * Prisma where 片段：「待审核的人」= 未授权 + 未离职。
 *
 * 离职时会把 `isAuthorized` 置为 false（停用账号），所以**只按 isAuthorized=false 查待审核**
 * 会把离职的人一并捞出来 —— 老板 2026-09-27 报的「李玉妹离职了突然出现在实名审核」就是这个。
 */
export function pendingReviewWhere() {
  return { isAuthorized: false, ...notResignedWhere() };
}
