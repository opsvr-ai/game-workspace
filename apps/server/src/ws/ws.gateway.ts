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
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.service';
import { logger } from '../common/logger';

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
  ) {}

  // ── lifecycle ──────────────────────────────────────────────────────

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
          where: { id: user.companionId }, data: { status: 'ONLINE' },
        });

        if (user.studioId) {
          this.server.to(`studio:${user.studioId}`).emit('status:broadcast', {
            companionId: user.companionId, status: 'ONLINE',
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

    await this.prisma.companion.update({
      where: { id: user.companionId }, data: { status: data.status },
    }).then(() => {
      logger.debug('DB status updated', { companionId: user.companionId, status: data.status });
    }).catch((err) => {
      logger.error('DB status update failed', { companionId: user.companionId, error: (err as any).message });
    });

    if (user.studioId) {
      this.server.to(`studio:${user.studioId}`).emit('status:broadcast', {
        companionId: user.companionId, status: data.status, mode: data.mode,
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

    if (data.workSec && data.workSec > 0) {
      const now = new Date();
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
    console.log(`[Blacklist] Companion ${user.companionId} ack'd version ${data.version}`);
  }

  // ── outbound ───────────────────────────────────────────────────────

  sendCommand(companionId: string, command: string, params?: unknown): void {
    const socketId = this.companionSockets.get(companionId);
    if (!socketId) return;
    this.server.to(socketId).emit('pc:command', { command, params });
  }

  pushOrder(companionId: string, order: unknown): void {
    const socketId = this.companionSockets.get(companionId);
    if (!socketId) return;
    this.server.to(socketId).emit('order:new', order);
  }

  broadcastToStudio(studioId: string, event: string, data: unknown): void {
    this.server.to(`studio:${studioId}`).emit(event, data);
  }

  async broadcastToIdleCompanions(studioId: string, event: string, data: unknown): Promise<void> {
    const idleCompanions = await this.prisma.companion.findMany({ where: { studioId, status: 'ONLINE' }, select: { id: true } });
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
    if (!socketId) return;
    this.server.to(socketId).emit('blacklist:update', { blacklist, whitelist, version });
  }

  async broadcastBlacklistToStudio(
    studioId: string,
    blacklist: { processName: string; processPath: string | null }[],
    whitelist: { processName: string; isSystem: boolean }[],
  ): Promise<void> {
    const companions = await this.prisma.companion.findMany({ where: { studioId }, select: { id: true } });
    const version = Date.now();
    for (const c of companions) {
      const socketId = this.companionSockets.get(c.id);
      if (socketId) { this.server.to(socketId).emit('blacklist:update', { blacklist, whitelist, version }); }
    }
  }
}
