import { Injectable, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import type { UserInfo, LoginResponse } from '@chunlv/shared';
import { UserRole } from '@chunlv/shared';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      include: { companion: { select: { id: true } } },
    });

    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const rolesRequiringAuth: UserRole[] = [UserRole.CS, UserRole.COMPANION];
    if (rolesRequiringAuth.includes(user.role as UserRole) && !user.isAuthorized) {
      throw new ForbiddenException('账号尚未通过审核，请联系管理员');
    }

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role as UserRole,
      studioId: user.studioId,
      companionId: user.companion?.id,
      isAuthorized: user.isAuthorized,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '7d',
    });

    // Include pending count for OWNER/ADMIN
    let pendingReviewCount = 0;
    if (user.role === 'OWNER' || user.role === 'ADMIN') {
      pendingReviewCount = await this.prisma.user.count({ where: { isAuthorized: false } });
    }

    const userInfo: UserInfo = {
      id: user.id,
      username: user.username,
      role: user.role as UserRole,
      studioId: user.studioId,
      companionId: user.companion?.id,
      displayName: user.displayName,
      avatar: user.avatar,
      pendingReviewCount,
    };

    return {
      accessToken,
      refreshToken,
      user: userInfo,
    };
  }

  async refresh(token: string): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('refreshToken 无效或已过期');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { companion: { select: { id: true } } },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    const newPayload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role as UserRole,
      studioId: user.studioId,
      companionId: user.companion?.id,
      isAuthorized: user.isAuthorized,
    };

    const accessToken = this.jwtService.sign(newPayload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(newPayload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }

  async getMe(userId: string): Promise<UserInfo> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { companion: { select: { id: true } } },
    });
    if (!user) throw new UnauthorizedException('用户不存在');
    // Include pending review count for OWNER/ADMIN
    let pendingReviewCount = 0;
    if (user.role === 'OWNER' || user.role === 'ADMIN') {
      pendingReviewCount = await this.prisma.user.count({ where: { isAuthorized: false } });
    }
    return {
      id: user.id,
      username: user.username,
      role: user.role as UserRole,
      studioId: user.studioId,
      companionId: user.companion?.id,
      displayName: user.displayName,
      avatar: user.avatar,
      pendingReviewCount,
    };
  }

  async authorizeUser(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { isAuthorized: true },
    });
  }

  async rejectUser(userId: string, reason: string): Promise<void> {
    // Set note with reject reason, keep isAuthorized=false
    await this.prisma.user.update({
      where: { id: userId },
      data: { isAuthorized: false, customEmojis: [{ rejectReason: reason, rejectedAt: new Date().toISOString() }] as any },
    });
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');
    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('旧密码错误');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async updateProfile(userId: string, displayName?: string) {
    const data: any = {};
    if (displayName !== undefined) data.displayName = displayName;
    return this.prisma.user.update({ where: { id: userId }, data });
  }

  async updateAvatar(userId: string, filename: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatar: filename },
    });
  }

  async getCustomEmojis(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { customEmojis: true },
    });
    return (user?.customEmojis as string[]) ?? [];
  }

  async updateCustomEmojis(userId: string, emojis: string[]): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { customEmojis: emojis },
    });
  }

  async verifySecondPassword(userId: string, password: string): Promise<{ secondToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.secondPasswordHash) {
      throw new UnauthorizedException('未设置二次密码');
    }

    const valid = await bcrypt.compare(password, user.secondPasswordHash);
    if (!valid) {
      throw new UnauthorizedException('二次密码错误');
    }

    const secondToken = this.jwtService.sign(
      { sub: user.id, secondVerified: true },
      {
        secret: process.env.JWT_SECRET,
        expiresIn: '5m',
      },
    );

    return { secondToken };
  }
}

export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
  studioId: string | null;
  companionId?: string;
  isAuthorized?: boolean;
}
