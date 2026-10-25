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
  GoneException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { CompositeService } from './composite.service';
import { CustomerBaselineService } from './customer-baseline.service';
import { yuanToCents } from '../common/money';
import { resolveDepositDeduct } from '../common/deposit-deduct';
import { resolveConfigsRaw } from '../common/studio-config';
import { releaseCompanionIfIdle, scheduleReleaseCompanionIfIdle } from '../common/companion-presence';
import { getServiceTiming } from '../common/service-timing';

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
      select: { companionId: true, coCompanionId: true, status: true, flagged: true, endedAt: true },
    });
    const cleanup = () => {
      try {
        if (file?.path) unlinkSync(file.path);
      } catch {
        /* 已删除 / 文件没落盘 */
      }
    };
    if (!session) {
      cleanup();
      throw new NotFoundException('会话不存在');
    }
    // 双陪的副陪也要能上传自己的截图：以前只认主陪，副陪每 10 分钟传一次都被 403，
    // 文件却已经被 multer 落盘，越堆越多。
    if (session.companionId !== req.user.companionId && session.coCompanionId !== req.user.companionId) {
      cleanup();
      throw new ForbiddenException('只能上传自己会话的截图');
    }
    if (!file) throw new BadRequestException('未收到文件');

    // 已结束的会话只接受「当时拍下的迟到补传」，不接受结束之后继续截的图。
    if (session.status === 'DONE' && session.endedAt) {
      const raw = req.body?.captureTime;
      const shotAt = raw ? new Date(Array.isArray(raw) ? raw[0] : raw) : new Date();
      if (Number.isFinite(shotAt.getTime()) && shotAt.getTime() > session.endedAt.getTime() + 5 * 60 * 1000) {
        cleanup();
        throw new GoneException('会话已结束，不能继续上传截图');
      }
    }

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
    @Body() body: { transferTotalYuan?: number; depositDeductYuan?: number },
  ): Promise<ApiResponse<unknown>> {
    const session = await this.prisma.orderSession.findUnique({
      where: { id },
      select: {
        companionId: true,
        coCompanionId: true,
        status: true,
        parentOrderId: true,
        claimedPrice: true,
        duration: true,
        amount: true,
        startedAt: true,
        pausedAt: true,
        totalPausedSec: true,
        paidByDeposit: true,
        parentOrder: { select: { customerId: true } },
      },
    });
    if (!session) throw new NotFoundException('会话不存在');
    const isMain = session.companionId === req.user.companionId;
    const isCo = session.coCompanionId === req.user.companionId;
    // 双陪主陪已经先结束（companionId 置空、副陪继续）：他再点旧页面上的「结束服务」
    // 不要返回 403「只能操作自己的会话」，否则按钮一直留着、一直报错。
    // 这里做成幂等成功：告诉他「你已经结束过了，搭档继续」，前端收到 mainDetached 会清掉弹窗。
    if (!isMain && !isCo && !session.companionId && session.coCompanionId) {
      return {
        code: 200,
        message: '你已经结束过了，搭档继续服务',
        data: { mainDetached: true, coCompanionId: session.coCompanionId, orderId: session.parentOrderId },
      };
    }
    if (!isMain && !isCo) throw new ForbiddenException('只能操作自己的会话');

    // 双陪 / 代打：主陪点结束只结束自己，搭档继续打；不能把整段会话和搭档一起结束。
    // 主陪的陪伴段先摘掉，会话保留 ACTIVE、保留副陪和 startedAt，等副陪自己结束。
    if (isMain && session.coCompanionId && session.coCompanionId !== req.user.companionId) {
      await this.prisma.orderSession.update({
        where: { id },
        data: { companionId: null },
      });
      await releaseCompanionIfIdle(this.prisma, req.user.companionId, id);
      return {
        code: 200,
        message: '你已结束，搭档继续服务',
        data: {
          mainDetached: true,
          coCompanionId: session.coCompanionId,
          orderId: session.parentOrderId,
        },
      };
    }

    const shotCount = this.composite.countShots(id);
    const blackCount = this.composite.countBlackShots(id);
    const validShots = Math.max(0, shotCount - blackCount);
    const cfg = await this.getCaptureConfig(req.user?.studioId ?? null);
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
    // 先计算真实计时（结束时间 − 开始时间 − 暂停时间），作为财务审核的唯一口径。
    const endedAt = new Date();
    let totalPausedSec = session.totalPausedSec || 0;
    if (session.pausedAt) {
      // 结束时若还处于暂停态，先结清这段暂停时长，避免真实计时被多算。
      totalPausedSec += Math.floor((endedAt.getTime() - new Date(session.pausedAt).getTime()) / 1000);
    }
    const started = session.startedAt ? new Date(session.startedAt).getTime() : endedAt.getTime();
    const activeSec = Math.max(0, (endedAt.getTime() - started) / 1000 - totalPausedSec);
    const actualHours = activeSec / 3600;
    const declaredPrice =
      session.claimedPrice ?? (session.duration > 0 ? session.amount / session.duration : session.amount);

    // 财务审核：先落库再合成证据长图，确保长图包含财务核对卡
    let auditStatus: string | null = null;
    try {
      const auditCents = yuanToCents(actualHours * declaredPrice);
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

    const compositeUrl = await this.composite.buildComposite(id, flaggedReason, flagged);
    await this.prisma.orderSession.update({
      where: { id },
      data: {
        status: 'DONE',
        endedAt,
        compositeUrl: compositeUrl || undefined,
        flagged: flagged || undefined,
        ...(session.pausedAt ? { pausedAt: null, totalPausedSec } : {}),
      },
    });

    // 结束服务后恢复陪玩状态为空闲，避免依赖前端「完成订单」这一步。
    // 用「没有别的进行中会话才放回空闲」的判断，主陪和副陪都要复位：
    // 以前只改主陪，副陪会一直挂在「接单中」，收不到后面的急单。
    const timing = await getServiceTiming(this.prisma, req.user?.studioId ?? null);
    scheduleReleaseCompanionIfIdle(this.prisma, session.companionId, id, timing.bufferMs);
    scheduleReleaseCompanionIfIdle(this.prisma, session.coCompanionId, id, timing.bufferMs);

    // 存单扣款（老板 2026-10-04：「有时候你统计的并不准，以陪玩自己输入的为准吧」）：
    // 陪玩在「结束服务」里填了金额就以他填的为准，没填才退回「实际时长 × 单价」；
    // 最多扣到客户当前存单余额（不做成负数，否则财务「未打存单预留」会被算花）。
    let depositDeducted: number | null = null;
    if (session.paidByDeposit && session.parentOrder.customerId) {
      const autoDeduct = Math.round(actualHours * declaredPrice * 100) / 100;
      const customer = await this.prisma.customer
        .findUnique({ where: { id: session.parentOrder.customerId }, select: { depositBalance: true } })
        .catch(() => null);
      depositDeducted = resolveDepositDeduct({
        wanted: body?.depositDeductYuan,
        autoDeduct,
        balance: customer?.depositBalance ?? 0,
      });
      if (depositDeducted > 0) {
        await this.prisma.customer.update({
          where: { id: session.parentOrder.customerId },
          data: { depositBalance: { decrement: depositDeducted } },
        }).catch(() => {});
      }
    }

    return {
      code: 200,
      message: '已结束',
      data: { shotCount, flagged, compositeUrl, auditStatus, flaggedReason, depositDeducted },
    };
  }
  private async getCaptureConfig(studioId?: string | null): Promise<{ expectedPerHour: number; minRatePercent: number; blackRateMaxPercent: number }> {
    const keys = ['capture.expected_per_hour', 'capture.min_rate_percent', 'capture.black_rate_max_percent'];
    const defaults: Record<string, number> = {
      'capture.expected_per_hour': 4,
      'capture.min_rate_percent': 50,
      'capture.black_rate_max_percent': 30,
    };
    // 按「本店店长填的 → 老板全局默认」解析，别的工作室改了不影响本店
    const map = await resolveConfigsRaw(this.prisma, studioId ?? null, keys);
    const num = (k: string) => (Number.isFinite(Number(map[k])) ? Number(map[k]) : defaults[k]);
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
