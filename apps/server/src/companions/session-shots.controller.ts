// craftsman-ignore: TS001,TS003
import {
  Controller,
  Post,
  Get,
  Put,
  Param,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { CompositeService } from './composite.service';
import { CustomerBaselineService } from './customer-baseline.service';

const SHOTS_DIR = join(process.cwd(), '..', '..', 'uploads', 'session-shots');

function timeToFileName(ts: string): string {
  // 客户端传 "2026-08-13 08:00:35" 或 ISO；转成文件名安全格式
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null as any;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.jpg`;
}

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SessionShotsController {
  constructor(
    private prisma: PrismaService,
    private composite: CompositeService,
    private baseline: CustomerBaselineService,
  ) {}

  /** 陪玩端上传游戏截图（实际截屏时间作为文件名） */
  @Post('sessions/:id/screenshots')
  @Roles(UserRole.COMPANION)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req: Request, _file, cb) => {
          const dir = join(SHOTS_DIR, String(_req.params.id));
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req: Request, _file, cb) => {
          const raw = req.body?.captureTime;
          const ts = (Array.isArray(raw) ? raw[0] : raw) || new Date().toISOString();
          const fname = timeToFileName(ts);
          cb(null, fname);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!['.jpg', '.jpeg', '.png'].includes(ext)) {
          return cb(new BadRequestException('仅支持 JPG/PNG'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadShot(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Req() req: any): Promise<ApiResponse<unknown>> {
    const session = await this.prisma.orderSession.findUnique({ where: { id }, select: { companionId: true } });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.companionId !== req.user.companionId) throw new ForbiddenException('只能上传自己会话的截图');
    if (!file) throw new BadRequestException('未收到文件');
    return { code: 200, message: 'ok', data: { url: `/uploads/session-shots/${id}/${file.filename}` } };
  }

  /** 结束会话：生成合并长图 + 基线分析标记 */
  @Put('sessions/:id/finish')
  @Roles(UserRole.COMPANION)
  async finishSession(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const session = await this.prisma.orderSession.findUnique({ where: { id }, select: { companionId: true, status: true } });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.companionId !== req.user.companionId) throw new ForbiddenException('只能操作自己的会话');

    const shotCount = this.composite.countShots(id);
    let flagged: 'red' | 'yellow' | null = null;

    if (shotCount === 0) {
      flagged = 'red';
      await this.prisma.orderSession.update({ where: { id }, data: { flagged: 'red' } });
    } else {
      flagged = await this.baseline.analyze(id);
    }

    const compositeUrl = await this.composite.buildComposite(id);
    await this.prisma.orderSession.update({
      where: { id },
      data: {
        status: 'DONE',
        endedAt: new Date(),
        compositeUrl: compositeUrl || undefined,
        flagged: flagged || undefined,
      },
    });

    return { code: 200, message: '已结束', data: { shotCount, flagged, compositeUrl } };
  }

  /** 管理端：某陪玩的工作记录 */
  @Get('companions/:companionId/work-records')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async workRecords(@Param('companionId') companionId: string, @Query('date') date?: string): Promise<ApiResponse<unknown>> {
    this.composite.cleanupOldDirs();
    const where: any = { companionId, status: 'DONE' };
    if (date) {
      const start = new Date(`${date}T00:00:00`);
      const end = new Date(`${date}T23:59:59`);
      where.endedAt = { gte: start, lte: end };
    }
    const sessions = await this.prisma.orderSession.findMany({
      where,
      include: {
        parentOrder: { select: { customer: { select: { customerCode: true } }, amount: true, gameName: true } },
        companion: { include: { user: { select: { username: true, displayName: true } } } },
      },
      orderBy: { endedAt: 'desc' },
      take: 100,
    });
    return { code: 200, message: 'ok', data: sessions.map((s) => ({ ...s, shotCount: this.composite.countShots(s.id) })) };
  }

  /** 管理端：待抽查队列（flagged + 随机 5% 样本） */
  @Get('admin/review-queue')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async reviewQueue(@Query('date') date?: string): Promise<ApiResponse<unknown>> {
    this.composite.cleanupOldDirs();
    const where: any = { status: 'DONE', flagged: { in: ['red', 'yellow'] } };
    if (date) {
      const start = new Date(`${date}T00:00:00`);
      const end = new Date(`${date}T23:59:59`);
      where.endedAt = { gte: start, lte: end };
    }
    const flagged = await this.prisma.orderSession.findMany({
      where,
      include: {
        parentOrder: { select: { customer: { select: { customerCode: true } }, amount: true, gameName: true } },
        companion: { include: { user: { select: { username: true, displayName: true } } } },
      },
      orderBy: { endedAt: 'desc' },
      take: 100,
    });
    return { code: 200, message: 'ok', data: flagged.map((s) => ({ ...s, shotCount: this.composite.countShots(s.id) })) };
  }

  @Get('admin/review-queue-count')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async reviewQueueCount(): Promise<ApiResponse<unknown>> {
    const count = await this.prisma.orderSession.count({
      where: { status: 'DONE', flagged: { in: ['red', 'yellow'] } },
    });
    return { code: 200, message: 'ok', data: { count } };
  }

  /** 标记已处理 */
  @Put('admin/review-queue/:id/processed')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async markProcessed(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.prisma.orderSession.update({ where: { id }, data: { flagged: 'processed' } });
    return { code: 200, message: 'ok', data: null };
  }
}
