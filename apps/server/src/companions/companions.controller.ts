import { Controller, Get, Put, Post, Param, Body, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CompanionsService } from './companions.service';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';

// 内存聊天通知存储 (studioId -> { companionName, timestamp })
const chatNotifications = new Map<string, { companionName: string; timestamp: number }>();

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CompanionsController {
  constructor(
    private readonly companionsService: CompanionsService,
    private readonly wsGateway: WsGateway,
    private readonly prisma: PrismaService,
  ) {}

  @Get('companions')
  async findAll(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.findAll(req.user);
    return { code: 200, message: 'ok', data };
  }

  @Get('companions/ranking')
  async getRanking(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.getRanking(req.user);
    return { code: 200, message: 'ok', data };
  }

  // 轮询聊天通知 — 必须在 :id 之前
  @Get('companions/chat-pending')
  async chatPending(@Req() req: any): Promise<ApiResponse<unknown>> {
    const studioId = req.user?.studioId;
    if (!studioId) return { code: 200, message: 'ok', data: { hasNew: false } };
    const notif = chatNotifications.get(studioId);
    if (notif && notif.companionName !== req.user?.username && (Date.now() - notif.timestamp < 15000)) {
      return { code: 200, message: 'ok', data: { hasNew: true, companionName: notif.companionName } };
    }
    return { code: 200, message: 'ok', data: { hasNew: false } };
  }

  @Get('companions/:id')
  async findOne(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.findOne(id);
    return { code: 200, message: 'ok', data };
  }

  @Put('companions/:id/status')
  @Roles(UserRole.COMPANION)
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.updateStatus(id, status, req.user);
    return { code: 200, message: 'ok', data };
  }

  @Put('companions/:id/profile')
  @Roles(UserRole.COMPANION)
  async updateProfile(
    @Param('id') id: string,
    @Body() body: { gameProfiles?: { game: string; rank: string; hasAccount: boolean }[] },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    if (req.user.companionId !== id) throw new (require('@nestjs/common').ForbiddenException)('只能更新自己的资料');
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
  @Roles(UserRole.ADMIN, UserRole.OWNER)
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
    @Body() body: { agentVersion?: string; currentMode?: string; workSec?: number; isThrottled?: boolean; throttleLimitKB?: number },
  ): Promise<ApiResponse<unknown>> {
    const companionId = req.user.companionId;
    if (!companionId) {
      return { code: 400, message: '当前用户不是陪玩', data: null };
    }

    // 1. 更新在线状态
    await this.prisma.companion.update({
      where: { id: companionId },
      data: { status: 'ONLINE' },
    });

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
        status: 'ONLINE',
        mode: body.currentMode,
      });
    }

    return { code: 200, message: 'ok', data: { companionId, status: 'ONLINE' } };
  }

  // 踢出陪玩：强制下线
  @Post('companions/:id/kick')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async kickCompanion(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
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
  async chatNotify(@Req() req: any, @Body() body: { orderId: string }): Promise<ApiResponse<unknown>> {
    const username = req.user.username || 'unknown';
    const studioId = req.user.studioId;
    if (!studioId) return { code: 400, message: 'error', data: null };
    // 存储通知到内存
    chatNotifications.set(studioId, { companionName: username, timestamp: Date.now() });
    // 通过 WebSocket 广播
    this.wsGateway.notifyChat(studioId, username, body.orderId);
    return { code: 200, message: 'ok', data: null };
  }

}
