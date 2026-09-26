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
