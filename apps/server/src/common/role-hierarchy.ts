import { ForbiddenException } from '@nestjs/common';

/** Role hierarchy: OWNER > ADMIN > CS > COMPANION */
const ROLE_LEVEL: Record<string, number> = {
  OWNER: 4,
  ADMIN: 3,
  CS: 2,
  COMPANION: 1,
};

/** Check if `managerRole` can manage `targetRole` (higher level can manage lower, not equal or higher) */
export function canManage(managerRole: string, targetRole: string): boolean {
  const managerLevel = ROLE_LEVEL[managerRole] || 0;
  const targetLevel = ROLE_LEVEL[targetRole] || 0;
  return managerLevel > targetLevel;
}

/** Assert that manager can manage target, throws ForbiddenException if not */
export function assertCanManage(
  managerRole: string,
  targetRole: string,
  managerStudioId?: string | null,
  targetStudioId?: string | null,
): void {
  // OWNER can manage anyone regardless of studio
  if (managerRole === 'OWNER') return;
  // Must be in the same studio
  if (managerStudioId && targetStudioId && managerStudioId !== targetStudioId) {
    throw new ForbiddenException('无权操作其他工作室的员工');
  }
  // Check role hierarchy
  if (!canManage(managerRole, targetRole)) {
    throw new ForbiddenException('无权操作该员工');
  }
}
