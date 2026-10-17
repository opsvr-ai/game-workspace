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
import type { HeartbeatData } from './heartbeat.service';
import { BlacklistIngestService } from './blacklist-ingest.service';
import type { KillResultData } from './blacklist-ingest.service';
import { isLanOrigin } from '../common/http-auth';
import { WsEmitterService } from './ws-emitter.service';
import type { NewMessagePayload, StudioChatPayload } from './ws-emitter.service';
import { WsBlacklistService } from './ws-blacklist.service';
import type { BlacklistEntry, WhitelistEntry } from './ws-blacklist.service';
import { WsVoiceService } from './ws-voice.service';
import { WsConnectionService } from './ws-connection.service';
import { WsStatusService } from './ws-status.service';
import { WsCommandService } from './ws-command.service';
import type { ConnectedUser } from './ws-connection.service';

export type { ConnectedUser } from './ws-connection.service';

const wsAllowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:8000,http://localhost:3001').split(',');

/**
 * WebSocket 网关 —— 只保留「@WebSocketServer + @SubscribeMessage 入口 + 公开方法委托」。
 *
 * 业务分层（事件名 / payload / 权限与业务判断与原 1,553 行版本逐字一致）：
 * WsConnectionService 握手/房间/在线/断线宽限；WsEmitterService 订单与通知广播（含 chat:send）；
 * WsStatusService companion:status 权限与计时日志；WsCommandService pc:command_ack 回执；
 * WsBlacklistService 黑名单开关与下发；WsVoiceService call:* 与音频限流。
 * 现有调用方（orders / auth / companions / billing / chat …）零改动。
 */
