import {
  Controller, Post, Get, Put, Param, Body, Req, Query, UseGuards, UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IdentityVerifyService } from './identity-verify.service';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard, Roles } from './roles.guard';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';
import * as bcrypt from 'bcryptjs';

@Controller()
export class RegisterController {
  constructor(private readonly prisma: PrismaService, private readonly identityVerify: IdentityVerifyService) {}

  @Get('auth/check-username')
  async checkUsername(@Query('q') q: string): Promise<ApiResponse<{ exists: boolean }>> {
    const user = await this.prisma.user.findUnique({ where: { username: q }, select: { id: true } });
    return { code: 200, message: 'ok', data: { exists: !!user } };
  }

  // 陪玩自主注册（无需登录）
  @Post('auth/register')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'idCardFront', maxCount: 1 },
        { name: 'idCardBack', maxCount: 1 },
        { name: 'leaseContract', maxCount: 1 },
      ],
      {
        storage: diskStorage({
          destination: join(process.cwd(), '../../uploads/idcards'),
          filename: (_req, file, cb) => {
            const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
            cb(null, unique + extname(file.originalname));
          },
        }),
        limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
        fileFilter: (_req, file, cb) => {
          if (!file.mimetype.match(/^image\/(jpeg|png|webp)$/)) {
            cb(new Error('仅支持 JPG/PNG/WEBP 格式'), false);
            return;
          }
          cb(null, true);
        },
      },
    ),
  )
  async register(
    @Body() body: {
      username: string; password: string; realName: string;
      idNumber: string; phone: string; studioId: string;
      role?: string;
      address?: string;
      studioName?: string;
      registerRole?: string; // Original role from frontend (OFFLINE_ADMIN/ONLINE_ADMIN etc.)
      games?: string;
    },
    @UploadedFiles() files?: { idCardFront?: Express.Multer.File[]; idCardBack?: Express.Multer.File[]; leaseContract?: Express.Multer.File[] },
  ): Promise<ApiResponse<unknown>> {
    // 校验必填 (ADMIN with studioName doesn't need studioId — auto-creates studio)
    const needsStudioId = body.role !== 'ADMIN' || !body.studioName;
    if (!body.username || !body.password || !body.realName || !body.idNumber || !body.phone) {
      return { code: 400, message: '请填写所有必填字段', data: null };
    }
    if (needsStudioId && !body.studioId) {
      return { code: 400, message: '请选择工作室', data: null };
    }

    // 检查用户名唯一
    const existing = await this.prisma.user.findUnique({ where: { username: body.username } });
    if (existing) {
      return { code: 409, message: '用户名已被占用', data: null };
    }

    // 实名认证（如API已配置则验证，未配置则跳过）
    try {
      const vr = await this.identityVerify.verify(body.realName, body.idNumber);
      if (!vr.valid) return { code: 400, message: vr.reason || '身份验证失败', data: null };
    } catch {}

    const idCardFront = files?.idCardFront?.[0]?.filename ?? null;
    const idCardBack = files?.idCardBack?.[0]?.filename ?? null;
    const leaseContractUrl = files?.leaseContract?.[0]?.filename
      ? `/uploads/idcards/${files.leaseContract[0].filename}`
      : null;

    const passwordHash = await bcrypt.hash(body.password, 10);

    const role = body.role === 'CS' ? 'CS' : body.role === 'ADMIN' ? 'ADMIN' : 'COMPANION';
    const isCompanion = role === 'COMPANION';
    const isAdmin = role === 'ADMIN';

    // Auto-create studio for admin registration
    let studioId = body.studioId;
    if (isAdmin && body.studioName) {
      const registerRole = body.registerRole || body.role || '';
      const isOnline = registerRole.startsWith('ONLINE');
      const studioType = isOnline ? 'RENTAL' : 'DIRECT';
      const splitMode = isOnline ? 'FIXED' : 'TIERED'; // 线下=阶梯 线上=固定
      console.log(`[Register] Creating studio: name=${body.studioName} type=${studioType} splitMode=${splitMode} registerRole=${registerRole}`);
      const studio = await this.prisma.studio.create({
        data: { name: body.studioName, type: studioType, splitMode, address: body.address || null, leaseContractUrl },
      });
      studioId = studio.id;
    }

    const user = await this.prisma.user.create({
      data: {
        username: body.username,
        passwordHash,
        role,
        studioId,
        isAuthorized: false,
        address: body.address || null,
        leaseContractUrl,
        realName: (!isCompanion ? body.realName : null) as any,
        idNumber: (!isCompanion ? body.idNumber : null) as any,
        phone: (!isCompanion ? body.phone : null) as any,
        ...(isCompanion ? {
          companion: {
            create: {
              studioId,
              realName: body.realName,
              idNumber: body.idNumber,
              phone: body.phone,
              idCardFront,
              idCardBack,
              reviewStatus: 'PENDING',
              games: [],
              billingCode: `Z${Date.now().toString(36).toUpperCase()}`,
            },
          },
        } : {}),
      },
      include: { companion: true },
    });

    return {
      code: 201,
      message: '注册成功，请等待管理员审核',
      data: { userId: user.id, username: user.username },
    };
  }

  // 待审核列表（所有角色：陪玩+店长+客服）
  @Get('users/pending-review')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async listPendingUsers(@Req() req: any): Promise<ApiResponse<unknown>> {
    const where: any = { isAuthorized: false };
    // ADMIN can only see users in their own studio; OWNER sees all
    if (req.user.role === 'ADMIN' && req.user.studioId) {
      where.studioId = req.user.studioId;
    }
    const data = await this.prisma.user.findMany({
      where,
      select: {
        id: true, username: true, role: true, displayName: true, address: true,
        leaseContractUrl: true, realName: true, idNumber: true, phone: true, createdAt: true,
        studio: { select: { id: true, name: true } },
        companion: { select: { id: true, realName: true, idNumber: true, phone: true, reviewStatus: true, idCardFront: true, idCardBack: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { code: 200, message: 'ok', data };
  }

  // @deprecated 待审核陪玩列表（保留兼容）
  @Get('companions/pending-review')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async listPending(@Req() req: any): Promise<ApiResponse<unknown>> {
    const where: any = { reviewStatus: 'PENDING' };
    // ADMIN/CS can only see companions in their own studio; OWNER sees all
    if ((req.user.role === 'ADMIN' || req.user.role === 'CS') && req.user.studioId) {
      where.studioId = req.user.studioId;
    }
    const data = await this.prisma.companion.findMany({
      where,
      include: {
        user: { select: { username: true } },
        studio: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { code: 200, message: 'ok', data };
  }

  // 审核陪玩（通过/拒绝）
  @Put('companions/:id/review')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async review(
    @Param('id') id: string,
    @Body() body: { action: 'APPROVED' | 'REJECTED'; note?: string },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const companion = await this.prisma.companion.findUnique({ where: { id } });
    if (!companion) {
      return { code: 404, message: '陪玩不存在', data: null };
    }
    if (companion.reviewStatus !== 'PENDING') {
      return { code: 400, message: '该陪玩已审核', data: null };
    }
    // ADMIN/CS can only review companions in their own studio; OWNER can review any
    if ((req.user.role === 'ADMIN' || req.user.role === 'CS') && companion.studioId !== req.user.studioId) {
      return { code: 403, message: '无权审核其他工作室的陪玩', data: null };
    }

    const isApproved = body.action === 'APPROVED';

    await this.prisma.companion.update({
      where: { id },
      data: {
        reviewStatus: body.action,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
        reviewNote: body.note ?? null,
      },
    });

    // 审核通过时，自动授权用户登录
    if (isApproved) {
      await this.prisma.user.update({
        where: { id: companion.userId },
        data: { isAuthorized: true },
      });
    }

    return {
      code: 200,
      message: isApproved ? '已通过审核，陪玩可登录' : '已拒绝',
      data: { companionId: id, status: body.action, reviewer: req.user.username },
    };
  }
}
