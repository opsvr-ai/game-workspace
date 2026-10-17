// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { logger } from '../common/logger';
import { presence } from '../common/presence';
import type { ConnectedUser } from './ws-connection.service';

/**
 * 「语音通话语义层」——原 ws.gateway.ts 的 call:* 处理段。
 *
 * 会话表 / 音频限流 / 断线宽限挂断都是纯内存状态，只用于「记通话日志 + 校验音频
 * 只发给通话对端」，不落库。连接编排（谁连上/断开）在 WsConnectionService，
 * 网关保留 @SubscribeMessage 入口与 scheduleCallEndOnDisconnect 委托。
 */

/** 语音通话中断线宽限期：比客户端自己的 30 秒稍长，让客户端先有机会重连上。 */
const VOICE_RECONNECT_GRACE_MS = 45_000;

export interface WsVoiceRuntime {
  /** 走网关公开的 notifyUser，保留调用方覆盖它的老行为。 */
  notifyUser: (userId: string, event: string, data: unknown) => void;
}

@Injectable()
export class WsVoiceService {
  private runtime: WsVoiceRuntime | null = null;

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

  constructor(private readonly prisma: PrismaService) {}

  attach(runtime: WsVoiceRuntime): void {
    this.runtime = runtime;
  }

  private get notifyUser(): WsVoiceRuntime['notifyUser'] {
    if (!this.runtime) throw new Error('WsVoiceService runtime not attached');
    return this.runtime.notifyUser;
  }

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
  scheduleCallEndOnDisconnect(user: ConnectedUser): void {
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

  /**
   * 宽限期内又连回来了 → 撤掉「挂断」定时器，并告诉对端网络稳定了。
   * 原逻辑在 handleConnection 里，搬过来跟 call 会话表放一起。
   */
  onUserReconnected(user: ConnectedUser): void {
    const pendingCallEnd = this.pendingCallEndTimers.get(user.id);
    if (!pendingCallEnd) return;
    clearTimeout(pendingCallEnd);
    this.pendingCallEndTimers.delete(user.id);
    const session = this.callSessions.get(user.id);
    if (!session) return;
    logger.info('Voice call survived reconnect', {
      userId: user.id,
      username: user.username,
      peerUserId: session.peerId,
    });
    this.notifyUser(session.peerId, 'call:peer-stable', { peerUserId: user.id });
  }

  async handleCallOffer(client: Socket, data: any): Promise<void> {
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

  async handleCallAnswer(client: Socket, data: any): Promise<void> {
    const user = (client.data as any)?.user as ConnectedUser | undefined;
    const raw = typeof data?.targetUserId === 'string' ? data.targetUserId : '';
    const targetUserId = await this.resolveUserId(raw);
    if (!user || !targetUserId) return;
    this.rememberCall(user.id, targetUserId, raw);
    logger.info('Voice call answered', { userId: user.id, username: user.username, peerUserId: targetUserId });
    this.notifyUser(targetUserId, 'call:answer', { fromUserId: user.id, sdp: data?.sdp });
  }

  /** 音频帧转发：只允许发给本通话的对端，单帧 ≤ 8KB，每秒 ≤ 100 帧。 */
  handleCallAudio(client: Socket, data: any): void {
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
  async handleCallIce(data: any): Promise<void> {
    const targetUserId = await this.resolveUserId(data?.targetUserId);
    if (targetUserId) this.notifyUser(targetUserId, 'call:ice-candidate', { candidate: data?.candidate });
  }

  async handleCallHangup(client: Socket, data: any): Promise<void> {
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

  // 前端有些入口会把 companionId 当成 userId 传过来（例如陪玩端订单池）。
  // 这里统一归一化为 User id，保证语音信令能投递到正确的 user:{id} 房间。
  private async resolveUserId(id: string | undefined | null): Promise<string> {
    if (!id) return '';
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (user) return id;
    const companion = await this.prisma.companion.findUnique({ where: { id }, select: { userId: true } });
    return companion?.userId || id;
  }
}
