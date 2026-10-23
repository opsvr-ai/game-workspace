// craftsman-ignore: TS001,TS003
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.service';
import { logger } from '../common/logger';
import { presence } from '../common/presence';
import { CompanionsService } from '../companions/companions.service';
import { BridgeService } from '../studios/bridge.service';
import { switchCompanionStatus } from '../common/companion-status-switch';
import { WsEmitterService } from './ws-emitter.service';
import { WsBlacklistService } from './ws-blacklist.service';
import { WsVoiceService } from './ws-voice.service';

/**
 * 「连接层」——原 ws.gateway.ts 的 lifecycle / handshake / room 编排 / 在线映射部分。
 *
 * 只管「这条连接是谁、能进哪些房间、断了多久算离线、要不要踢」；
 * 事件发给谁见 WsEmitterService，黑名单见 WsBlacklistService，通话见 WsVoiceService。
 * 网关保留 handleConnection / handleDisconnect / kickUser 同名委托，现有调用方零改动。
 */
export interface ConnectedUser {
  id: string;
  username: string;
  role: string;
  studioId: string | null;
  companionId?: string;
}

export interface WsConnectionRuntime {
  getServer: () => Server;
  emitter: WsEmitterService;
  blacklist: WsBlacklistService;
  voice: WsVoiceService;
}

@Injectable()
export class WsConnectionService {
  private runtime: WsConnectionRuntime | null = null;

