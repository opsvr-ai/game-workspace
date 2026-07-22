import { Injectable, CanActivate, ExecutionContext, SetMetadata, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@chunlv/shared';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Roles that require authorization (isAuthorized check) */
const ROLES_REQUIRING_AUTH: UserRole[] = [UserRole.CS, UserRole.COMPANION, UserRole.ADMIN];

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      return false;
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('无权访问');
    }

    // isAuthorized check: CS and COMPANION must be approved
    if (ROLES_REQUIRING_AUTH.includes(user.role) && !user.isAuthorized) {
      throw new ForbiddenException('账号尚未通过审核，请联系管理员');
    }

    return true;
  }
}
