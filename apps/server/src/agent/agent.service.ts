// craftsman-ignore: TS001,TS003
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { presence } from '../common/presence';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const logger = new Logger('AgentService');

// 串行更新锁：同一时间只允许一个客户端下载更新包，避免多台机器同时抢带宽导致谁都下不动。
//
// 2026-10-06（P0-6 多工作室）：名额从「全网一个」改成「每家店一个」。
// 以前这里是一个模块级单变量 —— 一家店在升级，其它店全部排队等它，多工作室场景下这是硬伤。
// 现在按 scope（= studioId）分名额：一家店在下载，不影响另一家店自己铺开。
// 拿不到归属的机器（新装机还没登录，按 IP 记账的 anon:*）落到空 scope，
// 全网共用那一个名额，保持老行为。
type UpdateSlotState = { companionId: string; startedAt: number; reserved: boolean };
/** 未归属 / 匿名机器共用的名额（老行为：全网一个）。 */
const DEFAULT_UPDATE_SCOPE = '';
const emptyUpdateSlot = (): UpdateSlotState => ({ companionId: '', startedAt: 0, reserved: false });
/** 每家店一个名额。 */
const updateSlots = new Map<string, UpdateSlotState>();
/** 每家店一条排队队列（companionId → 排队时间）。 */
const updateWaiters = new Map<string, Map<string, { firstAskedAt: number }>>();

function slotOf(scope: string): UpdateSlotState {
  let slot = updateSlots.get(scope);
  if (!slot) {
    slot = emptyUpdateSlot();
    updateSlots.set(scope, slot);
  }
  return slot;
}

function waitersOf(scope: string): Map<string, { firstAskedAt: number }> {
  let queue = updateWaiters.get(scope);
  if (!queue) {
    queue = new Map();
    updateWaiters.set(scope, queue);
  }
  return queue;
}

const UPDATE_SLOT_TIMEOUT = 10 * 60 * 1000; // 10 分钟超时，避免某台卡死长期占住名额
/**
 * 叫号时先把名额「预约」给被叫到的那台机器：
 * 以前叫号只是推个消息过去，被叫的机器还要错峰 0-60 秒才开始申请名额，
 * 这几十秒里名额经常被别的机器抢走 —— 被叫的机器一句「Update slot busy」就放弃，
 * 排队位置也丢了（老板 2026-10-03 报「徐泽宁一直不升级、秦伟杰早就升了」就是这个）。
 * 预约超时短一点：客户端没来领就赶紧让给下一位。
 */
const RESERVE_TTL_MS = 3 * 60 * 1000;
/** 一直在排队、等了这么久的机器可以直接把名额接过去（防止老版本永远轮不到）。 */
const WAIT_PRIORITY_MS = 5 * 60 * 1000;
/** 但当前那台至少先让它下载 3 分钟，别刚下到一半就被打断。 */
const HOLD_MIN_MS = 3 * 60 * 1000;
/** 名额归属（companionId → studioId）查库结果缓存多久：客户端每 5 分钟来问一次，不能每次都打库。 */
const UPDATE_SCOPE_TTL_MS = 10 * 60 * 1000;
/** 归属缓存最多存多少台机器，超了按 TTL 清一遍。 */
const UPDATE_SCOPE_CACHE_MAX = 2000;
/** 排队中的一台机器（给 controller 叫号用）。scope = 它归属的店，叫号时要带上。 */
export type UpdateWaiter = { companionId: string; firstAskedAt: number; scope: string };

@Injectable()
export class AgentService implements OnModuleInit, OnModuleDestroy {
  /** 进程启动标识：只给服务端自己看（诊断用），不再当作「前端构建号」下发。 */
  readonly processStartedId = Date.now().toString(36);

  /**
   * 叫号回调：由 AgentController 注入（只有它拿得到 WS 网关）。
   * 名额一空就喊下一位排队的人立刻来下载，链条才不会断。
   */
  private updateNotifier: (() => Promise<void>) | null = null;

  private updateSlotTimer: ReturnType<typeof setInterval> | null = null;

  /** companionId → 归属店（P0-6 名额按店隔离用）。查库结果带 TTL 的小缓存，避免每 5 分钟一次申请都打库。 */
  private readonly updateScopeCache = new Map<string, { scope: string; at: number }>();

  setUpdateNotifier(fn: () => Promise<void>): void {
    this.updateNotifier = fn;
  }

