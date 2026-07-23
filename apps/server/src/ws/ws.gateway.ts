// craftsman-ignore: TS001,TS003
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
import { BridgeService } from '../studios/bridge.service';
import { HeartbeatService } from './heartbeat.service';
import { BlacklistIngestService } from './blacklist-ingest.service';

export interface ConnectedUser {
  id: string;
  username: string;
  role: string;
  studioId: string | null;
  companionId?: string;
}

const wsAllowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:8000').split(',');

@WebSocketGateway({
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allowed?: boolean) => void) => {
      if (!origin || wsAllowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  },
  namespace: '/',
})
export class WsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  /** companionId -> socketId */
  private companionSockets = new Map<string, string>();
  /** userId -> socketId */
  private userSockets = new Map<string, string>();

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly bridgeService: BridgeService,
    @Inject(forwardRef(() => CompanionsService)) private readonly companionsService: CompanionsService,
    private readonly heartbeatService: HeartbeatService,
    private readonly blacklistIngestService: BlacklistIngestService,
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
      if (!token) {
        client.disconnect(true);
        return;
      }

      const payload = this.jwt.verify<JwtPayload>(token, { secret: process.env.JWT_SECRET });

      const user: ConnectedUser = {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
        studioId: payload.studioId,
        companionId: payload.companionId,
      };
      client.data.user = user;

      void client.join(`user:${user.id}`);
      this.userSockets.set(user.id, client.id);
      if (user.studioId) {
        void client.join(`studio:${user.studioId}`);
        // Join all bridged studio rooms for cross-studio real-time events
        this.bridgeService
          .getBridgedStudioIds(user.studioId)
          .then((bridgedIds) => {
            for (const bridgedId of bridgedIds) {
              void client.join(`studio:${bridgedId}`);
            }
          })
          .catch((err) => {
            logger.error('Failed to join bridged studio rooms', {
              error: (err as Error).message,
              studioId: user.studioId,
            });
          });
      }
      if (user.companionId) {
        void client.join(`companion:${user.companionId}`);
        void client.join(`pc:${user.companionId}`);
        this.companionSockets.set(user.companionId, client.id);
        logger.info('Companion connected', { companionId: user.companionId, username: user.username });

        await this.prisma.companion.update({
          where: { id: user.companionId },
          data: { status: 'AVAILABLE' },
        });

        // Record attendance on connection
        await this.companionsService.ensureAttendance(user.companionId);

        if (user.studioId) {
          this.broadcastToBridgedStudios(user.studioId, 'status:broadcast', {
            companionId: user.companionId,
            status: 'AVAILABLE',
          });
        }
      }
    } catch (err) {
      logger.error('WebSocket connection failed', { error: (err as Error).message });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    if (!user) return;
    this.userSockets.delete(user.id);
    if (!user.companionId) return;
    this.companionSockets.delete(user.companionId);
    logger.info('Companion disconnected', { companionId: user.companionId });

    await this.prisma.companion
      .update({
        where: { id: user.companionId },
        data: { status: 'OFFLINE' },
      })
      .catch((err) => {
        logger.error('Failed to update companion status on disconnect', {
          companionId: user.companionId,
          error: (err as Error).message,
        });
      });

    // Finalize attendance on disconnect
    await this.companionsService.finalizeAttendance(user.companionId);

    if (user.studioId) {
      this.broadcastToBridgedStudios(user.studioId, 'status:broadcast', {
        companionId: user.companionId,
        status: 'OFFLINE',
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

    logger.info('WS companion:status received', {
      companionId: user.companionId,
      username: user.username,
      status: data.status,
      mode: data.mode,
    });

    // Compat: map old client status values to new enum
    const STATUS_COMPAT: Record<string, string> = { ONLINE: 'AVAILABLE', IDLE: 'ENTERTAINMENT' };
    const mappedStatus = STATUS_COMPAT[data.status] || data.status;

    // Get previous status for time tracking
    const prev = await this.prisma.companion
      .findUnique({
        where: { id: user.companionId },
        select: { status: true },
      })
      .catch(() => null);
    const prevStatus = prev?.status;

    await this.prisma.companion
      .update({
        where: { id: user.companionId },
        data: { status: mappedStatus },
      })
      .then(() => {
        logger.debug('DB status updated', { companionId: user.companionId, status: data.status });
      })
      .catch((err) => {
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
      this.broadcastToBridgedStudios(user.studioId, 'status:broadcast', {
        companionId: user.companionId,
        status: mappedStatus,
        mode: data.mode,
      });
      logger.debug('Broadcast to studio', { studioId: user.studioId });
    }
  }

  @SubscribeMessage('companion:heartbeat')
  async handleHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      agentVersion?: string;
      currentMode?: string;
      workSec?: number;
      isThrottled?: boolean;
      throttleLimitKB?: number;
    },
  ): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    if (!user?.companionId) return;
    return this.heartbeatService.process(data, user);
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
      data: {
        pcId: pc.id,
        operation: data.command,
        operatorId: user.id,
        detail: JSON.stringify({ success: data.success }),
      },
    });
  }

  // ── blacklist inbound ──────────────────────────────────────────────

  @SubscribeMessage('blacklist:report')
  async handleBlacklistReport(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { processes: any[]; totalCount: number },
  ): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    return this.blacklistIngestService.processReport(user!, data);
  }

  @SubscribeMessage('blacklist:kill_result')
  async handleBlacklistKillResult(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      processName: string;
      pid: number;
      success: boolean;
      resultText?: string;
      triggeredBy?: string;
      processPath?: string;
    },
  ): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    return this.blacklistIngestService.processKillResult(user!, data);
  }

  @SubscribeMessage('blacklist:update_ack')
  async handleBlacklistUpdateAck(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { version: number },
  ): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    return this.blacklistIngestService.processUpdateAck(user!, data);
  }

  // ── outbound ───────────────────────────────────────────────────────

  sendCommand(companionId: string, command: string, params?: unknown): void {
    const socketId = this.companionSockets.get(companionId);
    if (!socketId) {
      logger.warn('SEND pc:command FAILED (offline)', { companionId, command });
      return;
    }
    logger.info('SEND pc:command', { companionId, command, params });
    this.server.to(socketId).emit('pc:command', { command, params });
  }

  pushOrder(companionId: string, order: unknown): void {
    const socketId = this.companionSockets.get(companionId);
    if (!socketId) {
      logger.warn('SEND order:new FAILED (offline)', { companionId });
      return;
    }
    logger.info('SEND order:new', { companionId, orderId: (order as any)?.id });
    this.server.to(socketId).emit('order:new', order);
  }

  broadcastToStudio(studioId: string, event: string, data: unknown): void {
    this.server.to(`studio:${studioId}`).emit(event, data);
  }

  async broadcastToBridgedStudios(studioId: string, event: string, data: unknown): Promise<void> {
    this.server.to(`studio:${studioId}`).emit(event, data);
    try {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
      for (const bridgedId of bridgedIds) {
        this.server.to(`studio:${bridgedId}`).emit(event, data);
      }
    } catch (err) {
      logger.error('broadcastToBridgedStudios failed for bridged studios', {
        error: (err as Error).message,
        studioId,
        event,
      });
    }
  }

  async broadcastToIdleCompanions(studioId: string, event: string, data: unknown): Promise<void> {
    try {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
      const studioIds = [studioId, ...bridgedIds];
      const idleCompanions = await this.prisma.companion.findMany({
        where: { studioId: { in: studioIds }, status: 'AVAILABLE' },
        select: { id: true },
      });
      for (const c of idleCompanions) {
        const socketId = this.companionSockets.get(c.id);
        if (socketId) this.server.to(socketId).emit(event, data);
      }
    } catch (err) {
      logger.error('broadcastToIdleCompanions failed', { error: (err as Error).message, studioId, event });
    }
  }

  notifyUser(userId: string, event: string, data: unknown): void {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }

  notifyChat(studioId: string, companionName: string, _chatKey: string, companionId?: string, orderId?: string): void {
    this.server.to(`studio:${studioId}`).emit('chat:notify', {
      companionName,
      companionId,
      orderId,
      timestamp: new Date().toISOString(),
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
    if (!socketId) {
      logger.warn('SEND blacklist:update FAILED (offline)', { companionId, version });
      return;
    }
    logger.info('SEND blacklist:update', {
      companionId,
      blacklistCount: blacklist.length,
      whitelistCount: whitelist.length,
      version,
    });
    this.server.to(socketId).emit('blacklist:update', { blacklist, whitelist, version });
  }

  async broadcastBlacklistToStudio(
    studioId: string,
    blacklist: { processName: string; processPath: string | null }[],
    whitelist: { processName: string; isSystem: boolean }[],
  ): Promise<void> {
    const companions = await this.prisma.companion.findMany({ where: { studioId }, select: { id: true } });
    const version = Date.now();
    let pushed = 0,
      skipped = 0;
    for (const c of companions) {
      const socketId = this.companionSockets.get(c.id);
      if (socketId) {
        this.server.to(socketId).emit('blacklist:update', { blacklist, whitelist, version });
        pushed++;
      } else {
        skipped++;
      }
    }
    logger.info('SEND blacklist:update (broadcast)', { studioId, total: companions.length, pushed, skipped, version });
  }

  // ── chat inbound / outbound ──────────────────────────────────────────

  @SubscribeMessage('chat:send')
  async handleChatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId?: string; text: string },
  ): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    if (!user?.studioId || !data.text?.trim()) return;

    logger.info('WS chat:send', { senderId: user.id, studioId: user.studioId, orderId: data.orderId });

    // Broadcast to entire studio (CS/admin/companion all in studio room)
    this.server.to(`studio:${user.studioId}`).emit('chat:new', {
      text: data.text,
      senderId: user.id,
      senderRole: user.role,
      senderName: user.username,
      orderId: data.orderId || null,
      companionId: user.companionId || null,
      timestamp: new Date().toISOString(),
    });
  }

  /** Notify studio about a new chat message (called from HTTP endpoint fallback) */
  /** Notify a specific user about a new chat message (via user room) */
  notifyNewMessage(
    userId: string,
    payload: {
      conversationId: string;
      orderInfo?: string;
      message: { id: string; senderId: string; text: string; createdAt: string };
    },
  ): void {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('chat:message', payload);
    }
  }

  notifyChatMessage(
    studioId: string,
    payload: {
      text: string;
      senderId: string;
      senderRole: string;
      senderName: string;
      orderId?: string | null;
      companionId?: string | null;
      timestamp: string;
    },
  ): void {
    this.server.to(`studio:${studioId}`).emit('chat:new', payload);
  }
}
