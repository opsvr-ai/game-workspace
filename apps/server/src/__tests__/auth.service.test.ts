import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from '../auth/auth.service';
import { createMockPrisma, MockPrisma } from '../__mocks__/prisma.mock';
import { UserRole } from '@chunlv/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJwtService() {
  return {
    sign: vi.fn().mockReturnValue('mock-token'),
    verify: vi.fn(),
  } as any;
}

function createUser(overrides: Record<string, any> = {}) {
  return {
    id: 'user-001',
    username: 'testuser',
    passwordHash: bcrypt.hashSync('correct-password', 4),
    role: 'OWNER',
    studioId: 'studio-001',
    isAuthorized: true,
    secondPasswordHash: bcrypt.hashSync('second-password', 4),
    companion: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: ReturnType<typeof mockJwtService>;
  let mockPrisma: MockPrisma;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    jwtService = mockJwtService();
    service = new AuthService(mockPrisma as any, jwtService as any);
    mockPrisma.user.count.mockResolvedValue(0);
    vi.clearAllMocks();
  });

  // =========================================================================
  // login()
  // =========================================================================

  describe('login', () => {
    it('should return accessToken, refreshToken and user on successful login', async () => {
      const user = createUser();
      user.companion = { id: 'comp-001' };  // owner may also be a companion
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const result = await service.login({
        username: 'testuser',
        password: 'correct-password',
      });

      expect(result).toEqual({
        accessToken: 'mock-token',
        refreshToken: 'mock-token',
        user: {
          id: 'user-001',
          username: 'testuser',
          role: UserRole.OWNER,
          studioId: 'studio-001',
          companionId: 'comp-001',
          displayName: undefined,
          avatar: undefined,
          pendingReviewCount: 0,
        },
      });

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: 'testuser' },
        include: { companion: { select: { id: true } } },
      });
      expect(jwtService.sign).toHaveBeenCalledTimes(2);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      const user = createUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(
        service.login({ username: 'testuser', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.login({ username: 'testuser', password: 'wrong-password' }),
      ).rejects.toThrow('用户名或密码错误');
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ username: 'ghost', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.login({ username: 'ghost', password: 'whatever' }),
      ).rejects.toThrow('用户名或密码错误');
    });

    it('should throw ForbiddenException for unauthorized CS role', async () => {
      const user = createUser({
        role: 'CS',
        isAuthorized: false,
      });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(
        service.login({ username: 'cs_user', password: 'correct-password' }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.login({ username: 'cs_user', password: 'correct-password' }),
      ).rejects.toThrow('账号尚未通过审核，请联系管理员');
    });

    it('should throw ForbiddenException for unauthorized COMPANION role', async () => {
      const user = createUser({
        role: 'COMPANION',
        isAuthorized: false,
      });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(
        service.login({ username: 'companion_user', password: 'correct-password' }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.login({ username: 'companion_user', password: 'correct-password' }),
      ).rejects.toThrow('账号尚未通过审核，请联系管理员');
    });
  });

  // =========================================================================
  // refresh()
  // =========================================================================

  describe('refresh', () => {
    it('should return new token pair for a valid refreshToken', async () => {
      const user = createUser({ companion: { id: 'comp-001' } });
      jwtService.verify.mockReturnValue({
        sub: 'user-001',
        username: 'testuser',
        role: 'OWNER',
        studioId: 'studio-001',
        companionId: 'comp-001',
      });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const result = await service.refresh('valid-refresh-token');

      expect(result).toEqual({
        accessToken: 'mock-token',
        refreshToken: 'mock-token',
      });

      expect(jwtService.verify).toHaveBeenCalledWith('valid-refresh-token', {
        secret: process.env.JWT_REFRESH_SECRET,
      });
      expect(jwtService.sign).toHaveBeenCalledTimes(2);
    });

    it('should throw UnauthorizedException for invalid refreshToken', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });

      await expect(service.refresh('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refresh('bad-token')).rejects.toThrow(
        'refreshToken 无效或已过期',
      );
    });

    it('should throw UnauthorizedException for expired refreshToken', async () => {
      const expiredError = new Error('jwt expired');
      expiredError.name = 'TokenExpiredError';
      jwtService.verify.mockImplementation(() => {
        throw expiredError;
      });

      await expect(service.refresh('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refresh('expired-token')).rejects.toThrow(
        'refreshToken 无效或已过期',
      );
    });

    it('should throw ForbiddenException for unauthorized role on refresh', async () => {
      const user = createUser({
        role: 'ADMIN',
        isAuthorized: false,
        companion: { id: 'comp-001' },
      });
      jwtService.verify.mockReturnValue({
        sub: 'user-001',
        username: 'testuser',
        role: 'ADMIN',
        studioId: 'studio-001',
        companionId: 'comp-001',
      });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(service.refresh('valid-refresh-token')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.refresh('valid-refresh-token')).rejects.toThrow(
        '账号尚未通过审核或已被禁用',
      );
    });
  });

  // =========================================================================
  // verifySecondPassword()
  // =========================================================================

  describe('verifySecondPassword', () => {
    it('should return secondToken for correct second password', async () => {
      const user = createUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const result = await service.verifySecondPassword(
        'user-001',
        'second-password',
      );

      expect(result).toEqual({ secondToken: 'mock-token' });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-001', secondVerified: true },
        {
          secret: process.env.JWT_SECRET,
          expiresIn: '5m',
        },
      );
    });

    it('should throw UnauthorizedException for wrong second password', async () => {
      const user = createUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(
        service.verifySecondPassword('user-001', 'wrong-second-password'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.verifySecondPassword('user-001', 'wrong-second-password'),
      ).rejects.toThrow('二次密码错误');
    });

    it('should throw UnauthorizedException when user has no second password', async () => {
      const user = createUser({ secondPasswordHash: null });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(
        service.verifySecondPassword('user-001', 'any-password'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.verifySecondPassword('user-001', 'any-password'),
      ).rejects.toThrow('未设置二次密码');
    });
  });
});
