import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { isResignedUser } from '../common/offboarding';
import type { JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        isAuthorized: true,
        resignedAt: true,
        companion: { select: { isResigned: true } },
      },
    });
    if (!user) throw new UnauthorizedException('用户不存在');
    if (isResignedUser(user)) {
      throw new UnauthorizedException('该账号已离职');
    }
    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      studioId: payload.studioId,
      companionId: payload.companionId,
      isAuthorized: user.isAuthorized,
    };
  }
}
