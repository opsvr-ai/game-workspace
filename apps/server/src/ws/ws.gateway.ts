import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.service';
import { logger } from '../common/logger';
import { CompanionsService } from '../companions/companions.service';

interface ConnectedUser {
  id: string;
  username: string;
  role: string;
  studioId: string | null;
  companionId?: string;
}

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/' })
export class WsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  /** companionId -> socketId */
  private companionSockets = new Map<string, string>();
  /** userId -> socketId */
  private userSockets = new Map<string, string>();

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => CompanionsService)) private readonly companionsService: CompanionsService,
  ) {}

  // ── lifecycle ──────────────────────────────────────────────────────

  afterInit(): void {
    // Log ALL incoming Socket.IO events for debugging
    this.server.use((socket, next) => {
      const originalOnEvent = (socket as any).onevent;
      (socket as any).onevent = (packet: any) => {
        const [event, ...args] = packet.data || [];
        // Skip noisy heartbeat to keep logs clean
        if (event !== 'companion:heartbeat') {
          logger.debug('Socket.IO event received', { event, args: JSON.stringify(args).slice(0, 200) });
        }
        originalOnEvent.call(socket, packet);
      };
      next();
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = (client.handshake.auth?.token || client.handshake.query?.token) as string | undefined;
      if (!token) { client.disconnect(true); return; }

      const payload = this.jwt.verify<JwtPayload>(token, { secret: process.env.JWT_SECRET });

      const user: ConnectedUser = {
        id: payload.sub, username: payload.username, role: payload.role,
        studioId: payload.studioId, companionId: payload.companionId,
      };
      client.data.user = user;

      void client.join(`user:${user.id}`);
      this.userSockets.set(user.id, client.id);
      if (user.studioId) { void client.join(`studio:${user.studioId}`); }
      if (user.companionId) {
        void client.join(`companion:${user.companionId}`);
        void client.join(`pc:${user.companionId}`);
        this.companionSockets.set(user.companionId, client.id);
        logger.info('Companion connected', { companionId: user.companionId, username: user.username });

        await this.prisma.companion.update({
          where: { id: user.companionId }, data: { status: 'AVAILABLE' },
        });

        // Record attendance on connection
        await this.companionsService.ensureAttendance(user.companionId);

        if (user.studioId) {
          this.server.to(`studio:${user.studioId}`).emit('status:broadcast', {
            companionId: user.companionId, status: 'AVAILABLE',
          });
        }
      }
    } catch { client.disconnect(true); }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    if (!user) return;
    this.userSockets.delete(user.id);
    if (!user.companionId) return;
    this.companionSockets.delete(user.companionId);
    logger.info('Companion disconnected', { companionId: user.companionId });

    await this.prisma.companion.update({
      where: { id: user.companionId }, data: { status: 'OFFLINE' },
    }).catch(() => null);

    // Finalize attendance on disconnect
    await this.companionsService.finalizeAttendance(user.companionId);

    if (user.studioId) {
      this.server.to(`studio:${user.studioId}`).emit('status:broadcast', {
        companionId: user.companionId, status: 'OFFLINE',
      });
    }
  }

  // ── inbound ────────────────────────────────────────────────────────

  @SubscribeMessage('companion:status')
  async handleStatusChange(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { status: string; mode?: string },
  ): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    if (!user?.companionId) return;

    logger.info('WS companion:status received', { companionId: user.companionId, username: user.username, status: data.status, mode: data.mode });

    // Compat: map old client status values to new enum
    const STATUS_COMPAT: Record<string, string> = { 'ONLINE': 'AVAILABLE', 'IDLE': 'ENTERTAINMENT' };
    const mappedStatus = STATUS_COMPAT[data.status] || data.status;

    // Get previous status for time tracking
    const prev = await this.prisma.companion.findUnique({
      where: { id: user.companionId },
      select: { status: true },
    }).catch(() => null);
    const prevStatus = prev?.status;

    await this.prisma.companion.update({
      where: { id: user.companionId }, data: { status: mappedStatus },
    }).then(() => {
      logger.debug('DB status updated', { companionId: user.companionId, status: data.status });
    }).catch((err) => {
      logger.error('DB status update failed', { companionId: user.companionId, error: (err as any).message });
    });

    // ── Time tracking: start/stop CompanionTimeLog on status change ──
    if (mappedStatus !== prevStatus) {
      const now = new Date();
      // Close any open time log for the previous status
      if (prevStatus) {
        await this.prisma.companionTimeLog.updateMany({
          where: { companionId: user.companionId, mode: prevStatus, endedAt: null },
          data: { endedAt: now },
        });
        logger.info('TimeLog closed', { companionId: user.companionId, mode: prevStatus });
      }
      // Open new time log for the new status (ENTERTAINMENT = billing)
      await this.prisma.companionTimeLog.create({
        data: {
          companionId: user.companionId,
          mode: mappedStatus,
          startedAt: now,
          endedAt: null,
          durationSeconds: 0,
        },
      });
      logger.info('TimeLog started', { companionId: user.companionId, mode: mappedStatus });
    }

    if (user.studioId) {
      this.server.to(`studio:${user.studioId}`).emit('status:broadcast', {
        companionId: user.companionId, status: mappedStatus, mode: data.mode,
      });
      logger.debug('Broadcast to studio', { studioId: user.studioId });
    }
  }

  @SubscribeMessage('companion:heartbeat')
  async handleHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { agentVersion?: string; currentMode?: string; workSec?: number; isThrottled?: boolean; throttleLimitKB?: number },
  ): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    if (!user?.companionId) return;

    logger.debug('WS heartbeat', { companionId: user.companionId, username: user.username, mode: data.currentMode, workSec: data.workSec });

    await this.prisma.companionPC.upsert({
      where: { companionId: user.companionId },
      create: {
        companionId: user.companionId, agentVersion: data.agentVersion ?? '0.0.0',
        lastHeartbeat: new Date(), currentMode: data.currentMode ?? 'ENTERTAINMENT',
        isThrottled: data.isThrottled ?? false, throttleLimitKB: data.throttleLimitKB ?? null,
      },
      update: {
        agentVersion: data.agentVersion ?? undefined, lastHeartbeat: new Date(),
        currentMode: data.currentMode ?? undefined, isThrottled: data.isThrottled ?? undefined,
        throttleLimitKB: data.throttleLimitKB ?? undefined,
      },
    });

    // Update duration on open time logs (status-based tracking)
    const now = new Date();
    const openLog = await this.prisma.companionTimeLog.findFirst({
      where: { companionId: user.companionId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (openLog) {
      const elapsed = Math.round((now.getTime() - openLog.startedAt.getTime()) / 1000);
      await this.prisma.companionTimeLog.update({
        where: { id: openLog.id },
        data: { durationSeconds: elapsed },
      });

      // Balance check: if in ENTERTAINMENT mode and running out of funds
      if (openLog.mode === 'ENTERTAINMENT') {
        const companion = await this.prisma.companion.findUnique({
          where: { id: user.companionId },
          select: { balance: true, deposit: true, status: true },
        });
        if (companion) {
          const availableFunds = (companion.balance || 0) + (companion.deposit || 0);
          const feeMinutes = Math.floor(elapsed / 60);
          const fee = feeMinutes; // ¥1/min
          const remainingMinutes = Math.max(0, availableFunds - fee);

          // 30 minute warning
          if (remainingMinutes <= 30 && remainingMinutes > 0) {
            this.server.to(`user:${user.id}`).emit('entertainment:warning', {
              message: `娱乐已 ${feeMinutes} 分钟（¥${fee}），余额仅够再玩 ${remainingMinutes} 分钟，30 分钟后将自动切换到空闲状态`,
              elapsedMinutes: feeMinutes,
              fee,
              availableFunds,
              remainingMinutes,
              autoSwitchIn: 30 * 60, // seconds
            });
            logger.warn('Entertainment balance warning', { companionId: user.companionId, fee, remainingMinutes });
          }

          // Balance exhausted — force switch to AVAILABLE
          if (remainingMinutes <= 0 && companion.status === 'ENTERTAINMENT') {
            await this.prisma.companion.update({
              where: { id: user.companionId },
              data: { status: 'AVAILABLE' },
            });
            // Close current entertainment log
            await this.prisma.companionTimeLog.updateMany({
              where: { companionId: user.companionId, mode: 'ENTERTAINMENT', endedAt: null },
              data: { endedAt: now },
            });
            // Open AVAILABLE log
            await this.prisma.companionTimeLog.create({
              data: { companionId: user.companionId, mode: 'AVAILABLE', startedAt: now, endedAt: null, durationSeconds: 0 },
            });
            this.server.to(`user:${user.id}`).emit('entertainment:forceIdle', {
              message: `余额不足，已自动切换到空闲状态。娱乐 ${feeMinutes} 分钟，费用 ¥${fee}`,
            });
            if (user.studioId) {
              this.server.to(`studio:${user.studioId}`).emit('status:broadcast', {
                companionId: user.companionId, status: 'AVAILABLE',
              });
            }
            logger.warn('Force idle due to insufficient balance', { companionId: user.companionId, fee, availableFunds });
          }
        }
      }
    }

    // Legacy: Go Agent accumulated workSec
    if (data.workSec && data.workSec > 0) {
      await this.prisma.companionTimeLog.create({
        data: {
          companionId: user.companionId, mode: data.currentMode ?? 'ENTERTAINMENT',
          startedAt: new Date(now.getTime() - data.workSec * 1000), endedAt: now, durationSeconds: data.workSec,
        },
      });
    }
  }

  @SubscribeMessage('pc:command_ack')
  async handleCommandAck(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { command: string; success: boolean },
  ): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    if (!user?.companionId) return;
    logger.info('RECV pc:command_ack', { companionId: user.companionId, command: data.command, success: data.success });
    if (!data.success) logger.warn('Remote command failed', { companionId: user.companionId, command: data.command });

    const pc = await this.prisma.companionPC.findUnique({ where: { companionId: user.companionId } });
    if (!pc) return;

    await this.prisma.pCOperationLog.create({
      data: { pcId: pc.id, operation: data.command, operatorId: user.id, detail: JSON.stringify({ success: data.success }) },
    });
  }

  // ── blacklist inbound ──────────────────────────────────────────────

  @SubscribeMessage('blacklist:report')
  async handleBlacklistReport(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { processes: any[]; totalCount: number },
  ): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    if (!user?.companionId) return;
    logger.info('RECV blacklist:report', { companionId: user.companionId, totalCount: data.totalCount });

    await this.prisma.companionProcessReport.create({
      data: { companionId: user.companionId, processes: data.processes as any, totalCount: data.totalCount, reportTime: new Date() },
    });
  }

  @SubscribeMessage('blacklist:kill_result')
  async handleBlacklistKillResult(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { processName: string; pid: number; success: boolean; resultText?: string; triggeredBy?: string; processPath?: string },
  ): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    if (!user?.companionId) return;
    logger.info('RECV blacklist:kill_result', { companionId: user.companionId, processName: data.processName, pid: data.pid, success: data.success });
    if (!data.success) logger.warn('Kill failed', { companionId: user.companionId, processName: data.processName, resultText: data.resultText });

    await this.prisma.processKillLog.create({
      data: {
        companionId: user.companionId, processName: data.processName, processPath: data.processPath ?? null,
        pid: data.pid, success: data.success, resultText: data.resultText ?? null, triggeredBy: data.triggeredBy ?? 'PERIODIC',
      },
    });
  }

  @SubscribeMessage('blacklist:update_ack')
  async handleBlacklistUpdateAck(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { version: number },
  ): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    if (!user?.companionId) return;
    logger.info('RECV blacklist:update_ack', { companionId: user.companionId, version: data.version });
  }

  // ── outbound ───────────────────────────────────────────────────────

  sendCommand(companionId: string, command: string, params?: unknown): void {
    const socketId = this.companionSockets.get(companionId);
    if (!socketId) { logger.warn('SEND pc:command FAILED (offline)', { companionId, command }); return; }
    logger.info('SEND pc:command', { companionId, command, params });
    this.server.to(socketId).emit('pc:command', { command, params });
  }

  pushOrder(companionId: string, order: unknown): void {
    const socketId = this.companionSockets.get(companionId);
    if (!socketId) { logger.warn('SEND order:new FAILED (offline)', { companionId }); return; }
    logger.info('SEND order:new', { companionId, orderId: (order as any)?.id });
    this.server.to(socketId).emit('order:new', order);
  }

  broadcastToStudio(studioId: string, event: string, data: unknown): void {
    this.server.to(`studio:${studioId}`).emit(event, data);
  }

  async broadcastToIdleCompanions(studioId: string, event: string, data: unknown): Promise<void> {
    const idleCompanions = await this.prisma.companion.findMany({ where: { studioId, status: 'AVAILABLE' }, select: { id: true } });
    for (const c of idleCompanions) {
      const socketId = this.companionSockets.get(c.id);
      if (socketId) this.server.to(socketId).emit(event, data);
    }
  }

  notifyUser(userId: string, event: string, data: unknown): void {
    const socketId = this.userSockets.get(userId);
    if (socketId) { this.server.to(socketId).emit(event, data); }
  }

  notifyChat(studioId: string, companionName: string, _chatKey: string, companionId?: string, orderId?: string): void {
    this.server.to(`studio:${studioId}`).emit('chat:notify', {
      companionName, companionId, orderId, timestamp: new Date().toISOString(),
    });
  }

  // ── blacklist outbound ─────────────────────────────────────────────

  sendBlacklistUpdate(
    companionId: string,
    blacklist: { processName: string; processPath: string | null }[],
    whitelist: { processName: string; isSystem: boolean }[],
    version: number,
  ): void {
    const socketId = this.companionSockets.get(companionId);
    if (!socketId) { logger.warn('SEND blacklist:update FAILED (offline)', { companionId, version }); return; }
    logger.info('SEND blacklist:update', { companionId, blacklistCount: blacklist.length, whitelistCount: whitelist.length, version });
    this.server.to(socketId).emit('blacklist:update', { blacklist, whitelist, version });
  }

  async broadcastBlacklistToStudio(
    studioId: string,
    blacklist: { processName: string; processPath: string | null }[],
    whitelist: { processName: string; isSystem: boolean }[],
  ): Promise<void> {
    const companions = await this.prisma.companion.findMany({ where: { studioId }, select: { id: true } });
    const version = Date.now();
    let pushed = 0, skipped = 0;
    for (const c of companions) {
      const socketId = this.companionSockets.get(c.id);
      if (socketId) { this.server.to(socketId).emit('blacklist:update', { blacklist, whitelist, version }); pushed++; }
      else { skipped++; }
    }
    logger.info('SEND blacklist:update (broadcast)', { studioId, total: companions.length, pushed, skipped, version });
  }
}
