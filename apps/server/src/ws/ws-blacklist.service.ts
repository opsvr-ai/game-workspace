// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { logger } from '../common/logger';
import { resolveCompanionOverrides, resolveStudioBlacklistEnabled } from '../common/blacklist-switch';

/**
 * 「黑名单下发音义层」——原 ws.gateway.ts 的 blacklist outbound 段。
 *
 * 只负责「这条连接该收到哪份名单、开关怎么合成、要不要缓存」，
 * 连接/房间编排见 WsConnectionService，网关保留同名公开方法委托。
 *
 * server 由网关 attach() 注入取址回调（@WebSocketServer 构造期还没有值）。
 */
export interface WsBlacklistRuntime {
  getServer: () => Server;
}

@Injectable()
export class WsBlacklistService {
  private runtime: WsBlacklistRuntime | null = null;

  /** 各店「黑名单是否生效」的短缓存，见 isStudioBlacklistEnabled()。 */
  private studioBlacklistCache = new Map<string, { at: number; value: boolean }>();
  /**
   * 「按人特批」表（见 common/blacklist-switch.ts）：键 = 陪玩 id，值 = 单独开 / 单独关。
   * 跟本店开关同一个 5 秒口径；一次工作室广播会给每个人各查一次，缓存一下避免把库打满。
   */
  private companionOverridesCache = new Map<string, { at: number; value: Record<string, boolean> }>();

  constructor(private readonly prisma: PrismaService) {}

  attach(runtime: WsBlacklistRuntime): void {
    this.runtime = runtime;
  }

  private get r(): WsBlacklistRuntime {
    if (!this.runtime) throw new Error('WsBlacklistService runtime not attached');
    return this.runtime;
  }

  private get server(): Server {
    return this.r.getServer();
  }

  /**
   * 本店「黑名单是否生效」开关（StudioConfig: blacklist.enabled，店长自己拨）——
   * 这是「杀进程动不动手」的**唯一开关**（老板 2026-09-24：不要全站总闸）。
   *
   * 关着 / 没拨过 = 这家店的名单只记录不下发，本店陪玩一个进程都不会被结束。
   * 加 5 秒缓存：一次工作室广播会给每个在线陪玩各查一次，避免把库打满。
   */
  async isStudioBlacklistEnabled(studioId: string | null | undefined): Promise<boolean> {
    // 分不出是哪家店时等于「不生效」（解析器会返回 false）：说不清就绝不动手。
    if (!studioId) return false;
    const now = Date.now();
    const cached = this.studioBlacklistCache.get(studioId);
    if (cached && now - cached.at < 5000) return cached.value;
    const value = await resolveStudioBlacklistEnabled(this.prisma as never, studioId);
    this.studioBlacklistCache.set(studioId, { at: now, value });
    return value;
  }

  /** 开关刚改完时调用，避免还把旧值缓存最长 5 秒。 */
  invalidateBlacklistSwitchCache(): void {
    this.studioBlacklistCache.clear();
    this.companionOverridesCache.clear();
  }

  async getCompanionBlacklistOverrides(studioId: string): Promise<Record<string, boolean>> {
    const now = Date.now();
    const cached = this.companionOverridesCache.get(studioId);
    if (cached && now - cached.at < 5000) return cached.value;
    const value = await resolveCompanionOverrides(this.prisma as never, studioId);
    this.companionOverridesCache.set(studioId, { at: now, value });
    return value;
  }

  /**
   * **这个陪玩**到底动不动手：本店开关 + 按人特批合成。
   * 没被特批的人 = 跟随本店开关（老行为，一个字节都不变）。
   */
  async isCompanionBlacklistEnabled(
    companionId: string | null | undefined,
    studioId: string | null | undefined,
  ): Promise<boolean> {
    // 分不出是哪家店 = 不生效：说不清就绝不动手。
    if (!studioId) return false;
    const overrides = await this.getCompanionBlacklistOverrides(studioId);
    if (companionId && Object.prototype.hasOwnProperty.call(overrides, companionId)) {
      return overrides[companionId] === true;
    }
    return this.isStudioBlacklistEnabled(studioId);
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
    // 本店开关 + 按人特批合成：不生效就下发空名单，客户端收到空名单会当场停掉杀进程
    // （连没升级的老客户端同样有效）。
    const killEnabled = await this.isCompanionBlacklistEnabled(companionId, studioId);
    const effective = killEnabled ? blacklist : [];
    logger.info('SEND blacklist:update', {
      companionId,
      blacklistCount: effective.length,
      suppressed: effective.length === 0 && blacklist.length > 0,
      killEnabled,
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
      await this.sendBlacklistUpdate(
        c.id,
        blacklist,
        whitelist.map((w) => ({ ...w, isSystem: false })),
        version,
        undefined,
        false,
        studioId,
      );
      pushed++;
    }
    logger.info('SEND blacklist:update (broadcast)', { studioId, total: companions.length, pushed, version });
  }

  /**
   * 推送当前状态对应的黑名单，覆盖离线/未登录后补连接的情况。
   *
   * authoritative 只在「陪玩本人或管理端明确切换了状态」时为 true，
   * 客户端拿它区分「是本人点的」还是「服务端顺手补推的」。
   *
   * 不管 authoritative 是真是假，status 都照发：客户端只在**本地已经明确选了**
   * 娱乐中 / 休息时才拒绝服务端的空闲（见 companion-electron main.ts 的 blacklist:update），
   * 本地状态是空的（重装 / 重启后没点过状态）就以服务端为准 ——
   * 不然「老板在后台单独给某个人开了黑名单」在这台机器上会一直不生效
   * （老板 2026-10-03 报的「三个人只杀了一个」）。
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
        status,
        authoritative,
        studioId,
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
}
