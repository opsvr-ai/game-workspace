import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
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
        companion: { select: { isResigned: true } },
      },
    });
    if (!user) throw new UnauthorizedException('用户不存在');
    if (user.role === 'COMPANION' && user.companion?.isResigned) {
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
