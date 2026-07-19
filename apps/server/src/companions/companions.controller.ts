import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  Req,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CompanionsService } from './companions.service';
import { RestingMonitorService } from './resting-monitor.service';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { logger } from '../common/logger';
import { ChatService } from '../chat/chat.service';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CompanionsController {
  constructor(
    private readonly companionsService: CompanionsService,
    private readonly wsGateway: WsGateway,
    private readonly prisma: PrismaService,
    private readonly restingMonitor: RestingMonitorService,
    private readonly chatService: ChatService,
  ) {}

  @Get('companions')
  async findAll(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.findAll(req.user);
    return { code: 200, message: 'ok', data };
  }

  @Get('companions/ranking')
  async getRanking(@Req() req: any, @Query('type') type?: string): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.getRanking(req.user.studioId, type || 'revenue');
    return { code: 200, message: 'ok', data };
  }

  // Chat: get pending messages (DB-backed, survives restarts)
  @Get('companions/chat-pending')
  async chatPending(@Req() req: any, @Query('orderId') orderId?: string): Promise<ApiResponse<unknown>> {
    const studioId = req.user?.studioId;
    if (!studioId) return { code: 200, message: 'ok', data: { hasNew: false, messages: [] } };

    // Check for recent messages (last 30 seconds) as "new" indicator
    const since = new Date(Date.now() - 30000);
    const recentMsgs = await this.chatService.getRecentMessages(studioId, since);

    const otherMsgs = recentMsgs.filter((m) => m.senderId !== req.user.id);
    const hasNew = otherMsgs.length > 0;

    // Use the most recent other message's orderId if none specified
    const effectiveOrderId = orderId || otherMsgs[0]?.orderId || '';

    // Get messages for the resolved orderId
    let messages: { text: string; from: string; time: string }[] = [];
    if (effectiveOrderId) {
      const dbMsgs = await this.chatService.getMessages(studioId, effectiveOrderId);
      messages = dbMsgs.map((m) => ({
        text: m.text,
        from: m.senderId === req.user.id ? 'me' : 'them',
        time: m.createdAt.toISOString(),
      }));
    }

    // Find the most recent message not from this user for notification info
    const lastOther = otherMsgs[0];

    return {
      code: 200,
      message: 'ok',
      data: {
        hasNew,
        companionName: lastOther ? req.user.username : undefined,
        companionId: lastOther?.senderId,
        orderId: effectiveOrderId,
        avatar: null,
        messages,
      },
    };
  }

  @Get('companions/me/workbench')
  @Roles(UserRole.COMPANION)
  async getWorkbench(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.getWorkbench(req.user.companionId);
    return { code: 200, message: 'ok', data };
  }

  @Get('companions/me/wallet')
  @Roles(UserRole.COMPANION)
  async getWallet(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.getWallet(req.user.companionId);
    return { code: 200, message: 'ok', data };
  }

  @Post('companions/me/withdraw')
  @Roles(UserRole.COMPANION)
  async requestWithdraw(@Req() req: any, @Body() dto: { amount: number }): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.requestWithdraw(req.user.companionId, dto.amount);
    return { code: 201, message: '支取申请已提交', data };
  }

  // TASK-08: No-customer proof upload
  @Post('companions/me/proof-no-customer')
  @Roles(UserRole.COMPANION)
  async requestProofNoCustomer(@Req() req: any, @Body() dto: { note: string }): Promise<ApiResponse<unknown>> {
    await this.companionsService.requestProofNoCustomer(req.user.companionId, dto.note);
    return { code: 201, message: '解锁申请已提交，请等待管理员审核', data: null };
  }

  // TASK-11: Request dual companion
  @Post('companions/me/request-dual')
  @Roles(UserRole.COMPANION)
  async requestDualCompanion(@Req() req: any): Promise<ApiResponse<unknown>> {
    const result = await this.companionsService.requestDualCompanion(
      req.user.companionId,
      req.user.studioId,
      req.user.username,
    );
    if (result.studioId) {
      this.wsGateway.broadcastToStudio(result.studioId, 'order:dual-request', {
        companionId: result.companionId,
        companionName: result.companionName,
      });
    }
    return { code: 200, message: '双陪请求已发送', data: result };
  }

  // ── Attendance ──

  @Get('companions/attendance')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async getAttendance(
    @Query('companionId') companionId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.getAttendance({ companionId, dateFrom, dateTo });
    return { code: 200, message: 'ok', data };
  }

  // ── Work WeChat Management (MUST be before :id routes) ──

  @Get('companions/work-wechats')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async listWorkWechats(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.listWorkWechats(req.user.studioId);
    return { code: 200, message: 'ok', data };
  }

  @Post('companions/work-wechats')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async addWorkWechat(@Req() req: any, @Body() dto: { wechatId: string }): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.addWorkWechat(req.user.studioId, dto.wechatId);
    return { code: 201, message: 'ok', data };
  }

  @Put('companions/work-wechats/:id/bind')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async bindWechat(@Param('id') id: string, @Body() dto: { companionId: string }): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.bindWechat(id, dto.companionId);
    return { code: 200, message: 'ok', data };
  }

  @Put('companions/work-wechats/:id/unbind')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async unbindWechat(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.unbindWechat(id);
    return { code: 200, message: 'ok', data };
  }

  // ── Resignation (MUST be before :id routes) ──

  @Post('companions/:id/resign')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async resignCompanion(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.companionsService.resignCompanion(id);
    return { code: 200, message: '陪玩已离职，工位和微信已释放', data: null };
  }

  @Get('companions/:id')
  async findOne(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.findOne(id);
    return { code: 200, message: 'ok', data };
  }

  // ── Me endpoints (self-service shortcuts, MUST be before :id routes) ──

  @Put('companions/me/status')
  @Roles(UserRole.COMPANION)
  async updateMyStatus(@Body('status') status: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const id = req.user.companionId;
    if (!id) return { code: 400, message: '当前用户不是陪玩', data: null };

    // Entertainment threshold: check if companion has undrawn balance
    if (status === 'ENTERTAINMENT') {
      const blocked = await this.companionsService.checkEntertainmentBlocked(id);
      if (blocked) {
        return { code: 200, message: '不满足娱乐模式条件', data: { blocked: true, ...blocked } };
      }
    }
    logger.info('REST status update (me)', { companionId: id, username: req.user.username, status });
    const data = await this.companionsService.updateStatus(id, status, req.user);
    if (status === 'RESTING') this.restingMonitor.startResting(id);
    else this.restingMonitor.clearTimer(id);
    return { code: 200, message: 'ok', data };
  }

  @Put('companions/:id/status')
  @Roles(UserRole.COMPANION)
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    // Threshold check when switching to entertainment mode
    if (status === 'ENTERTAINMENT') {
      const companion = await this.prisma.companion.findUnique({ where: { id }, select: { deposit: true } });
      if (companion) {
        const depositCfg = await this.prisma.systemConfig.findUnique({
          where: { key: 'entertainment.deposit_threshold' },
        });
        const revenueCfg = await this.prisma.systemConfig.findUnique({
          where: { key: 'entertainment.revenue_threshold' },
        });
        const minDeposit = (depositCfg?.value as number) ?? 500;
        const minRevenue = (revenueCfg?.value as number) ?? 200;
        const d = companion.deposit || 0;

        // Calculate today's revenue from DONE orders
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const todayOrders = await this.prisma.order.findMany({
          where: { companionId: id, status: 'DONE', createdAt: { gte: todayStart, lte: todayEnd } },
          select: { amount: true },
        });
        const todayRevenue = todayOrders.reduce((s, o) => s + o.amount, 0);

        if (d < minDeposit || todayRevenue < minRevenue) {
          return {
            code: 200,
            message: '不满足娱乐模式条件',
            data: {
              blocked: true,
              deposit: d,
              revenue: todayRevenue,
              depositThreshold: minDeposit,
              revenueThreshold: minRevenue,
            },
          };
        }
      }
    }
    const data = await this.companionsService.updateStatus(id, status, req.user);
    if (status === 'RESTING') this.restingMonitor.startResting(id);
    else this.restingMonitor.clearTimer(id);
    return { code: 200, message: 'ok', data };
  }

  @Put('companions/:id/profile')
  @Roles(UserRole.COMPANION)
  async updateProfile(
    @Param('id') id: string,
    @Body() body: { gameProfiles?: { game: string; rank: string; hasAccount: boolean }[] },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    if (req.user.companionId !== id) throw new ForbiddenException('只能更新自己的资料');
    const data = await this.prisma.companion.update({
      where: { id },
      data: {
        games: body.gameProfiles ?? undefined,
      },
    });
    return { code: 200, message: '资料已更新', data };
  }

  @Get('companions/:id/revenue')
  async getRevenue(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.getRevenue(id);
    return { code: 200, message: 'ok', data };
  }

  @Post('companions/:id/command')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async sendCommand(
    @Param('id') id: string,
    @Body('command') command: string,
    @Body('params') params?: unknown,
  ): Promise<ApiResponse<unknown>> {
    this.wsGateway.sendCommand(id, command, params);
    return { code: 200, message: '指令已发送', data: { command, params } };
  }

  // Go Agent 通过 REST 上报心跳，解决 WebSocket 握手兼容问题
  @Post('companions/agent-heartbeat')
  @Roles(UserRole.COMPANION)
  async agentHeartbeat(
    @Req() req: any,
    @Body()
    body: {
      agentVersion?: string;
      currentMode?: string;
      workSec?: number;
      isThrottled?: boolean;
      throttleLimitKB?: number;
    },
  ): Promise<ApiResponse<unknown>> {
    const companionId = req.user.companionId;
    if (!companionId) {
      return { code: 400, message: '当前用户不是陪玩', data: null };
    }

    logger.debug('REST heartbeat', {
      companionId,
      username: req.user.username,
      mode: body.currentMode,
      workSec: body.workSec,
    });

    // 1. 更新在线状态（仅当离线时设为在线，避免覆盖用户主动设置的状态）
    const companion = await this.prisma.companion.findUnique({ where: { id: companionId }, select: { status: true } });
    const currentStatus = companion?.status || 'UNKNOWN';
    if (!companion || companion.status === 'OFFLINE') {
      await this.prisma.companion.update({
        where: { id: companionId },
        data: { status: 'AVAILABLE' },
      });
      logger.info('Heartbeat set AVAILABLE (was offline)', { companionId, previousStatus: currentStatus });
    } else {
      logger.debug('Heartbeat status preserved', { companionId, status: currentStatus });
    }

    // 2. 更新 PC 状态
    await this.prisma.companionPC.upsert({
      where: { companionId },
      create: {
        companionId,
        agentVersion: body.agentVersion ?? '0.0.0',
        lastHeartbeat: new Date(),
        currentMode: body.currentMode ?? 'ENTERTAINMENT',
        isThrottled: body.isThrottled ?? false,
        throttleLimitKB: body.throttleLimitKB ?? null,
      },
      update: {
        agentVersion: body.agentVersion ?? undefined,
        lastHeartbeat: new Date(),
        currentMode: body.currentMode ?? undefined,
        isThrottled: body.isThrottled ?? undefined,
        throttleLimitKB: body.throttleLimitKB ?? undefined,
      },
    });

    // 3. 记录计时日志
    if (body.workSec && body.workSec > 0) {
      const now = new Date();
      await this.prisma.companionTimeLog.create({
        data: {
          companionId,
          mode: body.currentMode ?? 'ENTERTAINMENT',
          startedAt: new Date(now.getTime() - body.workSec * 1000),
          endedAt: now,
          durationSeconds: body.workSec,
        },
      });
    }

    // 4. 通知 Studio
    if (req.user.studioId) {
      this.wsGateway.broadcastToStudio(req.user.studioId, 'status:broadcast', {
        companionId,
        status: 'AVAILABLE',
        mode: body.currentMode,
      });
    }

    return { code: 200, message: 'ok', data: { companionId, status: 'AVAILABLE' } };
  }

  // 踢出陪玩：强制下线
  @Post('companions/:id/kick')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async kickCompanion(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    // 1. 发送踢出指令给 Agent
    this.wsGateway.sendCommand(id, 'kick', { reason: '管理员强制下线' });

    // 2. 更新数据库状态为离线
    await this.prisma.companion.update({
      where: { id },
      data: { status: 'OFFLINE' },
    });

    // 3. 通知 Studio
    if (req.user.studioId) {
      this.wsGateway.broadcastToStudio(req.user.studioId, 'status:broadcast', {
        companionId: id,
        status: 'OFFLINE',
        reason: 'kicked',
      });
    }

    return { code: 200, message: '已踢出陪玩', data: { companionId: id, status: 'OFFLINE' } };
  }

  // 聊天通知：陪玩端发送消息时通知客服
  @Post('companions/chat-notify')
  @Roles(UserRole.COMPANION, UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async chatNotify(
    @Req() req: any,
    @Body() body: { orderId?: string; message?: string; time?: string },
  ): Promise<ApiResponse<unknown>> {
    const username = req.user.username || 'unknown';
    const studioId = req.user.studioId;
    if (!studioId) return { code: 400, message: 'error', data: null };

    const senderId = req.user.id || req.user.userId || username;
    const msgText = body.message || '发来一条消息';

    // Persist to database via ChatService
    const saved = await this.chatService.saveMessage({
      studioId,
      orderId: body.orderId || undefined,
      senderId,
      senderRole: req.user.role || 'COMPANION',
      text: msgText,
    });

    // Push via WebSocket for real-time delivery
    this.wsGateway.notifyChatMessage(studioId, {
      text: saved.text,
      senderId: saved.senderId,
      senderRole: saved.senderRole,
      senderName: username,
      orderId: saved.orderId || null,
      companionId: req.user.companionId || undefined,
      timestamp: saved.createdAt.toISOString(),
    });

    return { code: 200, message: 'ok', data: null };
  }

  @Post('companions/chat-upload')
  @Roles(UserRole.COMPANION, UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), '../../uploads/chat');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extname(file.originalname)}`;
          cb(null, name);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async chatUpload(@UploadedFile() file: Express.Multer.File): Promise<ApiResponse<{ url: string; name: string; size: number; type: string }>> {
    if (!file) return { code: 400, message: '未选择文件', data: null as any };
    return {
      code: 200, message: 'ok',
      data: {
        url: `/uploads/chat/${file.filename}`,
        name: file.originalname,
        size: file.size,
        type: file.mimetype,
      },
    };
  }

  @Put('companions/:id/finance')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async updateFinance(
    @Param('id') id: string,
    @Body()
    dto: {
      todayRevenue?: number;
      totalRevenue?: number;
      totalWithdrawn?: number;
      pendingWithdraw?: number;
      withdrawable?: number;
      deposit?: number;
      note?: string;
    },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.updateFinance(id, dto, req.user.id);
    return { code: 200, message: '财务数据已更新', data };
  }
  // ── Status Blacklist CRUD ──
  @Get('companions/:id/status-blacklist')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async getStatusBlacklist(@Param('id') id: string, @Query('status') status: string): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.getStatusBlacklist(id, status);
    return { code: 200, message: 'ok', data };
  }

  @Post('companions/:id/status-blacklist')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async addStatusBlacklist(
    @Param('id') id: string,
    @Body() dto: { status: string; processName: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.addStatusBlacklist(id, dto.status, dto.processName);
    return { code: 201, message: 'ok', data };
  }

  @Delete('companions/:id/status-blacklist/:entryId')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async removeStatusBlacklist(@Param('entryId') entryId: string): Promise<ApiResponse<unknown>> {
    await this.companionsService.removeStatusBlacklist(entryId);
    return { code: 200, message: 'ok', data: null };
  }
}
