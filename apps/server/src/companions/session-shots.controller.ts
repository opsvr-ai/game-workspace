// craftsman-ignore: TS001,TS003
import {
  Controller,
  Post,
  Get,
  Put,
  Body,
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
import { yuanToCents } from '../common/money';

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
  async uploadShot(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const session = await this.prisma.orderSession.findUnique({
      where: { id },
      select: { companionId: true, status: true, flagged: true },
    });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.companionId !== req.user.companionId) throw new ForbiddenException('只能上传自己会话的截图');
    if (!file) throw new BadRequestException('未收到文件');

    // 补传场景：会话已结束时收到迟到截图 → 重建长图；若之前因 0 截图标红，重新分析
    if (session.status === 'DONE') {
      const compositeUrl = await this.composite.buildComposite(id);
      const update: any = { compositeUrl: compositeUrl || undefined };
      if (session.flagged === 'red' && this.composite.countShots(id) > 0) {
        const newFlag = await this.baseline.analyze(id);
        update.flagged = newFlag || 'processed'; // 无其他异常则清除红标
      }
      await this.prisma.orderSession.update({ where: { id }, data: update });
    }

    return { code: 200, message: 'ok', data: { url: `/uploads/session-shots/${id}/${file.filename}` } };
  }

  /** 结束会话：生成合并长图 + 基线分析标记 */
  @Put('sessions/:id/finish')
  @Roles(UserRole.COMPANION)
  async finishSession(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { transferTotalYuan?: number },
  ): Promise<ApiResponse<unknown>> {
    const session = await this.prisma.orderSession.findUnique({
      where: { id },
      select: {
        companionId: true,
        status: true,
        parentOrderId: true,
        claimedPrice: true,
        duration: true,
        amount: true,
        startedAt: true,
        totalPausedSec: true,
        paidByDeposit: true,
        parentOrder: { select: { customerId: true } },
      },
    });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.companionId !== req.user.companionId) throw new ForbiddenException('只能操作自己的会话');

    const shotCount = this.composite.countShots(id);
    const blackCount = this.composite.countBlackShots(id);
    const validShots = Math.max(0, shotCount - blackCount);
    const cfg = await this.getCaptureConfig();
    let flagged: 'red' | 'yellow' | null = null;
    let flaggedReason: string | null = null;

    if (validShots === 0) {
      flagged = 'red';
      flaggedReason = shotCount > 0
        ? `黑屏截图 ${blackCount} 张，无有效工作记录`
        : '工作记录截图数量为 0，无法证明服务过程';
      await this.prisma.orderSession.update({ where: { id }, data: { flagged: 'red' } });
    } else {
      const analysis = await this.baseline.analyzeDetailed(id);
      flagged = analysis.level;
      flaggedReason = analysis.reason;

      const full = await this.prisma.orderSession.findUnique({ where: { id }, select: { duration: true } });
      const expected = Math.max(1, Math.round((full?.duration || 1) * cfg.expectedPerHour));
      const required = Math.max(1, Math.ceil(expected * cfg.minRatePercent / 100));
      if (validShots < required && flagged !== 'red') {
        flagged = 'yellow';
        flaggedReason = flaggedReason
          ? `${flaggedReason}；有效截图不足（${validShots}/${required}，预期 ${expected}）`
          : `有效截图不足（${validShots}/${required}，预期 ${expected}）`;
        await this.prisma.orderSession.update({ where: { id }, data: { flagged: 'yellow' } });
      }

      if (shotCount > 0) {
        const blackRate = (blackCount / shotCount) * 100;
        if (blackRate > cfg.blackRateMaxPercent && flagged !== 'red') {
          flagged = 'yellow';
          flaggedReason = flaggedReason
            ? `${flaggedReason}；黑屏率过高（${blackRate.toFixed(0)}%，上限 ${cfg.blackRateMaxPercent}%）`
            : `黑屏率过高（${blackRate.toFixed(0)}%，上限 ${cfg.blackRateMaxPercent}%）`;
          await this.prisma.orderSession.update({ where: { id }, data: { flagged: 'yellow' } });
        }
      }
    }
    // 财务审核：先落库再合成证据长图，确保长图包含财务核对卡
    let auditStatus: string | null = null;
    try {
      const filledHours = session.duration || 1;
      const declaredPrice =
        session.claimedPrice ?? (filledHours > 0 ? session.amount / filledHours : session.amount);
      const auditCents = yuanToCents(filledHours * declaredPrice);
      const transferCents = body?.transferTotalYuan != null ? yuanToCents(body.transferTotalYuan) : null;
      auditStatus = transferCents == null ? 'PENDING' : transferCents < auditCents ? 'FLAGGED' : 'OK';
      await this.prisma.order.update({
        where: { id: session.parentOrderId },
        data: {
          auditAmountCents: auditCents,
          transferTotalCents: transferCents,
          auditStatus,
        },
      });
      if (auditStatus === 'FLAGGED' && flagged !== 'red') {
        flagged = 'yellow';
        flaggedReason = flaggedReason ? `${flaggedReason}；实收转账低于审核金额` : '实收转账低于审核金额';
      }
    } catch (err) {
      console.error('finance audit write failed', err);
    }

    const endedAt = new Date();
    const compositeUrl = await this.composite.buildComposite(id, flaggedReason, flagged);
    await this.prisma.orderSession.update({
      where: { id },
      data: {
        status: 'DONE',
        endedAt,
        compositeUrl: compositeUrl || undefined,
        flagged: flagged || undefined,
      },
    });

    // 存单扣款：用存单支付的服务，按实际计时扣减客户存单余额
    if (session.paidByDeposit) {
      const started = session.startedAt ? new Date(session.startedAt).getTime() : endedAt.getTime();
      const activeSec = Math.max(0, (endedAt.getTime() - started) / 1000 - (session.totalPausedSec || 0));
      const actualHours = activeSec / 3600;
      const filledHours = session.duration || 1;
      const price = session.claimedPrice ?? (filledHours > 0 ? session.amount / filledHours : session.amount);
      const deduct = Math.round(actualHours * price * 100) / 100;
      await this.prisma.customer.update({
        where: { id: session.parentOrder.customerId },
        data: { depositBalance: { decrement: deduct } },
      }).catch(() => {});
    }

    return { code: 200, message: '已结束', data: { shotCount, flagged, compositeUrl, auditStatus, flaggedReason } };
  }
  private async getCaptureConfig(): Promise<{ expectedPerHour: number; minRatePercent: number; blackRateMaxPercent: number }> {
    const keys = ['capture.expected_per_hour', 'capture.min_rate_percent', 'capture.black_rate_max_percent'];
    const defaults: Record<string, number> = {
      'capture.expected_per_hour': 4,
      'capture.min_rate_percent': 50,
      'capture.black_rate_max_percent': 30,
    };
    const records = await this.prisma.systemConfig.findMany({ where: { key: { in: keys } } });
    const map: Record<string, number> = {};
    for (const r of records) {
      const v = (r.value as any) as number;
      map[r.key] = typeof v === 'number' ? v : Number(v);
    }
    const num = (k: string) => (Number.isFinite(map[k]) ? map[k] : defaults[k]);
    return {
      expectedPerHour: num('capture.expected_per_hour'),
      minRatePercent: num('capture.min_rate_percent'),
      blackRateMaxPercent: num('capture.black_rate_max_percent'),
    };
  }

  /** 管理端：某陪玩的工作记录 */
  @Get('companions/:companionId/work-records')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async workRecords(
    @Param('companionId') companionId: string,
    @Query('date') date?: string,
  ): Promise<ApiResponse<unknown>> {
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
    return {
      code: 200,
      message: 'ok',
      data: sessions.map((s) => ({ ...s, shotCount: this.composite.countShots(s.id) })),
    };
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
    return {
      code: 200,
      message: 'ok',
      data: flagged.map((s) => ({ ...s, shotCount: this.composite.countShots(s.id) })),
    };
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