@WebSocketGateway({
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allowed?: boolean) => void) => {
      if (!origin || wsAllowedOrigins.includes(origin) || isLanOrigin(origin)) callback(null, true);
      else callback(new Error('Not allowed by CORS'));
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
  private readonly status: WsStatusService;
  private readonly command: WsCommandService;

  constructor(
    jwt: JwtService,
    prisma: PrismaService,
    bridgeService: BridgeService,
    @Inject(forwardRef(() => CompanionsService)) companionsService: CompanionsService,
    @Inject(forwardRef(() => ExcellenceService)) excellence: ExcellenceService,
    private readonly heartbeatService: HeartbeatService,
    private readonly blacklistIngestService: BlacklistIngestService,
    // 子服务在 WsModule 注册成 provider 由 Nest 注入；单测直接 new WsGateway(旧 7 参数) 时兜底自建。
    @Optional() emitterService?: WsEmitterService,
    @Optional() blacklistService?: WsBlacklistService,
    @Optional() voiceService?: WsVoiceService,
    @Optional() connectionService?: WsConnectionService,
    @Optional() statusService?: WsStatusService,
    @Optional() commandService?: WsCommandService,
  ) {
    this.emitter = emitterService ?? new WsEmitterService(prisma, bridgeService, excellence);
    this.blacklist = blacklistService ?? new WsBlacklistService(prisma);
    this.voice = voiceService ?? new WsVoiceService(prisma);
    this.connection = connectionService ?? new WsConnectionService(jwt, prisma, bridgeService, companionsService);
    this.status = statusService ?? new WsStatusService(prisma, this.emitter, this.blacklist);
    this.command = commandService ?? new WsCommandService(prisma);

    // 构造期先挂一次（单测直接 new 的场景立刻可用）。
    this.attachRuntimes();
  }

  /**
   * 把「网关才知道的东西」（server 取址、emit 回调）挂到子服务上。
   *
   * 为什么要挂两次（构造 + afterInit）：
   * 这些服务里有几个是通过 `@Inject(forwardRef(...))` 解析的（WsModule ↔ CompanionsModule 循环）。
   * Nest 10 的 Injector 在 forwardRef 场景下会先给一个**占位实例**，等真正实例化后再
   * `Object.assign(占位实例, new Service(...))` 合并进来 —— 新实例的类字段（`runtime = null`）
   * 会把构造期挂好的 runtime **覆盖成 null**。线上 2026-10-17 就是这么炸的：
   * 服务能启动，但第一个 WebSocket 连接/断开就 `WsConnectionService runtime not attached`。
   * `afterInit()` 在所有 provider 合并完成之后才调用，这里再挂一次即恢复；两个 attach 都是幂等的。
   */
  private attachRuntimes(): void {
    // @WebSocketServer server 要等 Nest 完成注入才有值（单测是构造后手动挂），
    // 所以子服务拿的是取址回调，而不是构造期的 server 实例。
    const getServer = () => this.server;
    const notifyUser = (userId: string, event: string, data: unknown) => this.notifyUser(userId, event, data);
    this.emitter.attach({
      getServer,
      notifyUser,
      notifyCompanion: (companionId, event, data) => this.notifyCompanion(companionId, event, data),
      isCompanionConnected: (companionId) => this.isCompanionConnected(companionId),
    });
    this.voice.attach({ notifyUser });
    this.blacklist.attach({ getServer });
    this.connection.attach({ getServer, emitter: this.emitter, blacklist: this.blacklist, voice: this.voice });
  }

  // ── lifecycle ──────────────────────────────────────────────────────

  afterInit(): void {
    // forwardRef 占位实例合并后，类字段可能把构造期 attach 的 runtime 覆盖掉 —— 重新挂一次。
    this.attachRuntimes();
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

  // ── inbound（@SubscribeMessage 入口，业务在对应 service）───────────

  @SubscribeMessage('companion:status')
  async handleStatusChange(@ConnectedSocket() client: Socket, @MessageBody() data: { status: string; mode?: string }): Promise<void> {
    return this.status.handleStatusChange(client.data.user as ConnectedUser | undefined, data);
  }

  @SubscribeMessage('companion:heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: Socket, @MessageBody() data: HeartbeatData): Promise<void> {
    const user = client.data.user as ConnectedUser | undefined;
    if (!user?.companionId) return;
    return this.heartbeatService.process(data, user);
  }

  @SubscribeMessage('pc:command_ack')
  async handleCommandAck(@ConnectedSocket() client: Socket, @MessageBody() data: { command: string; success: boolean }): Promise<void> {
    return this.command.handleCommandAck(client.data.user as ConnectedUser | undefined, data);
  }

  @SubscribeMessage('blacklist:report')
  async handleBlacklistReport(@ConnectedSocket() client: Socket, @MessageBody() data: { processes: any[]; totalCount: number }): Promise<void> {
    return this.blacklistIngestService.processReport(client.data.user as ConnectedUser, data);
  }

  @SubscribeMessage('blacklist:kill_result')
  async handleBlacklistKillResult(@ConnectedSocket() client: Socket, @MessageBody() data: KillResultData): Promise<void> {
    return this.blacklistIngestService.processKillResult(client.data.user as ConnectedUser, data);
  }

  @SubscribeMessage('blacklist:update_ack')
  async handleBlacklistUpdateAck(@ConnectedSocket() client: Socket, @MessageBody() data: { version: number }): Promise<void> {
    return this.blacklistIngestService.processUpdateAck(client.data.user as ConnectedUser, data);
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

  async notifyStudioManagers(studioId: string | null | undefined, event: string, data: unknown): Promise<void> {
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

  /** **这个陪玩**到底动不动手：本店开关 + 按人特批合成（没被特批 = 跟随本店开关）。 */
  async isCompanionBlacklistEnabled(companionId: string | null | undefined, studioId: string | null | undefined): Promise<boolean> {
    return this.blacklist.isCompanionBlacklistEnabled(companionId, studioId);
  }

  async sendBlacklistUpdate(companionId: string, blacklist: BlacklistEntry[], whitelist: WhitelistEntry[],
    version: number, status?: string, authoritative = false, studioId?: string | null): Promise<void> {
    return this.blacklist.sendBlacklistUpdate(companionId, blacklist, whitelist, version, status, authoritative, studioId);
  }

  async broadcastBlacklistToStudio(studioId: string, blacklist: BlacklistEntry[], whitelist: WhitelistEntry[]): Promise<void> {
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

  // ── chat inbound / outbound（见 WsEmitterService）──────────────────

  @SubscribeMessage('chat:send')
  async handleChatSend(@ConnectedSocket() client: Socket, @MessageBody() data: { orderId?: string; text: string }): Promise<void> {
    this.emitter.handleChatSend(client.data.user as ConnectedUser | undefined, data);
  }

  /** Notify a specific user about a new chat message (via user room) */
  notifyNewMessage(userId: string, payload: NewMessagePayload): void {
    this.emitter.notifyNewMessage(userId, payload);
  }

  notifyChatMessage(studioId: string, payload: StudioChatPayload): void {
    this.emitter.notifyChatMessage(studioId, payload);
  }
}
