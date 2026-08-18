import {
// craftsman-ignore: TS001
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
    // Validate password length
    if (!body.password || body.password.length < 6) {
      return { code: 400, message: '密码至少6位', data: null };
    }
    const allowedRoles = ['ADMIN', 'CS', 'COMPANION'];
    const role = allowedRoles.includes(body.role as string) ? (body.role as string) : 'COMPANION';

    // 校验必填 (ADMIN with studioName doesn't need studioId — auto-creates studio)
    const needsStudioId = false;
    if (!body.username || !body.realName || !body.idNumber || !body.phone) {
      return { code: 400, message: '请填写所有必填字段', data: null };
    }
    if (needsStudioId && !body.studioId) {
      return { code: 400, message: '请选择工作室', data: null };
    }

    // 检查身份证号唯一（User表 + Companion表）—— 实名可重名，身份证不可重复
    if (body.idNumber) {
      const dupUser = await this.prisma.user.findFirst({ where: { idNumber: body.idNumber } });
      const dupCompanion = await this.prisma.companion.findFirst({ where: { idNumber: body.idNumber } });
      if (dupUser || dupCompanion) {
        return { code: 409, message: '该身份证号已被注册', data: null };
      }
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

    const isCompanion = role === 'COMPANION';

    let studioId = body.studioId;

    let user;
    try {
      user = await this.prisma.user.create({
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
    } catch (err: any) {
      if (err?.code === 'P2002') {
        return { code: 409, message: '该姓名已被注册，请使用其他姓名', data: null };
      }
      throw err;
    }

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

  // 工作室客服列表（用于绑定工作室/客服微信）
  @Get('users/cs')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async listCsUsers(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.prisma.user.findMany({
      where: { studioId: req.user.studioId, role: 'CS' },
      select: { id: true, username: true, displayName: true },
      orderBy: { createdAt: 'asc' },
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
    // Check role hierarchy + studio scope
    if (req.user.role !== 'OWNER') {
      if (companion.studioId !== req.user.studioId) {
        return { code: 403, message: '无权审核其他工作室的陪玩', data: null };
      }
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
