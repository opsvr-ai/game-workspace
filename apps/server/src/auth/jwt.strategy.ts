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
        sessionVersion: true,
        companion: { select: { isResigned: true } },
      },
    });
    if (!user) throw new UnauthorizedException('用户不存在');
    if (isResignedUser(user)) {
      throw new UnauthorizedException('该账号已离职');
    }
    // 单点登录（老板 2026-10-01）：管理 / 客服账号每登录一次 sessionVersion +1，
    // 旧令牌带的是旧号码，对不上就当作已被顶掉。陪玩不加不减，多台在线不受影响。
    // 老令牌（没有 sv）不判失效，避免发布当刻把所有人（包括正在接单的陪玩）踢下线。
    if (typeof payload.sv === 'number' && payload.sv !== user.sessionVersion) {
      throw new UnauthorizedException({
        message: '该账号已在别的电脑上登录，请重新登录',
        reason: 'SESSION_REPLACED',
      });
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
