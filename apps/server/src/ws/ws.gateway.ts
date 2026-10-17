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
import { Inject, forwardRef, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { logger, isDebugEnabled } from '../common/logger';
import { CompanionsService } from '../companions/companions.service';
import { ExcellenceService } from '../companions/excellence.service';
import { BridgeService } from '../studios/bridge.service';
import { HeartbeatService } from './heartbeat.service';
import { BlacklistIngestService } from './blacklist-ingest.service';
import { isLanOrigin } from '../common/http-auth';
import { WsEmitterService } from './ws-emitter.service';
import { WsBlacklistService } from './ws-blacklist.service';
import { WsVoiceService } from './ws-voice.service';
import { WsConnectionService } from './ws-connection.service';
import type { ConnectedUser } from './ws-connection.service';

export type { ConnectedUser } from './ws-connection.service';

const wsAllowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:8000,http://localhost:3001').split(',');

/**
 * WebSocket 网关 —— 只保留「入口 + 公开方法委托」。
 *
 * 原来的 1,553 行拆成四层，事件名 / payload / 权限与业务判断一个字节都没改：
 *  - WsConnectionService：握手鉴权、房间编排、在线映射、断线宽限、kickUser
 *  - WsEmitterService：订单 / 通知 / 聊天等广播语义（含客户来源脱敏）
 *  - WsBlacklistService：黑名单开关缓存、名单下发、电脑识别
 *  - WsVoiceService：call:* 处理、音频限流、通话日志与断线宽限挂断
 *
 * 这里保留 @WebSocketServer server、@SubscribeMessage 入口和原有公开方法（同名委托），
 * 现有调用方（orders / auth / companions / billing / chat …）零改动。
 */
@WebSocketGateway({
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allowed?: boolean) => void) => {
      if (!origin || wsAllowedOrigins.includes(origin) || isLanOrigin(origin)) {
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

  private readonly emitter: WsEmitterService;
  private readonly blacklist: WsBlacklistService;
  private readonly voice: WsVoiceService;
  private readonly connection: WsConnectionService;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly bridgeService: BridgeService,
    @Inject(forwardRef(() => CompanionsService)) private readonly companionsService: CompanionsService,
    @Inject(forwardRef(() => ExcellenceService)) private readonly excellence: ExcellenceService,
    private readonly heartbeatService: HeartbeatService,
    private readonly blacklistIngestService: BlacklistIngestService,
    // 四个子服务在 WsModule 里注册成 provider，由 Nest 注入；
    // 单测里直接 `new WsGateway(7 个旧参数)` 时兜底自建，保持老测试零改动。
    @Optional() emitterService?: WsEmitterService,
    @Optional() blacklistService?: WsBlacklistService,
    @Optional() voiceService?: WsVoiceService,
    @Optional() connectionService?: WsConnectionService,
  ) {
    this.emitter = emitterService ?? new WsEmitterService(this.prisma, this.bridgeService, this.excellence);
    this.blacklist = blacklistService ?? new WsBlacklistService(this.prisma);
    this.voice = voiceService ?? new WsVoiceService(this.prisma);
    this.connection =
      connectionService ?? new WsConnectionService(this.jwt, this.prisma, this.bridgeService, this.companionsService);

    // @WebSocketServer server 要等 Nest 完成注入才有值（单测里是构造后手动挂），
    // 所以子服务拿的是取址回调，而不是构造期的 server 实例。
    const getServer = () => this.server;
    const notifyUser = (userId: string, event: string, data: unknown) => this.notifyUser(userId, event, data);
    const notifyCompanion = (companionId: string, event: string, data: unknown) =>
      this.notifyCompanion(companionId, event, data);
    this.emitter.attach({
      getServer,
      notifyUser,
      notifyCompanion,
      isCompanionConnected: (companionId) => this.isCompanionConnected(companionId),
    });
    this.voice.attach({ notifyUser });
    this.blacklist.attach({ getServer });
    this.connection.attach({ getServer, emitter: this.emitter, blacklist: this.blacklist, voice: this.voice });
  }

  // ── lifecycle ──────────────────────────────────────────────────────

  afterInit(): void {
    // 全量事件日志只在 debug 打开时才挂：以前生产上每条消息都要拦一次、
    // 还要 JSON.stringify 一遍再丢掉，聊天一多就是白烧 CPU。
    if (!isDebugEnabled) return;
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

  /** 把某个用户现有的所有连接踢掉（老板 2026-10-01，见 WsConnectionService.kickUser）。 */
  kickUser(userId: string): number {
    return this.connection.kickUser(userId);
  }

  async handleConnection(client: Socket): Promise<void> {
    return this.connection.handleConnection(client);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    return this.connection.handleDisconnect(client);
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

    // 接单状态只能由开始服务自动进入，不能手动点，防止借“接单”状态玩黑名单游戏。
    if (mappedStatus === 'BUSY') {
      logger.warn('Ignored manual BUSY status', {
        companionId: user.companionId,
        username: user.username,
      });
      return;
    }

    // 服务进行中（有已开始的会话）不允许被客户端切成空闲/娱乐/休息等状态，防止状态被误刷成空闲。
    if (mappedStatus !== 'BUSY') {
      const activeSession = await this.prisma.orderSession.findFirst({
        where: {
          OR: [{ companionId: user.companionId }, { coCompanionId: user.companionId }],
          status: 'ACTIVE',
          startedAt: { not: null },
        },
        select: { id: true },
      }).catch(() => null);
      if (activeSession) {
        logger.warn('Ignored companion:status while in service', {
          companionId: user.companionId,
          username: user.username,
          requestedStatus: mappedStatus,
        });
        return;
      }
    }

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

    // 同步「当前模式」与状态，避免出现状态是空闲、模式还显示娱乐
    await this.prisma.companionPC.update({
      where: { companionId: user.companionId },
      data: { currentMode: mappedStatus },
    }).catch(() => {});

    // 状态变化后推送新状态对应的黑名单，避免客户端停留在旧状态的黑名单列表。
    // 这是陪玩本人开的状态，属于权威状态，可以下发。
    await this.pushCurrentBlacklist(user.companionId, user.studioId, true);

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

  // ── outbound（事件语义层委托，见 WsEmitterService）────────────────

  sendCommand(companionId: string, command: string, params?: unknown): boolean {
    return this.emitter.sendCommand(companionId, command, params);
  }

  pushOrder(companionId: string, order: unknown): void {
    this.emitter.pushOrder(companionId, order);
  }

  pushToCompanion(companionId: string, event: string, data: unknown): void {
    this.emitter.pushToCompanion(companionId, event, data);
  }

  broadcastToStudio(studioId: string, event: string, data: unknown): void {
    this.emitter.broadcastToStudio(studioId, event, data);
  }

  async broadcastToBridgedStudios(studioId: string, event: string, data: unknown): Promise<void> {
    return this.emitter.broadcastToBridgedStudios(studioId, event, data);
  }

  async broadcastNewOrder(studioId: string, data: unknown): Promise<number> {
    return this.emitter.broadcastNewOrder(studioId, data);
  }

  async broadcastToQualifiedIdleCompanions(studioId: string, event: string, data: unknown): Promise<number> {
    return this.emitter.broadcastToQualifiedIdleCompanions(studioId, event, data);
  }

  async broadcastToBridgedIdleCompanions(studioId: string, event: string, data: unknown): Promise<number> {
    return this.emitter.broadcastToBridgedIdleCompanions(studioId, event, data);
  }

  async broadcastToBridgedIdleCompanionsByType(
    studioId: string,
    studioType: 'DIRECT' | 'RENTAL',
    event: string,
    data: unknown,
  ): Promise<number> {
    return this.emitter.broadcastToBridgedIdleCompanionsByType(studioId, studioType, event, data);
  }

  async broadcastUrgentToBridgedStudios(
    studioId: string,
    orderId: string,
    data: unknown,
    delayMs: number,
  ): Promise<number> {
    return this.emitter.broadcastUrgentToBridgedStudios(studioId, orderId, data, delayMs);
  }

  notifyUser(userId: string, event: string, data: unknown): void {
    this.emitter.notifyUser(userId, event, data);
  }

  notifyCompanion(companionId: string, event: string, data: unknown): void {
    this.emitter.notifyCompanion(companionId, event, data);
  }

  /** 这个陪玩的客户端现在有没有连着。 */
  isCompanionConnected(companionId: string): boolean {
    return this.connection.isCompanionConnected(companionId);
  }

  async notifyStudioManagers(
    studioId: string | null | undefined,
    event: string,
    data: unknown,
  ): Promise<void> {
    return this.emitter.notifyStudioManagers(studioId, event, data);
  }

  /** 通用「审核 / 交互」提醒 —— 管理端一侧（本店客服 / 店长 + 全站老板）。 */
  notifyManagers(studioId: string | null | undefined, payload: Record<string, any>): void {
    this.emitter.notifyManagers(studioId, payload);
  }

  /** 通用「审核 / 交互」提醒 —— 陪玩本人一侧（我提交的东西有结果了）。 */
  notifyCompanionNotice(companionId: string, payload: Record<string, any>): void {
    this.emitter.notifyCompanionNotice(companionId, payload);
  }

  // ── 语音通话（见 WsVoiceService）───────────────────────────────────

  @SubscribeMessage('call:offer')
  async handleCallOffer(@ConnectedSocket() client: Socket, @MessageBody() data: any): Promise<void> {
    return this.voice.handleCallOffer(client, data);
  }

  @SubscribeMessage('call:answer')
  async handleCallAnswer(@ConnectedSocket() client: Socket, @MessageBody() data: any): Promise<void> {
    return this.voice.handleCallAnswer(client, data);
  }

  /** 音频帧转发：只允许发给本通话的对端，单帧 ≤ 8KB，每秒 ≤ 100 帧。 */
  @SubscribeMessage('call:audio')
  handleCallAudio(@ConnectedSocket() client: Socket, @MessageBody() data: any): void {
    this.voice.handleCallAudio(client, data);
  }

  @SubscribeMessage('call:ice-candidate')
  async handleCallIce(@ConnectedSocket() _client: Socket, @MessageBody() data: any): Promise<void> {
    return this.voice.handleCallIce(data);
  }

  @SubscribeMessage('call:hangup')
  async handleCallHangup(@ConnectedSocket() client: Socket, @MessageBody() data: any): Promise<void> {
    return this.voice.handleCallHangup(client, data);
  }

  notifyChat(studioId: string, companionName: string, _chatKey: string, companionId?: string, orderId?: string): void {
    this.emitter.notifyChat(studioId, companionName, _chatKey, companionId, orderId);
  }

  // ── blacklist outbound（见 WsBlacklistService）────────────────────

  async isStudioBlacklistEnabled(studioId: string | null | undefined): Promise<boolean> {
    return this.blacklist.isStudioBlacklistEnabled(studioId);
  }

  /** 开关刚改完时调用，避免还把旧值缓存最长 5 秒。 */
  invalidateBlacklistSwitchCache(): void {
    this.blacklist.invalidateBlacklistSwitchCache();
  }

  async getCompanionBlacklistOverrides(studioId: string): Promise<Record<string, boolean>> {
    return this.blacklist.getCompanionBlacklistOverrides(studioId);
  }

  /**
   * **这个陪玩**到底动不动手：本店开关 + 按人特批合成。
   * 没被特批的人 = 跟随本店开关（老行为，一个字节都不变）。
   */
  async isCompanionBlacklistEnabled(
    companionId: string | null | undefined,
    studioId: string | null | undefined,
  ): Promise<boolean> {
    return this.blacklist.isCompanionBlacklistEnabled(companionId, studioId);
  }

  async sendBlacklistUpdate(
    companionId: string,
    blacklist: { processName: string; processPath: string | null }[],
    whitelist: { processName: string; isSystem: boolean }[],
    version: number,
    status?: string,
    authoritative = false,
    studioId?: string | null,
  ): Promise<void> {
    return this.blacklist.sendBlacklistUpdate(
      companionId,
      blacklist,
      whitelist,
      version,
      status,
      authoritative,
      studioId,
    );
  }

  async broadcastBlacklistToStudio(
    studioId: string,
    blacklist: { processName: string; processPath: string | null }[],
    whitelist: { processName: string; isSystem: boolean }[],
  ): Promise<void> {
    return this.blacklist.broadcastBlacklistToStudio(studioId, blacklist, whitelist);
  }

  async pushCurrentBlacklist(companionId: string, studioId: string | null, authoritative = false): Promise<void> {
    return this.blacklist.pushCurrentBlacklist(companionId, studioId, authoritative);
  }

  /** 服务端把陪玩状态切回空闲等状态后，重推一次黑名单，让客户端恢复杀进程。 */
  async refreshCompanionBlacklist(companionId: string): Promise<void> {
    return this.blacklist.refreshCompanionBlacklist(companionId);
  }

  /** 陪玩端连接时，优先按 MAC / 登录账号识别电脑，不靠 IP（IP 会变）。 */
  async syncManagedPc(address: string, username: string): Promise<void> {
    return this.blacklist.syncManagedPc(address, username);
  }

  // ── chat inbound / outbound ─────────────────────────────────────────

  @SubscribeMessage('chat:send')
  async handleChatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId?: string; text: string },
  ): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    if (!user?.studioId || !data.text?.trim()) return;

    logger.info('WS chat:send', { senderId: user.id, studioId: user.studioId, orderId: data.orderId });

    // Broadcast to entire studio (CS/admin/companion all in studio room)
    this.notifyChatMessage(user.studioId, {
      text: data.text,
      senderId: user.id,
      senderRole: user.role,
      senderName: user.username,
      orderId: data.orderId || null,
      companionId: user.companionId || null,
      timestamp: new Date().toISOString(),
    });
  }

  /** Notify a specific user about a new chat message (via user room) */
  notifyNewMessage(
    userId: string,
    payload: {
      conversationId: string;
      orderInfo?: string;
      message: { id: string; senderId: string; text: string; createdAt: string };
    },
  ): void {
    this.emitter.notifyNewMessage(userId, payload);
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
    this.emitter.notifyChatMessage(studioId, payload);
  }
}