  /** companionId -> socketId */
  private companionSockets = new Map<string, Set<string>>();
  /** 断开后「延迟置离线」的定时器：companionId -> timer */
  private pendingOfflineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 置离线宽限期缓存（避免每次断开都查一次配置） */
  private offlineGraceCache: { seconds: number; at: number } | null = null;
  /** userId -> 该用户当前所有的连接 id（一个人可能同时开着网页 + 客户端 + 弹窗） */
  private userSockets = new Map<string, Set<string>>();
  /**
   * 客服 / 店长「下班打卡」的延迟定时器：userId -> timer（老板 2026-10-04）。
   * 刷新页面 / 网络抖动会断开几秒，直接记下班就天天误记早退，所以跟陪玩一样等宽限期真的没连回来才算。
   */
  private pendingStaffOfflineTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly bridgeService: BridgeService,
    @Inject(forwardRef(() => CompanionsService)) private readonly companionsService: CompanionsService,
  ) {}

  attach(runtime: WsConnectionRuntime): void {
    this.runtime = runtime;
  }

  private get r(): WsConnectionRuntime {
    if (!this.runtime) throw new Error('WsConnectionService runtime not attached');
    return this.runtime;
  }

  private get server(): Server {
    return this.r.getServer();
  }

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

  /**
   * 把某个用户现有的所有连接踢掉（老板 2026-10-01）：管理 / 客服账号被顶号时，
   * 旧的那台要立刻断开 —— 否则它虽然接不了接口，却还能继续收实时消息和抢单弹窗。
   */
  kickUser(userId: string): number {
    const ids = this.userSockets.get(userId);
    if (!ids?.size) return 0;
    let kicked = 0;
    for (const sid of Array.from(ids)) {
      const socket = this.server?.sockets?.sockets?.get(sid);
      if (!socket) continue;
      try {
        socket.emit('auth:replaced', { message: '该账号已在别的电脑上登录' });
        socket.disconnect(true);
        kicked += 1;
      } catch {
        /* 单条连接失败不影响别的 */
      }
    }
    this.userSockets.delete(userId);
    return kicked;
  }

  /** 这个陪玩的客户端现在有没有连着。 */
  isCompanionConnected(companionId: string): boolean {
    return !!this.companionSockets.get(companionId)?.size;
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      // 服务刚启动、runtime 还没挂上时，先断开让客户端重连；绝不能在这里 throw 把整个进程打崩。
      if (!this.runtime) {
        client.disconnect(true);
        return;
      }
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

      // 单点登录（老板 2026-10-01）：管理 / 客服账号的令牌里带着 sessionVersion，
      // 对不上 DB 里当前的号码 = 已经在别处登录过，这条连接直接拒掉。
      // 陪玩的 sv 从不变化（不顶号），老令牌没有 sv 也不判，
      // 避免发布当刻把正在接单的陪玩掉下线。
      if (typeof (payload as any).sv === 'number') {
        const svRow = await this.prisma.user
          .findUnique({ where: { id: payload.sub }, select: { sessionVersion: true } })
          .catch(() => null);
        if (!svRow || (payload as any).sv !== svRow.sessionVersion) {
          logger.info('Socket rejected: session replaced', {
            userId: payload.sub,
            username: payload.username,
            role: payload.role,
          });
          client.emit('auth:replaced', { message: '该账号已在别的电脑上登录' });
          setTimeout(() => client.disconnect(true), 200);
          return;
        }
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
        // 客服 / 店长的上班卡：客户端（客服端 / 店长端）一开机连上就打；
        // 宽限期内又连回来 = 没走过，把「下班打卡」定时器撤掉。
        this.cancelPendingStaffOffline(user.id);
        try {
          await this.companionsService?.ensureStaffAttendance(user.id, user.role);
        } catch (err) {
          logger.warn('Staff attendance punch-in failed', { userId: user.id, error: (err as Error).message });
        }
      }

      // 语音：宽限期内连回来 = 通话继续，并告诉对端网络稳了。
      this.r.voice.onUserReconnected(user);

      void client.join(`user:${user.id}`);
      if (!this.userSockets.has(user.id)) this.userSockets.set(user.id, new Set());
      this.userSockets.get(user.id)!.add(client.id);
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
        void this.r.blacklist.pushCurrentBlacklist(user.companionId, user.studioId);
        void this.r.blacklist.syncManagedPc(client.handshake?.address, user.username);

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
          this.r.emitter.pushOrder(user.companionId, {
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
          this.r.emitter.broadcastToBridgedStudios(user.studioId, 'status:broadcast', {
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
    // 停止/重启服务时 runtime 可能已卸载，disconnect 不应该把进程打崩。
    if (!this.runtime) return;
    presence.removeSocket(user.id);
    // 同一客户端可能有好几条连接（网页 + 陪玩端主进程），只有一条都不剩才算真的走了，
    // 不然主进程那条连接一抖就把正在进行的语音通话掐断。
    if (!presence.hasSocket(user.id)) {
      this.r.voice.scheduleCallEndOnDisconnect(user);
    }
    // 只摘掉自己这条连接；这个人还有别的窗口连着就不能当成掉线（以前会把整条记录删掉，
    // 剩下的连接从此收不到点对点推送）。
    const mySockets = this.userSockets.get(user.id);
    if (mySockets) {
      mySockets.delete(client.id);
      if (mySockets.size === 0) this.userSockets.delete(user.id);
    }
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
      // 客服 / 店长：一条连接都不剩了才安排「下班打卡」，等宽限期（默认 60 秒）；
      // 期间连回来就撤掉（撤销在 handleConnection 里），不会误记早退。
      if (!presence.hasSocket(user.id)) {
        await this.scheduleStaffOffline(user.id, user.role);
      }
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
  cancelPendingOfflineTransition(companionId: string): boolean {
    const pending = this.pendingOfflineTimers.get(companionId);
    if (!pending) return false;
    clearTimeout(pending);
    this.pendingOfflineTimers.delete(companionId);
    return true;
  }

  /** 宽限期内客服 / 店长又连回来 → 撤掉「下班打卡」定时器。 */
  private cancelPendingStaffOffline(userId: string): boolean {
    const pending = this.pendingStaffOfflineTimers.get(userId);
    if (!pending) return false;
    clearTimeout(pending);
    this.pendingStaffOfflineTimers.delete(userId);
    return true;
  }

  /** 客服 / 店长最后一条连接断开 → 宽限期后记下班（早于下班时间就是早退）。 */
  private async scheduleStaffOffline(userId: string, role: string): Promise<void> {
    if (role !== 'CS' && role !== 'ADMIN') return; // 老板不考勤
    // 考勤永远不能反过来影响连接处理：读配置 / 写库失败都只记一条日志。
    try {
      const existing = this.pendingStaffOfflineTimers.get(userId);
      if (existing) clearTimeout(existing);
      const graceMs = await this.offlineGraceMs();
      const apply = async () => {
        this.pendingStaffOfflineTimers.delete(userId);
        if (presence.hasSocket(userId)) return;
        try {
          await this.companionsService?.finalizeStaffAttendance(userId, role);
        } catch (err) {
          logger.warn('Staff attendance punch-out failed', { userId, error: (err as Error).message });
        }
      };
      if (graceMs <= 0) {
        await apply();
        return;
      }
      const timer = setTimeout(() => void apply(), graceMs);
      if (typeof (timer as any).unref === 'function') (timer as any).unref();
      this.pendingStaffOfflineTimers.set(userId, timer);
    } catch (err) {
      logger.warn('Staff attendance punch-out scheduling failed', { userId, error: (err as Error).message });
    }
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
    // 走统一入口：掉线时把还开着的那段计时日志封口
    // （不封的话，人走了日志还开着，在线时长会一直涨到营业日结束）。
    await switchCompanionStatus(this.prisma, companionId, disconnectStatus).catch((err) => {
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
      this.r.emitter.broadcastToBridgedStudios(studioId, 'status:broadcast', {
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
}
