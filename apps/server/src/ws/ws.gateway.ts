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
import { logger, isDebugEnabled } from '../common/logger';
import { presence } from '../common/presence';
import * as fs from 'fs';
import { CompanionsService } from '../companions/companions.service';
import { ExcellenceService } from '../companions/excellence.service';
import { BridgeService } from '../studios/bridge.service';
import { HeartbeatService } from './heartbeat.service';
import { BlacklistIngestService } from './blacklist-ingest.service';
import { isLanOrigin } from '../common/http-auth';

export interface ConnectedUser {
  id: string;
  username: string;
  role: string;
  studioId: string | null;
  companionId?: string;
}

const wsAllowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:8000,http://localhost:3001').split(',');

/** 语音通话中断线宽限期：比客户端自己的 30 秒稍长，让客户端先有机会重连上。 */
const VOICE_RECONNECT_GRACE_MS = 45_000;

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

  /** companionId -> socketId */
  private companionSockets = new Map<string, Set<string>>();
  /** 断开后「延迟置离线」的定时器：companionId -> timer */
  private pendingOfflineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 置离线宽限期缓存（避免每次断开都查一次配置） */
  private offlineGraceCache: { seconds: number; at: number } | null = null;
  /** userId -> socketId */
  private userSockets = new Map<string, string>();

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly bridgeService: BridgeService,
    @Inject(forwardRef(() => CompanionsService)) private readonly companionsService: CompanionsService,
    @Inject(forwardRef(() => ExcellenceService)) private readonly excellence: ExcellenceService,
    private readonly heartbeatService: HeartbeatService,
    private readonly blacklistIngestService: BlacklistIngestService,
  ) {}

  /**
   * 老板 2026-09-20 报「日志里每天几十次 WebSocket invalid signature，失败期间收不到弹窗」。
   * 根因：accessToken 只有 15 分钟寿命，陪玩端（特别是主进程那条连接）过了 15 分钟
   * 还在拿旧令牌重连，握手被拒 → 弹窗链路直接断掉，只能等 15 秒轮询。
   * 处理：令牌只要确实是本服务器签发的、仅仅是过期，就按宽限期放进来，
   * HTTP 接口依旧严格按 15 分钟校验（这里只放宽「服务端主动推送」这条通道），
   * 同时推 auth:stale_token 提醒客户端去换新令牌。
   * 宽限期可在系统设置里改：ws.token_grace_hours，默认 168 小时（7 天）。
   */
  private async acceptExpiredOwnToken(
    token: string,
  ): Promise<{
    payload: JwtPayload;
    expiredAt: Date;
    kind: 'access' | 'refresh';
    /** 只是「过期但仍放行」才需要提示客户端换令牌；没过期的是正常连接 */
    expired: boolean;
  } | null> {
    // 不看具体的报错类型：accessToken 过期报 TokenExpiredError，
    // refreshToken（另一把密钥）过期会先报 invalid signature —— 两种情况都是
    // 「本服务器签发、只是过期」，一并按宽限期处理。
    let payload: JwtPayload | null = null;
    let kind: 'access' | 'refresh' = 'access';
    try {
      payload = this.jwt.verify<JwtPayload>(token, {
        secret: process.env.JWT_SECRET,
        ignoreExpiration: true,
      });
    } catch {
      kind = 'refresh';
      try {
        payload = this.jwt.verify<JwtPayload>(token, {
          secret: process.env.JWT_REFRESH_SECRET,
          ignoreExpiration: true,
        });
      } catch {
        // 两个密钥都验不过 = 不是本服务器签发的，走原来的失败流程
        return null;
      }
    }
    const exp = Number((payload as any)?.exp);
    if (!Number.isFinite(exp)) return null;
    const expiredAt = new Date(exp * 1000);
    const age = Date.now() - expiredAt.getTime();
    // 还没过期：这是正常连接（典型场景＝主进程拿 7 天有效的 refreshToken 连），
    // 原样放行、不用提示换令牌。
    if (age <= 0) return { payload, expiredAt, kind, expired: false };
    const graceHours = await this.tokenGraceHours();
    if (graceHours <= 0) return null;
    if (age > graceHours * 3600 * 1000) return null;
    return { payload, expiredAt, kind, expired: true };
  }

  private async tokenGraceHours(): Promise<number> {
    const cfg = await this.prisma.systemConfig
      .findUnique({ where: { key: 'ws.token_grace_hours' } })
      .catch(() => null);
    const raw = cfg?.value as unknown;
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(value) ? value : 168;
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

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = (client.handshake.auth?.token || client.handshake.query?.token) as string | undefined;
      if (!token) {
        client.disconnect(true);
        return;
      }

      // 客户端主进程可能用 accessToken 或 refreshToken 连接（两者签名密钥不同）
      let payload: JwtPayload;
      let staleToken: { expiredAt: Date; kind: 'access' | 'refresh' } | null = null;
      // 记录这条连接用的是哪种令牌（access=网页 / refresh=陪玩端主进程），
      // 排查「谁在反复掉线」时能一眼看出是哪条连接在抖。
      let tokenKind: 'access' | 'refresh' = 'access';
      try {
        payload = this.jwt.verify<JwtPayload>(token, { secret: process.env.JWT_SECRET });
      } catch (accessErr) {
        // 先看是不是「我们自己签发、只是过期了」：是就按宽限期放行，
        // 否则再试 refreshToken，最后才判定为非法令牌。
        const stale = await this.acceptExpiredOwnToken(token);
        if (stale) {
          payload = stale.payload;
          tokenKind = stale.kind;
          if (stale.expired) {
            staleToken = { expiredAt: stale.expiredAt, kind: stale.kind };
          }
        } else {
        try {
          const refreshed = this.jwt.verify<JwtPayload>(token, { secret: process.env.JWT_REFRESH_SECRET });
          payload = refreshed;
          tokenKind = 'refresh';
        } catch (refreshErr) {
          // 两个密钥都验不过 = 这个令牌不是这台服务器签发的。
          // 老板 2026-09-20 报「日志里每天几十次 invalid signature」：
          // 之前只记了一句 message，看不出是谁、什么时候签的，没法定位是哪台机器。
          // 现在把令牌里的身份和时间一起记下来（不记令牌本体），并明确告诉客户端去换令牌。
          let info: any = {};
          try {
            info = this.jwt.decode(token) || {};
          } catch {
            /* 令牌格式都解析不了 */
          }
          logger.error('WebSocket auth failed', {
            accessError: (accessErr as Error).message,
            refreshError: (refreshErr as Error).message,
            username: info?.username,
            role: info?.role,
            userId: info?.sub,
            issuedAt: info?.iat ? new Date(info.iat * 1000).toISOString() : null,
            expiresAt: info?.exp ? new Date(info.exp * 1000).toISOString() : null,
            address: client.handshake?.address,
          });
          client.emit('auth:failed', { reason: (accessErr as Error).message });
          // 先把「你去换令牌」这句话发出去再断开，否则客户端只看到自己被踢，
          // 不知道为什么，也不知道要做什么。
          setTimeout(() => client.disconnect(true), 200);
          return;
        }
        }
      }

      if (staleToken) {
        logger.warn('WebSocket accepted with expired token (within grace)', {
          username: (payload as any)?.username,
          userId: (payload as any)?.sub,
          tokenKind: staleToken.kind,
          expiredAt: staleToken.expiredAt.toISOString(),
          address: client.handshake?.address,
        });
        // 告诉客户端去换新令牌，下一次重连就恢复正常
        client.emit('auth:stale_token', {
          tokenKind: staleToken.kind,
          expiredAt: staleToken.expiredAt.toISOString(),
        });
      }

      const user: ConnectedUser = {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
        studioId: payload.studioId,
        companionId: payload.companionId,
      };
      client.data.user = user;
      client.data.tokenKind = tokenKind;
      client.data.transport = client.conn?.transport?.name ?? 'unknown';
      // 客户端连接活着 = 这个人现在在线（不管窗口有没有最小化）。
      presence.addSocket(user.id);
      // 以前只记陪玩的连接/断开，客服、店长、老板的连接完全没日志，
      // 老板一报「谁又掉线了」就只能拿时间猜。现在所有角色都记一条。
      if (!user.companionId) {
        logger.info('Socket connected', {
          userId: user.id,
          username: user.username,
          role: user.role,
          tokenKind,
          transport: client.data.transport,
          address: client.handshake?.address,
        });
      }

      const pendingCallEnd = this.pendingCallEndTimers.get(user.id);
      if (pendingCallEnd) {
        clearTimeout(pendingCallEnd);
        this.pendingCallEndTimers.delete(user.id);
        const session = this.callSessions.get(user.id);
        if (session) {
          logger.info('Voice call survived reconnect', {
            userId: user.id,
            username: user.username,
            peerUserId: session.peerId,
          });
          this.notifyUser(session.peerId, 'call:peer-stable', { peerUserId: user.id });
        }
      }

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
        if (!this.companionSockets.has(user.companionId)) {
          this.companionSockets.set(user.companionId, new Set());
        }
        this.companionSockets.get(user.companionId)!.add(client.id);
        // 刚刚那次断开只是刷新页面 / 网络抖一下 / 服务端发版重启？连回来就把
        // 「置离线」的定时器撤掉，状态保持原样，控制台里不会闪一下「掉线」。
        if (this.cancelPendingOfflineTransition(user.companionId)) {
          logger.info('Companion reconnected within grace, offline transition cancelled', {
            companionId: user.companionId,
          });
        }
        logger.debug('Companion connected', { companionId: user.companionId, username: user.username });
        void this.pushCurrentBlacklist(user.companionId, user.studioId);
        void this.syncManagedPc(client.handshake?.address, user.username);

        // 重连补发未处理的搭档邀请，避免发送时客户端恰好断线导致收不到。
        const pendingInvite = await this.prisma.orderSession.findFirst({
          where: {
            coCompanionId: user.companionId,
            status: 'ACTIVE',
            startedAt: null,
            createdAt: { gte: new Date(Date.now() - 60 * 1000) },
          },
          include: {
            parentOrder: { select: { id: true, gameName: true, customerId: true, companionId: true } },
            companion: { select: { user: { select: { displayName: true, username: true } } } },
          },
          orderBy: { createdAt: 'desc' },
        }).catch(() => null);
        if (pendingInvite) {
          this.pushOrder(user.companionId, {
            ...pendingInvite,
            orderId: pendingInvite.parentOrder?.id,
            gameName: pendingInvite.parentOrder?.gameName,
            customerId: pendingInvite.parentOrder?.customerId,
            companionId: pendingInvite.companionId,
            inviterName: pendingInvite.companion?.user?.displayName || pendingInvite.companion?.user?.username || '',
            type: 'DUAL_INVITE',
            expiresInSec: 60,
          });
        }

        const current = await this.prisma.companion
          .findUnique({ where: { id: user.companionId }, select: { status: true } })
          .catch(() => null);
        const nextStatus = await this.companionsService.resolvePresenceStatus(
          user.companionId,
          current?.status,
        );
        await this.prisma.companion.update({
          where: { id: user.companionId },
          data: { status: nextStatus },
        });

        // 这里不再补推黑名单：连接时的状态只是按「在线 = 空闲」猜出来的，
        // 而上面一步已经推过一次。猜出来的状态不能发给客户端，
        // 否则会把正在「娱乐中」打游戏的陪玩当成空闲处理（随即误杀游戏进程）。

        // Record attendance on connection
        await this.companionsService.ensureAttendance(user.companionId);

        if (user.studioId) {
          this.broadcastToBridgedStudios(user.studioId, 'status:broadcast', {
            companionId: user.companionId,
            status: nextStatus,
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
    presence.removeSocket(user.id);
    // 同一客户端可能有好几条连接（网页 + 陪玩端主进程），只有一条都不剩才算真的走了，
    // 不然主进程那条连接一抖就把正在进行的语音通话掐断。
    if (!presence.hasSocket(user.id)) {
      this.scheduleCallEndOnDisconnect(user);
    }
    this.userSockets.delete(user.id);
    if (!user.companionId) {
      // 客服 / 店长 / 老板 的断开以前一条日志都没有，只能靠人员列表「离线」反推。
      logger.info('Socket disconnected', {
        userId: user.id,
        username: user.username,
        role: user.role,
        tokenKind: (client.data as any).tokenKind,
        transport: (client.data as any).transport,
        address: client.handshake?.address,
        stillConnected: presence.hasSocket(user.id),
      });
      return;
    }
    const sockets = this.companionSockets.get(user.companionId);
    if (sockets) {
      sockets.delete(client.id);
      if (sockets.size === 0) {
        this.companionSockets.delete(user.companionId);
      } else {
        // 还有别的连接（主进程 / 页面），状态先不动
        logger.info('Companion partial disconnect', {
          companionId: user.companionId,
          remaining: sockets.size,
          tokenKind: (client.data as any).tokenKind,
          transport: (client.data as any).transport,
          address: client.handshake?.address,
        });
        return;
      }
    }
    logger.info('Companion disconnected', {
      companionId: user.companionId,
      tokenKind: (client.data as any).tokenKind,
      transport: (client.data as any).transport,
      address: client.handshake?.address,
    });

    // 老板 2026-09-21 报「软件动不动就掉线」：客户端刷新页面、网络抖一下、或者服务端
    // 发版重启，都会把连接断掉几秒——以前这里立刻把人置成 OFFLINE，控制台里就闪一下
    // 「掉线」。现在改成「宽限期内连回来 = 没掉过线」，超过宽限期（默认 60 秒，
    // 系统设置里可改 ws.offline_grace_seconds）才真的置离线。
    await this.scheduleOfflineTransition(user.companionId, user.studioId || undefined);
  }

  /**
   * 宽限期内连回来了 → 撤掉「置离线」定时器，返回 true。
   * 这样刷新页面 / 网络抖动 / 服务端发版重启都不会在控制台里闪出「掉线」。
   */
  private cancelPendingOfflineTransition(companionId: string): boolean {
    const pending = this.pendingOfflineTimers.get(companionId);
    if (!pending) return false;
    clearTimeout(pending);
    this.pendingOfflineTimers.delete(companionId);
    return true;
  }

  /** 安排「延迟置离线」；重复断开只保留最后一个定时器 */
  private async scheduleOfflineTransition(companionId: string, studioId?: string): Promise<void> {
    const existing = this.pendingOfflineTimers.get(companionId);
    if (existing) clearTimeout(existing);
    const graceMs = await this.offlineGraceMs();
    if (graceMs <= 0) {
      await this.applyOfflineTransition(companionId, studioId);
      return;
    }
    const timer = setTimeout(() => {
      this.pendingOfflineTimers.delete(companionId);
      void this.applyOfflineTransition(companionId, studioId);
    }, graceMs);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();
    this.pendingOfflineTimers.set(companionId, timer);
  }

  /** 宽限期到点、且确实还没连回来 → 置离线（有服务在身则保持忙碌） */
  private async applyOfflineTransition(companionId: string, studioId?: string): Promise<void> {
    if (this.companionSockets.get(companionId)?.size) return;
    const inService = await this.companionsService.hasActiveServiceSession(companionId).catch(() => false);
    const disconnectStatus = inService ? 'BUSY' : 'OFFLINE';
    await this.prisma.companion
      .update({ where: { id: companionId }, data: { status: disconnectStatus } })
      .catch((err) => {
        logger.error('Failed to update companion status on disconnect', {
          companionId,
          error: (err as Error).message,
        });
      });

    // Finalize attendance on disconnect
    await this.companionsService.finalizeAttendance(companionId);
    logger.info('Companion marked offline after grace', {
      companionId,
      status: disconnectStatus,
    });

    if (studioId) {
      this.broadcastToBridgedStudios(studioId, 'status:broadcast', {
        companionId,
        status: disconnectStatus,
      });
    }
  }

  /** 置离线宽限期（秒）：配置 ws.offline_grace_seconds，默认 60，结果缓存 60 秒 */
  private async offlineGraceMs(): Promise<number> {
    const now = Date.now();
    if (this.offlineGraceCache && now - this.offlineGraceCache.at < 60_000) {
      return this.offlineGraceCache.seconds * 1000;
    }
    const cfg = await this.prisma.systemConfig
      .findUnique({ where: { key: 'ws.offline_grace_seconds' } })
      .catch(() => null);
    const raw = cfg?.value as unknown;
    const value = typeof raw === 'number' ? raw : Number(raw);
    const seconds = Number.isFinite(value) ? Math.max(0, value) : 60;
    this.offlineGraceCache = { seconds, at: now };
    return seconds * 1000;
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

  // ── outbound ───────────────────────────────────────────────────────

  sendCommand(companionId: string, command: string, params?: unknown): boolean {
    const sockets = this.companionSockets.get(companionId);
    if (!sockets || sockets.size === 0) {
      logger.warn('SEND pc:command FAILED (offline)', { companionId, command });
      return false;
    }
    logger.debug('SEND pc:command', { companionId, command, params });
    // 客户端主进程目前按平铺字段处理，例如 update 需要 { command, downloadUrl, version }，
    // 因此这里不能包在 params 里，否则旧客户端收不到 downloadUrl。
    const payload: any = { command };
    if (params && typeof params === 'object') {
      Object.assign(payload, params);
    }
    this.server.to(`companion:${companionId}`).emit('pc:command', payload);
    return true;
  }

  pushOrder(companionId: string, order: unknown): void {
    logger.info('SEND order:new', { companionId, orderId: (order as any)?.id });
    this.server.to(`companion:${companionId}`).emit('order:new', order);
  }

  pushToCompanion(companionId: string, event: string, data: unknown): void {
    this.server.to(`companion:${companionId}`).emit(event, data);
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

  /**
   * 广播新单（右下角弹窗抢单）。
   *
   * 老板 2026-09-20：空闲的必推；接单中 / 娱乐中默认不打扰，
   * 只有本人打开「打单/娱乐时也接收新单弹窗」才推给他（见 Companion.notifyWhileBusy）。
   * 返回实际推送人数，方便排查「为什么没人收到」。
   */
  async broadcastNewOrder(studioId: string, data: unknown): Promise<number> {
    try {
      const companions = await this.prisma.companion.findMany({
        where: {
          studioId,
          OR: [
            { status: 'AVAILABLE' },
            { status: { in: ['BUSY', 'ENTERTAINMENT'] }, notifyWhileBusy: true },
          ],
        },
        select: { id: true, user: { select: { username: true } } },
      });
      let sent = 0;
      const notConnected: string[] = [];
      for (const c of companions) {
        // 命中 ≠ 收到：客户端没连着的人，这条弹窗只会发进空气里。
        if (!this.companionSockets.get(c.id)?.size) {
          notConnected.push(c.user?.username || c.id);
        }
        this.server.to(`companion:${c.id}`).emit('order:urgent', data);
        sent += 1;
      }
      // 老板 2026-09-22 报「邵泽慧发广播单，所有人都没弹窗」：这条路径以前一句日志都没有，
      // 出问题只能靠猜。现在把「命中几人 / 真正在线几人 / 谁不在线」都记下来。
      logger.info('SEND order:urgent (broadcast)', {
        studioId,
        orderCode: (data as any)?.orderCode,
        matched: sent,
        connected: sent - notConnected.length,
        notConnected,
      });
      if (sent === 0) {
        logger.warn('Broadcast order reached nobody (no idle companion in studio)', {
          studioId,
          orderCode: (data as any)?.orderCode,
        });
      }
      return sent;
    } catch (err) {
      logger.error('broadcastNewOrder failed', { error: (err as Error).message, studioId });
      return 0;
    }
  }

  /** 只推送给「空闲且上等马」的线下陪玩，返回实际推送人数。 */
  async broadcastToQualifiedIdleCompanions(studioId: string, event: string, data: unknown): Promise<number> {
    try {
      const idle = await this.prisma.companion.findMany({
        where: { studioId, status: 'AVAILABLE' },
        select: { id: true },
      });
      let sent = 0;
      for (const c of idle) {
        if (await this.excellence.isExcellent(c.id)) {
          this.server.to(`companion:${c.id}`).emit(event, data);
          sent += 1;
        }
      }
      return sent;
    } catch (err) {
      logger.error('broadcastToQualifiedIdleCompanions failed', { error: (err as Error).message, studioId, event });
      return 0;
    }
  }

  /** 推送给桥接工作室的空闲陪玩，返回实际推送人数。 */
  async broadcastToBridgedIdleCompanions(studioId: string, event: string, data: unknown): Promise<number> {
    try {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
      let sent = 0;
      for (const bid of bridgedIds) {
        const idle = await this.prisma.companion.findMany({
          where: { studioId: bid, status: 'AVAILABLE' },
          select: { id: true },
        });
        for (const c of idle) {
          this.server.to(`companion:${c.id}`).emit(event, data);
          sent += 1;
        }
      }
      return sent;
    } catch (err) {
      logger.error('broadcastToBridgedIdleCompanions failed', { error: (err as Error).message, studioId, event });
      return 0;
    }
  }

  /** 推送给桥接工作室中指定类型（DIRECT=线下 / RENTAL=线上俱乐部）的空闲陪玩，返回实际推送人数。 */
  async broadcastToBridgedIdleCompanionsByType(
    studioId: string,
    studioType: 'DIRECT' | 'RENTAL',
    event: string,
    data: unknown,
  ): Promise<number> {
    try {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
      if (bridgedIds.length === 0) return 0;
      const studios = await this.prisma.studio.findMany({
        where: { id: { in: bridgedIds }, type: studioType },
        select: { id: true },
      });
      let sent = 0;
      for (const st of studios) {
        const idle = await this.prisma.companion.findMany({
          where: { studioId: st.id, status: 'AVAILABLE' },
          select: { id: true },
        });
        for (const c of idle) {
          this.server.to(`companion:${c.id}`).emit(event, data);
          sent += 1;
        }
      }
      return sent;
    } catch (err) {
      logger.error('broadcastToBridgedIdleCompanionsByType failed', {
        error: (err as Error).message,
        studioId,
        studioType,
        event,
      });
      return 0;
    }
  }

  /**
   * 「广播」发单时，桥接工作室那边也弹一次抢单窗。
   * 为了不打乱订单池的里程碑（上等马 → 桥接 → 中等马 ……），
   * 这里和订单池保持一致：等「桥接工作室等待」到了才弹，本店陪玩仍然先有这段先手。
   * 弹之前会重新确认订单还没被人抢走，避免弹一个已经被接掉的单。
   */
  async broadcastUrgentToBridgedStudios(
    studioId: string,
    orderId: string,
    data: unknown,
    delayMs: number,
  ): Promise<number> {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      const fresh = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true, companionId: true, claimedCsUserId: true },
      });
      if (!fresh || fresh.status !== 'PENDING' || fresh.companionId || fresh.claimedCsUserId) {
        return 0;
      }
      const sent = await this.broadcastToBridgedIdleCompanions(studioId, 'order:urgent', data);
      if (sent > 0) {
        logger.info('SEND order:urgent to bridged studios', { studioId, orderId, sent });
      }
      return sent;
    } catch (err) {
      logger.error('broadcastUrgentToBridgedStudios failed', {
        error: (err as Error).message,
        studioId,
        orderId,
      });
      return 0;
    }
  }

  notifyUser(userId: string, event: string, data: unknown): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  notifyCompanion(companionId: string, event: string, data: unknown): void {
    this.server.to(`companion:${companionId}`).emit(event, data);
  }

  // 前端有些入口会把 companionId 当成 userId 传过来（例如陪玩端订单池）。
  // 这里统一归一化为 User id，保证语音信令能投递到正确的 user:{id} 房间。
  private async resolveUserId(id: string | undefined | null): Promise<string> {
    if (!id) return '';
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (user) return id;
    const companion = await this.prisma.companion.findUnique({ where: { id }, select: { userId: true } });
    return companion?.userId || id;
  }

  // ── 语音通话：音频走这条 WebSocket 中转 ──────────────────────────
  //
  // 老板 2026-09-21 报「王昊给邵泽慧打语音，互相听不到声音，之前是好的」。
  // 原来走 WebRTC 点对点打洞：只有 Google STUN，服务器没配 TURN
  // （云安全组只放通 22 / 3001，3478 和中继端口外面根本进不来，抓包 0 个包）。
  // 而办公室这边是多线 NAT，同一台机器先后映射成 122.6.117.75 / 122.6.112.252
  // 两个公网 IP，出口一变打好的洞就废，界面还显示「已接通」。
  // 现在直接把同一条 socket 当音频通道：NAT / 出口怎么变都不影响，
  // 网络抖动断线后 socket 自动重连，声音接着走。
  //
  // 会话表只用于「记通话日志 + 校验音频只发给通话对端」，纯内存不落库。
  private callSessions = new Map<
    string,
    { peerId: string; peerRawId: string; startedAt: number; frames: number }
  >();
  private audioFrameBudget = new Map<string, { windowStart: number; count: number }>();
  /** 断开后「等一会儿再收尾」的定时器：userId -> timer */
  private pendingCallEndTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** 音频帧限速：每人每秒最多 100 帧（正常 50 帧/秒），防异常客户端刷爆通道。 */
  private allowAudioFrame(userId: string): boolean {
    const now = Date.now();
    const budget = this.audioFrameBudget.get(userId);
    if (!budget || now - budget.windowStart >= 1000) {
      this.audioFrameBudget.set(userId, { windowStart: now, count: 1 });
      return true;
    }
    budget.count += 1;
    return budget.count <= 100;
  }

  private rememberCall(userId: string, peerId: string, peerRawId: string): void {
    this.callSessions.set(userId, { peerId, peerRawId, startedAt: Date.now(), frames: 0 });
  }

  /** 记一条通话日志（谁跟谁、打了多久、传了多少音频帧），并清掉会话。 */
  private logCallEnd(userId: string, username: string | undefined, reason: string, message = 'Voice call ended'): void {
    const session = this.callSessions.get(userId);
    if (!session) return;
    this.callSessions.delete(userId);
    this.audioFrameBudget.delete(userId);
    logger.info(message, {
      userId,
      username,
      peerUserId: session.peerId,
      reason,
      seconds: Math.round((Date.now() - session.startedAt) / 1000),
      audioFrames: session.frames,
    });
  }

  /**
   * 客户端断开时**不要立刻掐断通话**：办公室/家宽是多线 NAT，出口 IP 一换
   * WebSocket 就会断一次（实测邵泽慧的连接每 1~2 分钟掉一回），
   * 但客户端通常 1~2 秒就自动连回来了。
   * 所以先告诉对端「对方网络抖动」，等超过宽限期还没回来才真的挂断并记日志。
   */
  private scheduleCallEndOnDisconnect(user: ConnectedUser): void {
    const session = this.callSessions.get(user.id);
    if (!session) return;
    if (this.pendingCallEndTimers.has(user.id)) return;
    this.notifyUser(session.peerId, 'call:peer-unstable', { peerUserId: user.id });
    const timer = setTimeout(() => {
      this.pendingCallEndTimers.delete(user.id);
      const current = this.callSessions.get(user.id);
      if (!current) return;
      if (presence.hasSocket(user.id)) return; // 已经连回来了，通话继续
      this.notifyUser(current.peerId, 'call:hangup', {});
      this.logCallEnd(user.id, user.username, 'socket-closed', 'Voice call dropped (socket closed)');
    }, VOICE_RECONNECT_GRACE_MS);
    // 别让这个定时器拖住进程退出
    if (typeof (timer as { unref?: () => void }).unref === 'function') timer.unref();
    this.pendingCallEndTimers.set(user.id, timer);
  }

  @SubscribeMessage('call:offer')
  async handleCallOffer(@ConnectedSocket() client: Socket, @MessageBody() data: any): Promise<void> {
    const user = (client.data as any)?.user as ConnectedUser | undefined;
    const raw = typeof data?.targetUserId === 'string' ? data.targetUserId : '';
    const targetUserId = await this.resolveUserId(raw);
    if (!user || !targetUserId) return;
    this.rememberCall(user.id, targetUserId, raw);
    // 通话量很小，这里按 info 记：以后老板再问「谁打给谁、接通没有、打了多久」直接查日志。
    logger.info('Voice call ringing', { userId: user.id, username: user.username, peerUserId: targetUserId });
    // sdp 只对旧版客户端有意义（它们还在用 WebRTC 直连）；
    // 新版客户端不带 sdp，音频走下面的 call:audio 中转。
    this.notifyUser(targetUserId, 'call:offer', {
      fromUserId: user.id,
      callerName: user.username,
      sdp: data?.sdp,
    });
  }

  @SubscribeMessage('call:answer')
  async handleCallAnswer(@ConnectedSocket() client: Socket, @MessageBody() data: any): Promise<void> {
    const user = (client.data as any)?.user as ConnectedUser | undefined;
    const raw = typeof data?.targetUserId === 'string' ? data.targetUserId : '';
    const targetUserId = await this.resolveUserId(raw);
    if (!user || !targetUserId) return;
    this.rememberCall(user.id, targetUserId, raw);
    logger.info('Voice call answered', { userId: user.id, username: user.username, peerUserId: targetUserId });
    this.notifyUser(targetUserId, 'call:answer', { fromUserId: user.id, sdp: data?.sdp });
  }

  /** 音频帧转发：只允许发给本通话的对端，单帧 ≤ 8KB，每秒 ≤ 100 帧。 */
  @SubscribeMessage('call:audio')
  handleCallAudio(@ConnectedSocket() client: Socket, @MessageBody() data: any): void {
    const user = (client.data as any)?.user as ConnectedUser | undefined;
    if (!user) return;
    const to = typeof data?.to === 'string' ? data.to : '';
    const pcm = data?.pcm;
    if (!to || !pcm) return;
    const bytes = (pcm as any).byteLength ?? (pcm as any).length ?? 0;
    if (bytes <= 0 || bytes > 8192) return;
    const session = this.callSessions.get(user.id);
    if (!session) return;
    if (to !== session.peerId && to !== session.peerRawId) return;
    if (!this.allowAudioFrame(user.id)) return;
    session.frames += 1;
    this.notifyUser(session.peerId, 'call:audio', { from: user.id, seq: data?.seq, pcm });
  }

  /**
   * ICE 候选透传：只有旧版客户端用得到（它们还在走 WebRTC 直连）。
   * 新版客户端这段通路已经不用了，但留着不占什么成本，
   * 手上还装着老客户端的陪玩也不会因为服务端升级而变哑。
   */
  @SubscribeMessage('call:ice-candidate')
  async handleCallIce(@ConnectedSocket() _client: Socket, @MessageBody() data: any): Promise<void> {
    const targetUserId = await this.resolveUserId(data?.targetUserId);
    if (targetUserId) this.notifyUser(targetUserId, 'call:ice-candidate', { candidate: data?.candidate });
  }

  @SubscribeMessage('call:hangup')
  async handleCallHangup(@ConnectedSocket() client: Socket, @MessageBody() data: any): Promise<void> {
    const user = (client.data as any)?.user as ConnectedUser | undefined;
    const targetUserId = await this.resolveUserId(data?.targetUserId);
    if (!user || !targetUserId) return;
    this.logCallEnd(user.id, user.username, 'hangup');
    // 对端不会自己再发一次挂断，这里顺手把他的会话也收掉，避免会话表越攒越多。
    const peerSession = this.callSessions.get(targetUserId);
    if (peerSession && (peerSession.peerId === user.id || peerSession.peerRawId === user.id)) {
      this.logCallEnd(targetUserId, undefined, 'peer-hangup');
    }
    this.notifyUser(targetUserId, 'call:hangup', {});
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

  /**
   * 自动杀进程总开关（SystemConfig: blacklist.auto_kill）。
   * 默认关闭：只有明确把它设成 true 时，客户端才会按状态去杀名单里的进程。
   * 之前没有这个开关时，服务端会主动把「空闲名单」推给客户端，
   * 出现过正在玩游戏的陪玩被当成空闲而被杀进程的事故。
   */
  async isAutoKillEnabled(): Promise<boolean> {
    // 一次工作室级推送会给每个在线陪玩各查一次配置，加 5 秒缓存避免把库打满。
    const now = Date.now();
    if (this.autoKillCache && now - this.autoKillCache.at < 5000) {
      return this.autoKillCache.value;
    }
    const cfg = await this.prisma.systemConfig
      .findUnique({ where: { key: 'blacklist.auto_kill' } })
      .catch(() => null);
    const v = cfg?.value;
    const value = v === true || v === 'true';
    this.autoKillCache = { at: now, value };
    return value;
  }

  /** 自动杀进程总开关的短缓存，见 isAutoKillEnabled()。 */
  private autoKillCache: { at: number; value: boolean } | null = null;

  /** 开关刚改完时调用，避免还把旧值缓存最长 5 秒。 */
  invalidateAutoKillCache(): void {
    this.autoKillCache = null;
  }

  async sendBlacklistUpdate(
    companionId: string,
    blacklist: { processName: string; processPath: string | null }[],
    whitelist: { processName: string; isSystem: boolean }[],
    version: number,
    status?: string,
    authoritative = false,
  ): Promise<void> {
    const autoKill = await this.isAutoKillEnabled();
    // 总开关关掉时下发空名单：客户端收到空名单会立刻清掉自己手上的杀进程名单，不再误杀。
    const effective = autoKill ? blacklist : [];
    logger.info('SEND blacklist:update', {
      companionId,
      blacklistCount: effective.length,
      suppressed: !autoKill && blacklist.length > 0,
      whitelistCount: whitelist.length,
      version,
      status,
      authoritative,
    });
    this.server
      .to(`companion:${companionId}`)
      .emit('blacklist:update', { blacklist: effective, whitelist, version, status, authoritative });
  }

  async broadcastBlacklistToStudio(
    studioId: string,
    blacklist: { processName: string; processPath: string | null }[],
    whitelist: { processName: string; isSystem: boolean }[],
  ): Promise<void> {
    const companions = await this.prisma.companion.findMany({ where: { studioId }, select: { id: true } });
    const version = Date.now();
    let pushed = 0;
    for (const c of companions) {
      await this.sendBlacklistUpdate(c.id, blacklist, whitelist.map((w) => ({ ...w, isSystem: false })), version);
      pushed++;
    }
    logger.info('SEND blacklist:update (broadcast)', { studioId, total: companions.length, pushed, version });
  }

  /**
   * 推送当前状态对应的黑名单，覆盖离线/未登录后补连接的情况。
   *
   * authoritative 只在「陪玩本人或管理端明确切换了状态」时为 true；
   * 连接/心跳这类只是按「在线 = 空闲」补推的场景必须传 false，
   * 此时不下发 status，让客户端保留自己选的状态（娱乐中/休息），
   * 避免把正在玩游戏的人当成空闲而误杀游戏进程。
   */
  async pushCurrentBlacklist(companionId: string, studioId: string | null, authoritative = false): Promise<void> {
    if (!studioId) return;
    try {
      // 使用「状态黑名单」而不是旧的全局 ProcessBlacklist：陪玩处于哪个状态，就套用该状态下的黑名单。
      const companion = await this.prisma.companion.findUnique({
        where: { id: companionId },
        select: { status: true },
      });
      const status = companion?.status ?? 'AVAILABLE';
      const statusEntries = await this.prisma.companionStatusBlacklist.findMany({
        where: { studioId, status },
        select: { processName: true },
      });
      const blacklist = statusEntries.map((s) => ({ processName: s.processName, processPath: null }));
      const whitelist = await this.prisma.processWhitelist.findMany({
        where: { studioId },
        select: { processName: true },
      });
      await this.sendBlacklistUpdate(
        companionId,
        blacklist,
        whitelist.map((w) => ({ processName: w.processName, isSystem: false })),
        Date.now(),
        authoritative ? status : undefined,
        authoritative,
      );
    } catch (err) {
      logger.warn('pushCurrentBlacklist failed', { companionId, error: (err as Error).message });
    }
  }

  /** 服务端把陪玩状态切回空闲等状态后，重推一次黑名单，让客户端恢复杀进程。 */
  async refreshCompanionBlacklist(companionId: string): Promise<void> {
    const companion = await this.prisma.companion
      .findUnique({ where: { id: companionId }, select: { studioId: true, status: true } })
      .catch(() => null);
    if (!companion?.studioId) return;
    await this.prisma.companionPC
      .update({ where: { companionId }, data: { currentMode: companion.status } })
      .catch(() => {});
    await this.pushCurrentBlacklist(companionId, companion.studioId);
  }

  /** 陪玩端连接时，优先按 MAC / 登录账号识别电脑，不靠 IP（IP 会变）。 */
  async syncManagedPc(address: string, username: string): Promise<void> {
    try {
      const ip = address?.replace(/^::ffff:/, '') || '';
      if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return;
      const mac = this.resolveMacFromArp(ip);

      // 1. 优先按 MAC 识别（IP 会变，MAC 更稳定）
      let pc = mac ? await this.prisma.managedPC.findFirst({ where: { macAddress: mac } }) : null;
      // 2. 再按登录账号识别（同一人换电脑/IP 也能对上）
      if (!pc) {
        pc = await this.prisma.managedPC.findFirst({ where: { loginAccount: username } });
      }
      // 3. 最后兜底按 IP 识别
      if (!pc) {
        pc = await this.prisma.managedPC.findFirst({ where: { ip } });
      }
      if (!pc) {
        // 新注册陪玩首次连接时自动登记电脑，后续远程开机就能直接看到。
        pc = await this.prisma.managedPC.create({
          data: {
            ip,
            loginAccount: username,
            macAddress: mac || null,
          },
        }).catch(() => null);
      }
      if (!pc) return;
      await this.prisma.managedPC.update({
        where: { id: pc.id },
        data: {
          ip,
          loginAccount: username,
          ...(mac ? { macAddress: mac } : {}),
          updatedAt: new Date(),
        },
      });
    } catch {
      // 电脑管理表可能尚未迁移，忽略即可
    }
  }

  private resolveMacFromArp(ip: string): string | null {
    try {
      const raw = fs.readFileSync('/app/uploads/host-arp.txt', 'utf-8');
      for (const line of raw.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === ip && parts[3] && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(parts[3])) {
          return parts[3].toLowerCase();
        }
      }
    } catch {}
    return null;
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