  onModuleInit(): void {
    // 每分钟扫一遍所有店的更新队列：
    // 1) 名额被占住却没人释放（客户端下到一半断网/崩了）→ 兜底腾位；
    // 2) 名额空着却还有人在排队 → 继续叫号，别让队列停在那儿等人 30 分钟后自己来问。
    this.updateSlotTimer = setInterval(() => {
      for (const scope of [...updateSlots.keys()]) {
        if (this.slotBusy(scope)) continue; // 这家店有人在下载：别打扰
        const slot = slotOf(scope);
        if (slot.companionId) {
          logger.warn(
            slot.reserved
              ? `Reserved update slot not claimed, releasing ${slot.companionId}`
              : `Update slot timed out, releasing ${slot.companionId}`,
          );
          updateSlots.set(scope, emptyUpdateSlot());
        }
        this.pumpUpdateQueue(scope);
      }
      this.pruneUpdateScopes();
    }, 60_000);
    this.updateSlotTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.updateSlotTimer) clearInterval(this.updateSlotTimer);
    this.updateSlotTimer = null;
  }

  private webBuildCache: { key: string; id: string } | null = null;

  private webIndexPath: string | null | undefined;

  /** 找到 web-dist/index.html。编译产物在 dist/agent/ 下，所以要逐层往上找。 */
  private findWebIndexFile(): string | null {
    if (this.webIndexPath !== undefined) return this.webIndexPath;
    let dir = __dirname;
    for (let depth = 0; depth < 5; depth += 1) {
      const candidate = path.join(dir, 'web-dist', 'index.html');
      if (fs.existsSync(candidate)) {
        this.webIndexPath = candidate;
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    this.webIndexPath = null;
    return null;
  }

  /**
   * 前端构建标识：下发给客户端，用来判断「有没有新版前端页面」。
   * 取自 web-dist 里真实的构建产物文件名（assets/index-<hash>.js）：
   * 只有真的发布了新的前端产物才会变；服务端重启、只重打后端都不会变。
   * 以前这里是 Date.now()，每次重启服务端都会变 → 所有客户端下一轮心跳就整页刷新，
   * 表现出来就是「动不动掉线」。
   */
  get deployId(): string {
    try {
      const indexPath = this.findWebIndexFile();
      if (!indexPath) return 'web-unknown';
      const stat = fs.statSync(indexPath);
      const key = `${stat.size}:${Math.round(stat.mtimeMs)}`;
      if (this.webBuildCache?.key === key) return this.webBuildCache.id;
      const html = fs.readFileSync(indexPath, 'utf8');
      const matched = html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
      const id = matched ? `web-${matched[1]}` : `web-${stat.size}-${Math.round(stat.mtimeMs)}`;
      this.webBuildCache = { key, id };
      return id;
    } catch {
      return 'web-unknown';
    }
  }

  /** 陪玩是否正在服务中（接单中/服务中）。正在服务时不刷客户端页面，避免打断。 */
  async isCompanionInService(companionId: string): Promise<boolean> {
    try {
      const [companion, running] = await Promise.all([
        this.prisma.companion.findUnique({ where: { id: companionId }, select: { status: true } }),
        this.prisma.orderSession.count({
          where: {
            status: 'ACTIVE',
            startedAt: { not: null },
            OR: [{ companionId }, { coCompanionId: companionId }],
          },
        }),
      ]);
      return companion?.status === 'BUSY' || running > 0;
    } catch {
      return false;
    }
  }

  constructor(private readonly prisma: PrismaService) {}

  async getAllOnlineCompanionIds(): Promise<string[]> {
    const companions = await this.prisma.companion.findMany({
      where: { status: { not: 'OFFLINE' } },
      select: { id: true },
    });
    return companions.map((c) => c.id);
  }

  /** 名额还在有效期内占着吗（预约的名额超时更短）。 */
  private slotBusy(scope: string): boolean {
    const slot = slotOf(scope);
    if (!slot.companionId) return false;
    const ttl = slot.reserved ? RESERVE_TTL_MS : UPDATE_SLOT_TIMEOUT;
    return Date.now() - slot.startedAt < ttl;
  }

  /** 这家店的更新名额现在是不是被占着（controller 叫号时用来跳过名额已满的店）。 */
  isUpdateScopeBusy(scope?: string): boolean {
    return this.slotBusy(scope || DEFAULT_UPDATE_SCOPE);
  }

  /**
   * 申请名额的机器属于哪家店（P0-6：名额按店隔离）。
   * 未登录的新机器（`anon:IP`）拿不到归属 → 落到空 scope（全网共用一个名额，保持老行为）。
   * 查库结果缓存 10 分钟：客户端每 5 分钟来问一次，不能每次都打库。
   */
  async resolveUpdateScope(companionId: string): Promise<string> {
    if (!companionId || companionId.startsWith('anon:')) return DEFAULT_UPDATE_SCOPE;
    const cached = this.updateScopeCache.get(companionId);
    if (cached && Date.now() - cached.at < UPDATE_SCOPE_TTL_MS) return cached.scope;
    let scope = DEFAULT_UPDATE_SCOPE;
    try {
      const rec = await this.prisma.companion.findUnique({
        where: { id: companionId },
        select: { studioId: true },
      });
      scope = rec?.studioId || DEFAULT_UPDATE_SCOPE;
    } catch (err: any) {
      // 查不到就把名额退回全网共享：不能让一次查询失败把整个更新链路卡死
      logger.warn(`resolveUpdateScope failed for ${companionId}: ${err?.message || err}`);
    }
    this.updateScopeCache.set(companionId, { scope, at: Date.now() });
    if (this.updateScopeCache.size > UPDATE_SCOPE_CACHE_MAX) this.pruneUpdateScopeCache();
    return scope;
  }

  /**
   * 叫号前先把名额留给被叫到的那台机器，别让它在错峰的那几十秒里被别人抢走。
   * 三分钟内没来申请就当它没收到，定时器会把名额放回队列。
   */
  reserveUpdateSlot(companionId: string, scope: string = DEFAULT_UPDATE_SCOPE): void {
    if (!companionId) return;
    const key = scope || DEFAULT_UPDATE_SCOPE;
    updateSlots.set(key, { companionId, startedAt: Date.now(), reserved: true });
    waitersOf(key).delete(companionId);
    logger.log(`Update slot reserved for ${companionId}${key ? ` @${key}` : ''}`);
  }

  /** 申请更新下载名额：同一时间每家店只放行一台；超时未释放则自动让给下一台。 */
  acquireUpdateSlot(
    companionId: string,
    scope: string = DEFAULT_UPDATE_SCOPE,
  ): { granted: boolean; waitingFor?: string } {
    const key = scope || DEFAULT_UPDATE_SCOPE;
    const now = Date.now();
    const slot = slotOf(key);
    const queue = waitersOf(key);
    if (this.slotBusy(key)) {
      if (slot.companionId === companionId) {
        // 自己预约/持有的名额：从「真的开始下载」这一刻重新计时。
        updateSlots.set(key, { companionId, startedAt: now, reserved: false });
        return { granted: true };
      }

      // 排队记账：每 5 分钟来申请一次却一直抢不到的机器（新装的机房电脑常常这样），
      // 等够 WAIT_PRIORITY_MS 就把名额让给它，避免老版本永远挂着不更新。
      const waiter = queue.get(companionId) || { firstAskedAt: now };
      queue.set(companionId, waiter);
      const waitedMs = now - waiter.firstAskedAt;
      const heldMs = now - slot.startedAt;
      // 预约不占着名额：客户端要是没来领，别拦着排队的机器等满 5 分钟。
      if (!slot.reserved && waitedMs >= WAIT_PRIORITY_MS && heldMs >= HOLD_MIN_MS) {
        logger.warn(`Update slot preempted for waiter ${companionId} (waited ${Math.round(waitedMs / 1000)}s)`);
        updateSlots.set(key, { companionId, startedAt: now, reserved: false });
        queue.delete(companionId);
        return { granted: true };
      }
      return { granted: false, waitingFor: slot.companionId };
    }
    updateSlots.set(key, { companionId, startedAt: now, reserved: false });
    queue.delete(companionId);
    return { granted: true };
  }

  /** 下载完成（或放弃）后释放名额。 */
  releaseUpdateSlot(companionId: string, scope: string = DEFAULT_UPDATE_SCOPE): void {
    const key = scope || DEFAULT_UPDATE_SCOPE;
    if (slotOf(key).companionId === companionId) {
      updateSlots.set(key, emptyUpdateSlot());
    }
    waitersOf(key).delete(companionId);
    // 名额空了：立刻叫下一位，别让它干等到下一次 30 分钟轮询。
    this.pumpUpdateQueue(key);
  }

  /** 当前名额状态（诊断/联调用）。scope 省略时看「未归属」那个共享名额。 */
  getUpdateSlot(scope: string = DEFAULT_UPDATE_SCOPE): {
    companionId: string;
    heldMs: number;
    waiters: number;
  } {
    const key = scope || DEFAULT_UPDATE_SCOPE;
    const slot = slotOf(key);
    return {
      companionId: slot.companionId,
      heldMs: slot.companionId ? Date.now() - slot.startedAt : 0,
      waiters: waitersOf(key).size,
    };
  }

  /** 所有店的名额快照（发布时盯铺开进度：哪家在下载、哪家还有几台在排队）。 */
  getUpdateScopes(): Array<{ scope: string; companionId: string; heldMs: number; waiters: number }> {
    const scopes = new Set<string>([...updateSlots.keys(), ...updateWaiters.keys()]);
    return [...scopes].map((scope) => ({ scope, ...this.getUpdateSlot(scope) }));
  }

  /** 取排队最久的一台（跳过没身份、推不了 WS 的匿名机器）。带 scope 就只在本店队列里挑。 */
  takeNextUpdateWaiter(scope?: string): UpdateWaiter | null {
    const pools: Array<[string, Map<string, { firstAskedAt: number }>]> =
      scope === undefined ? [...updateWaiters.entries()] : [[scope, waitersOf(scope)]];
    let next: UpdateWaiter | null = null;
    for (const [poolScope, queue] of pools) {
      for (const [companionId, waiter] of queue) {
        if (companionId.startsWith('anon:')) continue;
        if (!next || waiter.firstAskedAt < next.firstAskedAt) {
          next = { companionId, firstAskedAt: waiter.firstAskedAt, scope: poolScope };
        }
      }
    }
    if (next) waitersOf(next.scope).delete(next.companionId);
    return next;
  }

  /** 被跳过（例如正在接单）的机器放回队列，保留原来的排队时间，别让它排到队尾。 */
  requeueUpdateWaiter(waiter: UpdateWaiter): void {
    const queue = waitersOf(waiter.scope || DEFAULT_UPDATE_SCOPE);
    if (!queue.has(waiter.companionId)) {
      queue.set(waiter.companionId, { firstAskedAt: waiter.firstAskedAt });
    }
  }

  /** 名额一空就叫号（交给 controller，它才拿得到 WS 网关）。带 scope 就只按本店判断。 */
  pumpUpdateQueue(scope?: string): void {
    if (!this.updateNotifier) return;
    if (scope === undefined ? this.allUpdateScopesBusy() : this.slotBusy(scope)) return;
    void this.updateNotifier().catch((err) =>
      logger.warn(`Update queue pump failed: ${err?.message || err}`),
    );
  }

  /** 所有店的名额都占着 → 没得叫（一个 scope 都没有时按「没占」处理，保持老行为）。 */
  private allUpdateScopesBusy(): boolean {
    if (updateSlots.size === 0) return false;
    for (const scope of updateSlots.keys()) {
      if (!this.slotBusy(scope)) return false;
    }
    return true;
  }

  /** 清掉既没名额、也没人排队的 scope，别让 Map 无限长。 */
  private pruneUpdateScopes(): void {
    for (const scope of [...updateSlots.keys()]) {
      if (updateSlots.get(scope)?.companionId) continue;
      if ((updateWaiters.get(scope)?.size ?? 0) > 0) continue;
      updateSlots.delete(scope);
      updateWaiters.delete(scope);
    }
  }

  /** 归属缓存按 TTL 清一遍（只在超过上限时调用）。 */
  private pruneUpdateScopeCache(): void {
    const now = Date.now();
    for (const [companionId, entry] of [...this.updateScopeCache]) {
      if (now - entry.at >= UPDATE_SCOPE_TTL_MS) this.updateScopeCache.delete(companionId);
    }
    // 全都还在有效期内（同时上线的机器特别多）：清掉最旧的一半，别无限膨胀
    if (this.updateScopeCache.size > UPDATE_SCOPE_CACHE_MAX) {
      const oldest = [...this.updateScopeCache.entries()]
        .sort((a, b) => a[1].at - b[1].at)
        .slice(0, Math.ceil(this.updateScopeCache.size / 2));
      for (const [companionId] of oldest) this.updateScopeCache.delete(companionId);
    }
  }
  async getOnlineCompanionTargets(studioId?: string): Promise<
    Array<{
      companionId: string;
      name: string;
      status: string;
      agentVersion: string;
      lastHeartbeat: Date | null;
    }>
  > {
    const companions = await this.prisma.companion.findMany({
      where: {
        status: { not: 'OFFLINE' },
        ...(studioId ? { studioId } : {}),
      },
      select: {
        id: true,
        status: true,
        user: { select: { username: true, displayName: true } },
        pc: { select: { agentVersion: true, lastHeartbeat: true } },
      },
    });
    return companions.map((c) => ({
      companionId: c.id,
      name: c.user?.displayName || c.user?.username || c.id,
      status: c.status,
      agentVersion: c.pc?.agentVersion ?? '0.0.0',
      lastHeartbeat: c.pc?.lastHeartbeat ?? null,
    }));
  }

  async getCompanionTargetsByIds(ids: string[]): Promise<
    Array<{
      companionId: string;
      name: string;
      status: string;
      agentVersion: string;
      lastHeartbeat: Date | null;
    }>
  > {
    const companions = await this.prisma.companion.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        status: true,
        user: { select: { username: true, displayName: true } },
        pc: { select: { agentVersion: true, lastHeartbeat: true } },
      },
    });
    return companions.map((c) => ({
      companionId: c.id,
      name: c.user?.displayName || c.user?.username || c.id,
      status: c.status,
      agentVersion: c.pc?.agentVersion ?? '0.0.0',
      lastHeartbeat: c.pc?.lastHeartbeat ?? null,
    }));
  }

  async recordHeartbeat(companionId: string, agentVersion?: string) {
    return this.prisma.companionPC.upsert({
      where: { companionId },
      create: {
        companionId,
        agentVersion: agentVersion ?? '0.0.0',
        lastHeartbeat: new Date(),
        currentMode: 'ENTERTAINMENT',
        isThrottled: false,
        throttleLimitKB: null,
      },
      update: {
        agentVersion: agentVersion ?? undefined,
        lastHeartbeat: new Date(),
      },
    });
  }

  async getLatestVersion() {
    const [versionCfg, urlCfg] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'agent.latest_version' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'agent.latest_download_url' } }),
    ]);
    return {
      version: (versionCfg?.value as string) ?? '1.0.0',
      downloadUrl: (urlCfg?.value as string) ?? '/uploads/chunlv-latest.zip',
    };
  }

  async getCsLatestVersion() {
    const [versionCfg, urlCfg, zipCfg] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'cs.latest_version' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'cs.latest_download_url' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'cs.latest_zip_url' } }),
    ]);
    return {
      version: (versionCfg?.value as string) ?? '1.0.0',
      // 老客服端只认这个（NSIS 安装包，装的时候要点一次 UAC），先留着别动，
      // 免得还没升级的机器拿不到能跑的东西。
      downloadUrl: (urlCfg?.value as string) ?? '/api/agent/download/cs',
      // 新客服端优先用这个整包：交给看门狗（系统权限）解压换装，全程不弹授权。
      zipUrl: (zipCfg?.value as string) ?? '/api/agent/download/cs-zip',
    };
  }

  async getFrontendVersion() {
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: 'web.frontend_version' } });
    return { version: (cfg?.value as string) ?? '0' };
  }

  /**
   * 这条心跳到底是「客服端」还是「陪玩端」报的。
   *
   * 老板 2026-09-30 问「还谁不是全自动的」时，管理端「客服端版本」页给出的答案是
   * 「黄浩 未更新 / hanlei1 未更新」—— 假警报。根因：老板、店长用的是**陪玩端**
   * （只有陪玩账号走 WebSocket，他们这个窗口照样会报 cs-heartbeat，报的是陪玩端的
   * 版本号），而那一页对谁都照单全收。于是「客服端停在老版本」就被这种噪音淹没了。
   *
   * 判据：客户端显式上报 clientKind（新版本才有）优先；没有就回退看这台电脑在机器台账
   * 里登记的是不是陪玩端（同一台电脑 + 同一个登录账号）。
   */
  private async resolveCsClientKind(userId: string, reported?: string): Promise<'cs' | 'companion'> {
    const explicit = String(reported || '').trim().toLowerCase();
    if (explicit === 'cs' || explicit === 'companion') return explicit;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    if (!user?.username) return 'cs';
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: 'client.machine.' } },
      select: { value: true },
    });
    const runningCompanion = rows.some((row) => {
      const m: any = (row.value as any) || {};
      return String(m.loginUser || '') === user.username
        && String(m.clientType || '').toUpperCase() === 'COMPANION';
    });
    return runningCompanion ? 'companion' : 'cs';
  }

  async reportCsVersion(userId: string, version: string, meta: { ip?: string; clientKind?: string } = {}) {
    // 客服端心跳也算一次「见到他」，人员列表据此判断在线。
    presence.markSeen(userId);
    const kind = await this.resolveCsClientKind(userId, meta.clientKind);
    const value = {
      version,
      lastSeen: new Date().toISOString(),
      ip: String(meta.ip || ''),
      kind,
    };
    return this.prisma.systemConfig.upsert({
      where: { key: `cs.client.version.${userId}` },
      create: { key: `cs.client.version.${userId}`, value },
      update: { value },
    });
  }

  async listCsVersionStatus() {
    const records = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: 'cs.client.version.' } },
    });
    const users = await this.prisma.user.findMany({
      where: { role: { in: ['CS', 'ADMIN', 'OWNER'] } },
      select: { id: true, username: true, role: true },
    });
    const recordMap = new Map<string, { version?: string; lastSeen?: string; ip?: string; kind?: string }>();
    for (const r of records) {
      const userId = r.key.replace('cs.client.version.', '');
      recordMap.set(userId, (r.value as any) || {});
    }
    const [csLatest, companionLatest] = await Promise.all([
      this.getCsLatestVersion(),
      this.getLatestVersion(),
    ]);
    return users.map((u) => {
      const value = recordMap.get(u.id) || {};
      const version = value.version || null;
      // 老版本客户端没上报过身份：这种行按「客服端」显示，但沿用下面的口径判断新旧。
      const kind = value.kind === 'companion' ? 'companion' : 'cs';
      const latestVersion = kind === 'companion' ? companionLatest.version : csLatest.version;
      return {
        userId: u.id,
        username: u.username,
        role: u.role,
        clientKind: kind,
        version: version || '未登录',
        lastSeen: value.lastSeen || null,
        ip: value.ip || '',
        isLatest: version === latestVersion,
      };
    });
  }

  async getVersionStatus() {
    const companions = await this.prisma.companion.findMany({
      where: { status: { not: 'OFFLINE' } },
      select: {
        id: true,
        status: true,
        pc: { select: { agentVersion: true, lastHeartbeat: true } },
        user: { select: { username: true, displayName: true } },
      },
    });

    const latestVersion = (await this.getLatestVersion()).version;
    const list = companions.map((c) => ({
      companionId: c.id,
      name: c.user?.displayName || c.user?.username || c.id,
      status: c.status,
      agentVersion: c.pc?.agentVersion ?? '0.0.0',
      lastHeartbeat: c.pc?.lastHeartbeat ?? null,
      isLatest: (c.pc?.agentVersion ?? '0.0.0') === latestVersion,
    }));

    const onlineCount = companions.length;
    const upToDateCount = list.filter((c) => c.isLatest).length;

    return {
      latestVersion,
      onlineCount,
      upToDateCount,
      pendingCount: onlineCount - upToDateCount,
      list,
    };
  }

  getLatestExePath(): string {
    const projectRoot = path.resolve(process.cwd(), '../..');
    const exePath = path.join(projectRoot, 'uploads/agent-setup.exe');
    if (fs.existsSync(exePath)) return exePath;
    const releaseDir = path.join(projectRoot, 'apps/companion-electron/release');
    if (fs.existsSync(releaseDir)) {
      const files = fs.readdirSync(releaseDir);
      const exe = files.find((f) => f.endsWith('.exe'));
      if (exe) return path.join(releaseDir, exe);
    }
    return exePath;
  }

  getLatestZipPath(): string {
    const projectRoot = path.resolve(process.cwd(), '../..');
    const zipPath = path.join(projectRoot, 'uploads/chunlv-latest.zip');
    return zipPath;
  }

  /**
   * 客服端的「自动更新整包」（win-unpacked 的 zip）。
   * 陪玩端早就走这条路（SystemHelper 解压换装、不弹 UAC），客服端 2026-09-30 起一样。
   */
  getLatestCsZipPath(): string {
    const projectRoot = path.resolve(process.cwd(), '../..');
    return path.join(projectRoot, 'uploads/chunlv-cs-latest.zip');
  }

  getLatestCsExePath(): string {
    const projectRoot = path.resolve(process.cwd(), '../..');
    const exePath = path.join(projectRoot, 'uploads/agent-cs-setup.exe');
    if (fs.existsSync(exePath)) return exePath;
    const releaseDirs = [
      path.join(projectRoot, 'apps/cs-electron/release4'),
      path.join(projectRoot, 'apps/cs-electron/release'),
    ];
    for (const releaseDir of releaseDirs) {
      if (!fs.existsSync(releaseDir)) continue;
      const files = fs.readdirSync(releaseDir);
      const exe = files.find((f) => f.endsWith('.exe'));
      if (exe) return path.join(releaseDir, exe);
    }
    return exePath;
  }

  /**
   * Generate a PowerShell one-liner that downloads and installs the agent on a new PC.
   * The server URL is embedded so the client auto-connects after install.
   */
  generateDeployScript(serverUrl: string): string {
    const apiUrl = this.sanitizeServerUrl(serverUrl);
    const installerUrl = this.escapePowerShellLiteral(`${apiUrl}/api/agent/download/exe`);
    return [
      `$url = ${installerUrl}`,
      `$out = "$env:TEMP\\ChunlvAgent-Setup.exe"`,
      `Write-Host "正在下载陪玩管理客户端..." -ForegroundColor Cyan`,
      `Invoke-WebRequest -Uri $url -OutFile $out`,
      `Write-Host "正在安装..." -ForegroundColor Yellow`,
      `Start-Process -FilePath $out -ArgumentList "/S" -Wait`,
      `Remove-Item $out -Force`,
      `Write-Host "安装完成！请从桌面启动 陪玩管理" -ForegroundColor Green`,
    ].join('\n');
  }

  /**
   * Generate a PowerShell script that uses PsExec to remotely install the agent
   * on multiple target PCs. Admin runs this script from their Windows machine.
   */
  generateRemoteDeployScript(params: {
    targetIPs: string[];
    adminUser: string;
    adminPass: string;
    serverUrl: string;
  }): string {
    const { targetIPs, adminUser, adminPass, serverUrl } = params;
    const apiUrl = this.sanitizeServerUrl(serverUrl);
    const serverUrlLiteral = this.escapePowerShellLiteral(apiUrl);
    const adminUserLiteral = this.escapePowerShellLiteral(adminUser);
    const adminPassLiteral = this.escapePowerShellLiteral(adminPass);
    const ipsJson = JSON.stringify(targetIPs);

    return [
      `# ============================================`,
      `# 陪玩管理 - 远程批量部署脚本 (PsExec)`,
      `# 生成时间: ${new Date().toISOString()}`,
      `# 目标数量: ${targetIPs.length} 台电脑`,
      `# ============================================`,
      ``,
      `$serverUrl = ${serverUrlLiteral}`,
      `$targets = ${ipsJson}`,
      `$adminUser = ${adminUserLiteral}`,
      `$adminPass = ${adminPassLiteral}`,
      `$installerUrl = "$serverUrl/api/agent/download/exe"`,
      ``,
      `# 检查 PsExec 是否存在，没有则自动下载`,
      `if (!(Test-Path ".\\PsExec.exe")) {`,
      `    Write-Host "正在下载 PsExec (Sysinternals)..." -ForegroundColor Yellow`,
      `    Invoke-WebRequest -Uri "https://download.sysinternals.com/files/PSTools.zip" -OutFile "PSTools.zip"`,
      `    Expand-Archive -Path "PSTools.zip" -DestinationPath ".\\PSTools" -Force`,
      `    Copy-Item ".\\PSTools\\PsExec.exe" -Destination ".\\PsExec.exe"`,
      `    Remove-Item "PSTools.zip" -Recurse -Force`,
      `    Write-Host "PsExec 准备就绪" -ForegroundColor Green`,
      `}`,
      ``,
      `Write-Host ""`,
      `Write-Host "========================================" -ForegroundColor Cyan`,
      `Write-Host "  开始批量部署 - 共 $($targets.Count) 台电脑" -ForegroundColor Cyan`,
      `Write-Host "========================================" -ForegroundColor Cyan`,
      `Write-Host ""`,
      ``,
      `$successCount = 0`,
      `$failCount = 0`,
      `$results = @()`,
      ``,
      `foreach ($ip in $targets) {`,
      `    $ip = $ip.Trim()`,
      `    if ([string]::IsNullOrEmpty($ip)) { continue }`,
      ``,
      `    Write-Host "[$ip] 正在连接..." -ForegroundColor Cyan`,
      ``,
      `    try {`,
      `        # Test connectivity first`,
      `        $ping = Test-Connection -ComputerName $ip -Count 1 -Quiet`,
      `        if (-not $ping) {`,
      `            Write-Host "[$ip] ✗ 无法 ping 通，跳过" -ForegroundColor Red`,
      `            $failCount++`,
      `            $results += @{ IP = $ip; Status = "FAIL"; Reason = "Ping failed" }`,
      `            continue`,
      `        }`,
      ``,
      `        # Step 1: Download installer to target PC`,
      `        $dlCmd = "Invoke-WebRequest -Uri '$installerUrl' -OutFile ` + '`' + `$env:TEMP\\ChunlvAgent-Setup.exe"`,
      ``,
      `        Write-Host "[$ip] 正在下载安装包..." -ForegroundColor Yellow`,
      `        $dlResult = .\\PsExec.exe \\\\$ip -u $adminUser -p $adminPass -accepteula -nobanner powershell -Command $dlCmd 2>&1`,
      ``,
      `        if ($LASTEXITCODE -ne 0) {`,
      `            Write-Host "[$ip] ✗ 下载失败 (PsExec exit=$LASTEXITCODE)" -ForegroundColor Red`,
      `            Write-Host "    详情: $dlResult" -ForegroundColor DarkYellow`,
      `            Write-Host "    提示: 请确认目标电脑能访问 $installerUrl" -ForegroundColor DarkYellow`,
      `            $failCount++`,
      `            $results += @{ IP = $ip; Status = "FAIL"; Reason = "Download failed: $dlResult" }`,
      `            continue`,
      `        }`,
      ``,
      `        # Step 2: Run silent install`,
      `        Write-Host "[$ip] 正在安装..." -ForegroundColor Yellow`,
      `        $installCmd = "Start-Process ` + '`' + `$env:TEMP\\ChunlvAgent-Setup.exe -ArgumentList '/S' -Wait"`,
      `        $installResult = .\\PsExec.exe \\\\$ip -u $adminUser -p $adminPass -i -accepteula -nobanner powershell -Command $installCmd 2>&1`,
      ``,
      `        if ($LASTEXITCODE -ne 0) {`,
      `            Write-Host "[$ip] ✗ 安装失败" -ForegroundColor Red`,
      `            $failCount++`,
      `            $results += @{ IP = $ip; Status = "FAIL"; Reason = "Install failed: $installResult" }`,
      `            continue`,
      `        }`,
      ``,
      `        # Step 3: Show the app window on target PC`,
      `        Write-Host "[$ip] 正在启动客户端..." -ForegroundColor Yellow`,
      `        $showCmd = "Start-Process 'C:\\Program Files\\陪玩管理\\陪玩管理.exe'"`,
      `        .\\PsExec.exe \\\\$ip -u $adminUser -p $adminPass -d -i -accepteula -nobanner powershell -Command $showCmd 2>&1 | Out-Null`,
      ``,
      `        Write-Host "[$ip] ✓ 安装成功，客户端已启动" -ForegroundColor Green`,
      `        $successCount++`,
      `        $results += @{ IP = $ip; Status = "OK"; Reason = "Installed and running" }`,
      `    } catch {`,
      `        Write-Host "[$ip] ✗ 异常: $_" -ForegroundColor Red`,
      `        $failCount++`,
      `        $results += @{ IP = $ip; Status = "FAIL"; Reason = "$_" }`,
      `    }`,
      ``,
      `    Write-Host ""`,
      `}`,
      ``,
      `Write-Host "========================================" -ForegroundColor Cyan`,
      `Write-Host "  部署完成" -ForegroundColor Cyan`,
      `Write-Host "  成功: $successCount / $($targets.Count)" -ForegroundColor Green`,
      `if ($failCount -gt 0) { Write-Host "  失败: $failCount" -ForegroundColor Red }`,
      `Write-Host "========================================" -ForegroundColor Cyan`,
      ``,
      `# 输出结果表`,
      `$results | Format-Table -AutoSize`,
    ].join('\n');
  }

  async buildAndPush(): Promise<{ success: boolean; version: string; output: string }> {
    // Server runs from apps/server/, so ../.. reaches the monorepo root
    const projectRoot = path.resolve(process.cwd(), '../..');

    try {
      logger.log('Step 1/4: git pull...');
      await execAsync('git pull', { cwd: projectRoot });

      logger.log('Step 2/4: pnpm install...');
      await execAsync('pnpm install', { cwd: projectRoot });

      logger.log('Step 3/4: electron-builder build...');
      const electronDir = path.join(projectRoot, 'apps/companion-electron');
      await execAsync('npx electron-builder --win --x64', {
        cwd: electronDir,
        env: { ...process.env, CI: 'true' },
      });

      logger.log('Step 4/5: copy installer + generate auto-update zip...');
      const releaseDir = path.join(electronDir, 'release');
      const files = fs.readdirSync(releaseDir);
      const setupExe = files.find((f) => f.endsWith('.exe'));
      if (!setupExe) {
        return { success: false, version: '', output: '构建完成但未找到 exe 文件' };
      }

      const srcPath = path.join(releaseDir, setupExe);
      const destDir = path.join(projectRoot, 'uploads');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcPath, path.join(destDir, 'agent-setup.exe'));

      // 自动更新走 SystemHelper 服务：它按 zip 解压 win-unpacked 覆盖安装目录。
      // 如果这里只发布 exe 安装器，SystemHelper 会把 exe 当 zip 解压失败，陷入反复下载/退出/重启的死循环。
      const winUnpackedDir = path.join(releaseDir, 'win-unpacked');
      if (!fs.existsSync(winUnpackedDir)) {
        return { success: false, version: '', output: '构建完成但未找到 win-unpacked 目录' };
      }
      const zipName = 'chunlv-latest.zip';
      const zipLocal = path.join(releaseDir, zipName);
      await execAsync(`rm -f "${zipLocal}" && zip -r "${zipLocal}" win-unpacked/ -q`, {
        cwd: releaseDir,
      });
      fs.copyFileSync(zipLocal, path.join(destDir, zipName));

      const pkgJson = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf-8'));
      const version = pkgJson.version || '1.0.0';

      await this.prisma.systemConfig.upsert({
        where: { key: 'agent.latest_version' },
        create: { key: 'agent.latest_version', value: version },
        update: { value: version },
      });
      await this.prisma.systemConfig.upsert({
        where: { key: 'agent.latest_download_url' },
        create: { key: 'agent.latest_download_url', value: '/uploads/chunlv-latest.zip' },
        update: { value: '/uploads/chunlv-latest.zip' },
      });

      logger.log(`Build complete: version ${version}`);
      return { success: true, version, output: `构建成功: ${setupExe}` };
    } catch (err: any) {
      logger.error('Build failed', err.stderr || err.message);
      return {
        success: false,
        version: '',
        output: err.stderr || err.message || '构建失败',
      };
    }
  }

  /**
   * Execute remote deployment from the server using impacket's psexec.py.
   * No manual steps needed — the server reaches out to each target Windows PC directly.
   */
  async executeRemoteDeploy(params: {
    targetIPs: string[];
    adminUser: string;
    adminPass: string;
    serverUrl: string;
  }): Promise<{ success: boolean; results: { ip: string; status: string; reason: string }[] }> {
    const { targetIPs, adminUser, adminPass, serverUrl } = params;
    const apiUrl = this.sanitizeServerUrl(serverUrl);
    const psexecCandidates = [
      '/usr/local/bin/psexec.py',
      '/usr/share/impacket-scripts/psexec.py',
      '/usr/bin/psexec.py',
      '/usr/share/doc/python3-impacket/examples/psexec.py',
    ];
    const psexec = psexecCandidates.find((p) => fs.existsSync(p)) || psexecCandidates[0];
    const results: { ip: string; status: string; reason: string }[] = [];

    // Write a small PowerShell script that psexec.py will copy & execute on target
    const psScriptPath = '/tmp/chunlv-deploy.ps1';
    const installerUrl = this.escapePowerShellLiteral(`${apiUrl}/api/agent/download/exe`);
    const psContent = [
      `$url = ${installerUrl}`,
      `$out = "$env:TEMP\\ChunlvAgent-Setup.exe"`,
      `Write-Host "Downloading..."`,
      `Invoke-WebRequest -Uri $url -OutFile $out`,
      `Write-Host "Installing..."`,
      `Start-Process $out -ArgumentList '/S' -Wait`,
      `Write-Host "Starting..."`,
      `Start-Process "C:\\Program Files\\陪玩管理\\陪玩管理.exe"`,
    ].join('\n');
    fs.writeFileSync(psScriptPath, psContent, 'utf-8');

    // Validate inputs to prevent command injection
    const safeUser = /^[a-zA-Z0-9_.\\-]+$/.test(adminUser) ? adminUser : 'Administrator';
    const safePass = /^[a-zA-Z0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?/~` ]+$/.test(adminPass) ? adminPass : '';
    if (adminUser !== safeUser || adminPass !== safePass) {
      logger.warn('Admin credentials contained unsafe characters, using sanitized values');
    }

    for (const ip of targetIPs) {
      const trimmed = ip.trim();
      if (!trimmed || !/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(trimmed)) continue;

      logger.log(`Deploying to ${trimmed}...`);
      try {
        // psexec.py -c copies the script to target and executes it via powershell
        const creds = safePass ? `${safeUser}:${safePass}@${trimmed}` : `${safeUser}@${trimmed}`;
        const noPassFlag = safePass ? '' : ' -no-pass';
        const remoteCommand = 'powershell -ExecutionPolicy Bypass -File %TEMP%\\chunlv-deploy.ps1';
        const args = [psexec];
        if (noPassFlag) args.push('-no-pass');
        args.push('-c', psScriptPath, creds, remoteCommand);

        const { stdout, stderr } = await execFileAsync('python3', args, { timeout: 180_000 });
        const output = stdout + (stderr || '');

        if (output.includes('Error') || output.includes('Exception')) {
          results.push({ ip: trimmed, status: 'FAIL', reason: output.slice(0, 300) });
        } else {
          results.push({ ip: trimmed, status: 'OK', reason: 'Installed and started' });
        }
      } catch (err: any) {
        const msg = err.stderr || err.message || 'Unknown';
        results.push({ ip: trimmed, status: 'FAIL', reason: msg.slice(0, 300) });
      }
    }

    try {
      fs.unlinkSync(psScriptPath);
    } catch {
      /* ok */
    }

    const okCount = results.filter((r) => r.status === 'OK').length;
    logger.log(`Remote deploy complete: ${okCount}/${results.length} OK`);
    return { success: okCount > 0, results };
  }

  /**
   * 新电脑装完机后上报自己的远程管理账号。
   * 写入 repo 根目录下的 onboard-reports/machines.jsonl（不在 /uploads 下面，公网下不到），
   * 管理员需要时直接读这个文件即可，不用再问电脑主人要密码。
   */
  recordOnboardReport(payload: any): { saved: boolean; at: string; file: string } {
    const clean = (v: unknown, max: number) => String(v ?? '').slice(0, max);
    const record = {
      at: new Date().toISOString(),
      hostname: clean(payload?.hostname, 100),
      ip: clean(payload?.ip, 64),
      mac: clean(payload?.mac, 64),
      account: clean(payload?.account, 64),
      password: clean(payload?.password, 128),
      version: clean(payload?.version, 64),
      source: clean(payload?.source, 64),
    };
    const dir = this.resolveOnboardReportDir();
    const file = path.join(dir, 'machines.jsonl');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
      logger.log(`Onboard report saved: ${record.hostname} ${record.ip} ${record.account}`);
      return { saved: true, at: record.at, file };
    } catch (err: any) {
      logger.error(`Onboard report failed: ${err?.message || err}`);
      return { saved: false, at: record.at, file };
    }
  }

  /**
   * 前端报上来的「网络层故障」。
   *
   * 老板 2026-09-21 报「新电脑注册点了提交提示 Network Error」，服务端日志里连请求都没有
   * （浏览器/Electron 在发出去之前就失败了），只看服务端永远查不到原因。前端在 catch 里
   * 把这条记录回传上来，落到 client-errors/ 下面，管理员可以直接读文件定位。
   */
  recordClientError(payload: any): { saved: boolean; at: string; file: string } {
    const clean = (v: unknown, max: number) => String(v ?? '').slice(0, max);
    const record = {
      at: new Date().toISOString(),
      ip: clean(payload?.ip, 64),
      user: clean(payload?.user, 64),
      role: clean(payload?.role, 32),
      appVersion: clean(payload?.appVersion, 64),
      page: clean(payload?.page, 200),
      url: clean(payload?.url, 300),
      phase: clean(payload?.phase, 120),
      status: typeof payload?.status === 'number' ? payload.status : null,
      message: clean(payload?.message, 500),
      detail: clean(payload?.detail, 1200),
      ua: clean(payload?.ua, 400),
    };
    const dir = this.resolveDataDir('client-errors');
    const day = record.at.slice(0, 10);
    const file = path.join(dir, `client-errors-${day}.jsonl`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
      logger.warn(`Client error reported: [${record.phase}] ${record.url} ${record.message}`);
      return { saved: true, at: record.at, file };
    } catch (err: any) {
      logger.error(`Client error report failed: ${err?.message || err}`);
      return { saved: false, at: record.at, file };
    }
  }

  /** 装机上报目录：和 uploads 同级（部署在 repo 根目录），找不到就退回系统临时目录。 */
  private resolveOnboardReportDir(): string {
    return this.resolveDataDir('onboard-reports');
  }

  /**
   * 运维诊断回传：一键修复脚本 / 看门狗把「机器上现在到底是什么状态」整段传上来。
   *
   * 为什么需要：2026-09-23 陈佳祺那台机器「双击桌面图标没反应」，客户端进程根本没起来，
   * 服务端日志里连一条请求都没有 —— 只能靠人去那台机器上看目录、看 service.log。
   * 以后机器上的故障现场直接落到 onboard-reports/diag/ 下，管理员在云服务器上就能看。
   */
  recordDiagReport(payload: any): { saved: boolean; at: string; file: string } {
    const clean = (v: unknown, max: number) => String(v ?? '').slice(0, max);
    const at = new Date().toISOString();
    const hostname = clean(payload?.hostname, 100) || 'unknown';
    const source = clean(payload?.source, 64) || 'diag';
    const lines = String(payload?.lines ?? '').slice(0, 200_000);
    const dir = path.join(this.resolveOnboardReportDir(), 'diag');
    const stamp = at.replace(/[:.]/g, '-');
    const file = path.join(dir, `${hostname}-${stamp}-${source}.log`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const header = [
        `at=${at}`,
        `hostname=${hostname}`,
        `source=${source}`,
        `ip=${clean(payload?.ip, 64)}`,
        `version=${clean(payload?.version, 64)}`,
        '',
      ].join('\n');
      fs.writeFileSync(file, header + lines + '\n', 'utf8');
      logger.warn(`DIAG report received: ${hostname} [${source}] ${lines.length} chars`);
      return { saved: true, at, file };
    } catch (err: any) {
      logger.error(`Diag report failed: ${err?.message || err}`);
      return { saved: false, at, file };
    }
  }

  /** 数据落盘目录：和 uploads 同级（部署在 repo 根目录），公网下不到，找不到就退回系统临时目录。 */
  private resolveDataDir(name: string): string {
    let dir = __dirname;
    for (let depth = 0; depth < 6; depth += 1) {
      if (fs.existsSync(path.join(dir, 'uploads'))) {
        return path.join(dir, name);
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return path.join(os.tmpdir(), `chunlv-${name}`);
  }

  private escapePowerShellLiteral(value: string): string {
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private sanitizeServerUrl(input: string): string {
    const fallback = 'http://127.0.0.1:3001';
    const candidate = input?.trim();
    if (!candidate) return fallback;

    try {
      const url = new URL(candidate);
      const safeHost = /^[a-zA-Z0-9.:[\]-]+$/.test(url.host);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && safeHost) {
        return `${url.protocol}//${url.host}`;
      }
    } catch {
      // Fall back to localhost for invalid URLs.
    }

    return fallback;
  }
}
