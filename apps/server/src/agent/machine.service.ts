// craftsman-ignore: TS001,TS003
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { buildClientDiagScript, CLIENT_DIAG_SCRIPT_VERSION, CLIENT_DIAG_PS } from './client-diag';
import { buildEnableRemoteScript, CLIENT_ENABLE_REMOTE_PS } from './client-remote';
import { ONBOARD_REPORT_TOKEN } from './agent-token';

/**
 * 这条台账是客户端自己的心跳写的，还是运维脚本写的？
 * 客户端来源：`cs-client` / `companion-client` / `client`（旧记录可能为空）；
 * 脚本来源：`enable-remote` / `repair-*` 之类（装机脚本、一键修复脚本）。
 */
function isClientSource(source: unknown): boolean {
  const value = String(source ?? '').trim();
  return !value || value === 'client' || /-client$/.test(value);
}

/**
 * 这一行是不是「机器自己报的」（客户端心跳 / 看门狗）。
 *
 * 为什么要跟 `isClientSource` 分开（2026-10-01 踩过）：看门狗上报的 source 是 `watchdog`，
 * 它上报时会**写进客户端那一行**（同一台机器只能有一行）—— 于是那一行的 `lastSource`
 * 从 `companion-client` 变成了 `watchdog`。而运维脚本认领「客户端那一行」时用的是
 * `/-client$/`，认不出来了，结果脚本那份又在台账里另起一行，
 * 一台机器两条记录（PC-20260409CDBJ 现场）。看门狗报的也是这台机器自己，算数。
 */
function isMachineSelfSource(source: unknown): boolean {
  return isClientSource(source) || String(source ?? '').trim() === 'watchdog';
}

/**
 * 客户端机器台账 + 远程任务队列。
 *
 * 为什么要有这个（老板 2026-09-30）：
 * 「只有陪玩电脑能被我们远程管理，客服电脑（邵泽慧、孙可馨那两台）我们完全看不见 ——
 *   她们机器一出问题我们只能等人到电脑跟前。」老板要求所有客户端机器都能被远程查看 / 一键诊断。
 *
 * 关键技术前提：这些机器都在各自的小局域网里（192.168.1.x 之类），**云服务器直连不到**。
 * 所以远程查看只能反过来做：客户端自己定时把「我是谁、我在哪、我什么版本、我好不好」报上来，
 * 服务端把要做的诊断/指令排进队列，客户端下一轮心跳领走、执行、把报告传回来。
 * 这条链路不依赖任何中继机，也不需要客户端开端口。
 *
 * 数据存放：直接复用已有的 SystemConfig(key/value jsonb) 表，不新增表、不动 schema，
 * 避免为了这个功能再跑一次线上数据库迁移（迁移出错会打断正在接单的陪玩）。
 *   client.machine.<machineId>  → 一台机器的台账
 *   client.task.<taskId>        → 一条远程任务（诊断 / 指令 / 开通远程管理）
 * 报告正文落到 onboard-reports/diag/ 下（和 uploads 同级，公网下不到）。
 */

@Injectable()
export class MachineService {
  private readonly logger = new Logger(MachineService.name);

  /** 心跳窗口：超过这么久没上报就算离线。客服端/陪玩端都是 5 分钟一报。 */
  private static readonly ONLINE_WINDOW_MS = 5 * 60 * 1000;
  /** 任务派下去多久没回来算过期（客户端关机/断网了就永远不会回来）。 */
  private static readonly TASK_TIMEOUT_MS = 15 * 60 * 1000;
  /** 看门狗（SYSTEM 服务）每分钟来一次；超过这么久没来就认为它不在了，任务退回给客户端。 */
  private static readonly SYSTEM_POLL_WINDOW_MS = 3 * 60 * 1000;
  /** 台账里最多留多少条任务，超了就删最老的。 */
  private static readonly MAX_TASKS = 400;

  constructor(private readonly prisma: PrismaService) {}

  // ── 台账 ────────────────────────────────────────────────────────────────

  /** 客户端上报自己是谁。同一个 machineId 覆盖更新，不新增行。 */
  async reportMachine(payload: any): Promise<{ machineId: string; lastSeenAt: string }> {
    const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
    const source = clean(payload?.source, 60) || 'client';
    const hostname = clean(payload?.hostname, 120);
    const primaryIp = clean(payload?.primaryIp, 64);
    let machineId = clean(payload?.machineId, 120) || hostname.toLowerCase();
    const now = new Date();
    let before = await this.readMachine(machineId);
    // 只有「运维脚本」上报才做归并；客户端自己的心跳永远以自己的 machineId 为准，
    // 否则一台机器换过网卡之后两个 id 会互相抢写。
    const fromScript = !isClientSource(source);
    if (fromScript) {
      const canonical = await this.pickCanonicalMachine(hostname, primaryIp);
      if (canonical?.machineId && canonical.machineId !== machineId) {
        this.logger.warn(
          `运维脚本（${source}）算出的 machineId ${machineId} 与客户端台账 ${canonical.machineId} 不一致`
            + `（同一台机器：主机名 ${hostname} + 主 IP ${primaryIp}），写回客户端那一行`,
        );
        await this.dropStrayScriptRow(machineId, String(canonical.machineId), hostname);
        machineId = String(canonical.machineId);
        before = canonical;
      }
    }
    const record: any = {
      machineId,
      clientType: clean(payload?.clientType, 16) || before?.clientType || 'UNKNOWN',
      // 机器指纹（主机名 / IP / MAC / 网卡列表 / 系统 / 版本）以**客户端心跳**为准：
      // 运维脚本取的是「第一块 Up 的网卡」，客户端取的是「第一块非虚拟网卡」，
      // 两者在带虚拟网卡的机器上不一样（2026-09-30 实拍：脚本报 192.168.81.1，
      // 客户端报 192.168.0.140）。脚本只负责把账号口令这类信息带回来。
      hostname: fromScript && before?.hostname ? before.hostname : clean(payload?.hostname, 120) || before?.hostname || '',
      windowsUser: clean(payload?.windowsUser, 120) || before?.windowsUser || '',
      loginUser: clean(payload?.loginUser, 60) || before?.loginUser || '',
      loginRole: clean(payload?.loginRole, 20) || before?.loginRole || '',
      ips: fromScript && before?.ips?.length
        ? before.ips
        : Array.isArray(payload?.ips) ? payload.ips.map((v: unknown) => clean(v, 64)).slice(0, 12) : before?.ips || [],
      primaryIp: fromScript && before?.primaryIp ? before.primaryIp : clean(payload?.primaryIp, 64) || before?.primaryIp || '',
      mac: fromScript && before?.mac ? before.mac : clean(payload?.mac, 64) || before?.mac || '',
      os: fromScript && before?.os ? before.os : clean(payload?.os, 160) || before?.os || '',
      appVersion: fromScript && before?.appVersion ? before.appVersion : clean(payload?.appVersion, 60) || before?.appVersion || '',
      agentBuild: clean(payload?.agentBuild, 60) || before?.agentBuild || '',
      remoteReady: payload?.remoteReady === undefined ? !!before?.remoteReady : !!payload?.remoteReady,
      remoteAccount: clean(payload?.remoteAccount, 60) || before?.remoteAccount || '',
      remotePassword: clean(payload?.remotePassword, 120) || before?.remotePassword || '',
      // 看门狗（SystemHelper）自己的构建号。客户端每 5 分钟报一次、看门狗每 1 分钟报一次，
      // 台账里留着它，「这台机器的看门狗停在老版本」就不用人一台台去问。
      watchdogBuild: clean(payload?.watchdogBuild, 40) || before?.watchdogBuild || '',
      // 看门狗是 SYSTEM 服务，它每分钟来报一次；这个时间戳决定「任务交给谁执行」。
      systemPollAt: payload?.systemPoller ? now.toISOString() : before?.systemPollAt || '',
      firstSeenAt: before?.firstSeenAt || now.toISOString(),
      lastSeenAt: now.toISOString(),
      lastSource: clean(payload?.source, 60) || 'client',
    };
    if (record.remotePassword && !record.remoteReady) record.remoteReady = true;
    await this.prisma.systemConfig.upsert({
      where: { key: `client.machine.${machineId}` },
      create: { key: `client.machine.${machineId}`, value: record },
      update: { value: record },
    });
    this.logger.log(`机器上报: ${record.hostname}[${record.clientType}] ${record.primaryIp} v${record.appVersion}`);
    // 客户端本人来报：顺手清掉运维脚本在这台机器名下留下的重复台账行（2026-10-01 现场：
    // PC-20260409CDBJ 台账里挂着两条，一条是客户端/看门狗的、一条是「开通远程管理」脚本留下的）。
    // 不 await —— 清理出问题绝不许影响客户端心跳。
    if (!fromScript) void this.sweepScriptRows(record.hostname, machineId, record.ips).catch(() => {});
    // 上报即自愈：远程管理没开、看门狗不是最新，就顺手派一条任务补上（老板 2026-10-01：
    // 「以后都弄全自动」）。不 await —— 自愈出问题绝不许影响客户端心跳。
    void this.autoHeal(record).catch(() => {});
    return { machineId, lastSeenAt: record.lastSeenAt };
  }

  private async readMachine(machineId: string): Promise<any | null> {
    if (!machineId) return null;
    const row = await this.prisma.systemConfig.findUnique({ where: { key: `client.machine.${machineId}` } });
    return (row?.value as any) || null;
  }

  /**
   * 同一台机器的「客户端台账行」是谁。
   *
   * 客户端和运维脚本（开通远程管理 / 一键修复）各算一个 machineId：
   *   客户端按网卡枚举顺序取第一块非虚拟网卡的 MAC（`os.networkInterfaces()`），
   *   脚本按「第一块 Up 的网卡」取 MAC（`Get-NetAdapter | Where Status -eq 'Up' | Select -First 1`）。
   * 2026-09-30 实拍：客服机 PC-20230107AFUW 客户端算出 …-00ff25fe4260、脚本算出 …-0ae0afa217ff，
   * 于是台账里多出一行 —— 「开通远程管理」回传的账号口令落在多出来的那一行上，
   * 客户端那一行永远显示「未开通」，管理端还会看到同一台机器两条记录。
   *
   * 认领规则（两道，越靠前越可信）：
   *   ① **主机名 + 主 IP 都对得上**（不能只按主机名 —— 局域网里有 4 台机器都叫
   *      `User-20240831VS`，IP 各不相同）；
   *   ② 主机名一样、而且**这台机器名下只有一条客户端心跳写过的行** —— 也认它。
   *      2026-09-30 实拍：`PC-20260409CDBJ` 带 VMware 虚拟网卡，客户端报 192.168.0.140、
   *      脚本报 192.168.81.1，①永远对不上，台账里就一直挂着两条记录、
   *      「开通远程管理」的口令落在脚本那一行、客户端那一行显示未开通。
   *      只有唯一一条客户端行时才认，所以「4 台同名机器」那种仍然各归各的。
   * 有「客户端心跳写过的那一行」就优先认它（`lastSource` 是 `cs-client` / `companion-client`），
   * 没有才退而用已有那一行（全新机器连脚本一起装的情况）。
   */
  private async pickCanonicalMachine(hostname: string, primaryIp: string): Promise<any | null> {
    if (!hostname || !primaryIp) return null;
    const rows = await this.prisma.systemConfig.findMany({ where: { key: { startsWith: 'client.machine.' } } });
    const host = hostname.toLowerCase();
    const sameHost = rows
      .map((row) => (row.value as any) || {})
      .filter((value: any) => String(value.hostname || '').toLowerCase() === host);
    if (!sameHost.length) return null;
    // 只认「客户端心跳明确写过 source」的行（scripts 走的是 enable-remote / diag 之类）。
    const clientRows = sameHost.filter((value: any) => isMachineSelfSource(value.lastSource));
    // 这台机器名下只有一条客户端行：主机名对上就认它（IP 可能因为虚拟网卡不一样）
    if (clientRows.length === 1) return clientRows[0];
    const sameIp = sameHost.filter((value: any) => String(value.primaryIp || '') === primaryIp);
    const ipClient = sameIp.find((value: any) => isMachineSelfSource(value.lastSource));
    if (ipClient) return ipClient;
    // 同名机器不止一台：只能靠 IP 认，IP 也对不上就别猜（宁可在台账里多一行）
    if (clientRows.length > 1) return null;
    return sameIp[0] ?? null;
  }

  /**
   * 运维脚本自己算出来的那一行（例如 `…-005056c00008`，VMware 网卡那份）如果只是同一台
   * 机器名下、没有任何客户端心跳写过的痕迹，就顺手删掉 —— 否则「机器管理」里同一台电脑
   * 永远挂着两条记录，一条「已开通远程管理」、另一条写着「未开通」。
   */
  private async dropStrayScriptRow(
    strayId: string,
    canonicalId: string,
    hostname: string,
    known?: any,
  ): Promise<void> {
    if (!strayId || strayId === canonicalId) return;
    const stray = known ?? (await this.readMachine(strayId));
    if (!stray) return;
    if (String(stray.hostname || '').toLowerCase() !== String(hostname || '').toLowerCase()) return;
    // 有客户端心跳或版本号 = 那是真客户端注册的行，不能删
    if (isMachineSelfSource(stray.lastSource) || stray.appVersion) return;
    try {
      await this.prisma.systemConfig.delete({ where: { key: `client.machine.${strayId}` } });
      this.logger.warn(`已清掉运维脚本留下的重复台账行 ${strayId}（同一台机器 ${hostname}，客户端那一行是 ${canonicalId}）`);
    } catch {
      // 删不掉不影响这次上报：下一轮心跳还会再试
    }
  }

  /**
   * 客户端本人上报时，把「运维脚本留下、但没有任何客户端心跳痕迹」的重复台账行清掉。
   *
   * 2026-10-01 现场：`PC-20260409CDBJ`（黄浩）台账里两条记录，一条是客户端/看门狗的、
   * 另一条是「开通远程管理」脚本按「第一块 Up 的网卡」（VMware 虚拟网卡）算出来的 id。
   * 只靠脚本下次运行去归并是不够的 —— 脚本是人点一次才跑一次；客户端每 5 分钟都来，
   * 让它顺手把这类残留清掉，台账就不会一直挂着两条、管理端也不会一条「已开通」一条「未开通」。
   *
   * 三道闸都满足才删（宁可留一条，也不误删真客户端）：
   *   ① 主机名一样、machineId 不是这次上报的这台；
   *   ② 这一行没有被客户端/看门狗写过的痕迹，也没带回 appVersion；
   *   ③ 这一行的 IP 和这台机器的 IP 有交集 —— 局域网里有 4 台机器都叫 `User-20240831VS`，
   *      只有 IP 撞上才算同一台，光看主机名会误删别人的行。
   */
  private async sweepScriptRows(hostname: string, keepId: string, ips: unknown): Promise<void> {
    const host = String(hostname || '').trim().toLowerCase();
    const mine = new Set(
      (Array.isArray(ips) ? ips : []).map((v) => String(v ?? '').trim()).filter(Boolean),
    );
    if (!host || !mine.size) return;
    const rows = await this.prisma.systemConfig.findMany({ where: { key: { startsWith: 'client.machine.' } } });
    for (const row of rows) {
      const value: any = (row.value as any) || {};
      const strayId = String(value.machineId || String(row.key).replace('client.machine.', ''));
      if (!strayId || strayId === keepId) continue;
      if (String(value.hostname || '').toLowerCase() !== host) continue;
      if (isMachineSelfSource(value.lastSource) || value.appVersion) continue;
      const theirs = [
        ...(Array.isArray(value.ips) ? value.ips.map((v: unknown) => String(v ?? '').trim()) : []),
        String(value.primaryIp || '').trim(),
      ].filter(Boolean);
      if (!theirs.some((ip) => mine.has(ip))) continue;
      await this.dropStrayScriptRow(strayId, keepId, hostname, value);
    }
  }

  /**
   * 机器列表：三路合并，保证「该看见的都在」。
   *   ① client.machine.*  → 装了新版客户端、会上报的机器（能远程诊断）
   *   ② cs.client.version.* → 客服端还没升级的账号（只能看见版本/在线，暂不可诊断）
   *   ③ ManagedPC 表      → 手工登记的陪玩电脑（可开关机，但不可诊断）
   */
  async listMachines() {
    const [machineRows, tasks, csRows, csUsers, managedPcs, watchdogCfg] = await Promise.all([
      this.prisma.systemConfig.findMany({ where: { key: { startsWith: 'client.machine.' } } }),
      this.prisma.systemConfig.findMany({ where: { key: { startsWith: 'client.task.' } } }),
      this.prisma.systemConfig.findMany({ where: { key: { startsWith: 'cs.client.version.' } } }),
      this.prisma.user.findMany({ select: { id: true, username: true, role: true, studioId: true } }),
      this.prisma.managedPC.findMany({ orderBy: { ip: 'asc' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'watchdog.latest_build' } }),
    ]);

    const userById = new Map(csUsers.map((u) => [u.id, u]));
    const taskList = tasks.map((t) => (t.value as any) || {}).filter((t) => t && t.id);
    const taskStats = new Map<string, { pending: number; lastAt: string | null; lastStatus: string | null }>();
    for (const t of taskList) {
      const st = taskStats.get(t.machineId) || { pending: 0, lastAt: null, lastStatus: null };
      if (t.status === 'pending' || t.status === 'running') st.pending += 1;
      const at = t.finishedAt || t.createdAt || null;
      if (at && (!st.lastAt || at > st.lastAt)) {
        st.lastAt = at;
        st.lastStatus = t.status || null;
      }
      taskStats.set(t.machineId, st);
    }

    const seenLogins = new Set<string>();
    const items: any[] = [];
    for (const row of machineRows) {
      const m = (row.value as any) || {};
      if (!m.machineId) continue;
      if (m.loginUser) seenLogins.add(m.loginUser);
      const st = taskStats.get(m.machineId);
      items.push({
        machineId: m.machineId,
        source: 'machine',
        clientType: m.clientType || 'UNKNOWN',
        hostname: m.hostname || '',
        label: m.hostname || m.machineId,
        windowsUser: m.windowsUser || '',
        loginUser: m.loginUser || '',
        loginRole: m.loginRole || '',
        ips: m.ips || [],
        primaryIp: m.primaryIp || '',
        mac: m.mac || '',
        os: m.os || '',
        appVersion: m.appVersion || '',
        watchdogBuild: m.watchdogBuild || '',
        remoteReady: !!m.remoteReady,
        remoteAccount: m.remoteAccount || '',
        remotePassword: m.remotePassword || '',
        firstSeenAt: m.firstSeenAt || null,
        lastSeenAt: m.lastSeenAt || null,
        online: this.isOnline(m.lastSeenAt),
        diagnosable: true,
        pendingTasks: st?.pending ?? 0,
        lastTaskAt: st?.lastAt ?? null,
        lastTaskStatus: st?.lastStatus ?? null,
      });
    }

    for (const row of csRows) {
      const userId = row.key.replace('cs.client.version.', '');
      const value: any = row.value || {};
      const user = userById.get(userId);
      if (!user) continue;
      if (seenLogins.has(user.username)) continue;
      const machineId = `user-${userId}`;
      items.push({
        machineId,
        source: 'cs-user',
        clientType: 'CS',
        hostname: '',
        label: `${user.username} 的电脑`,
        windowsUser: '',
        loginUser: user.username,
        loginRole: user.role,
        ips: [],
        primaryIp: '',
        mac: '',
        os: '',
        appVersion: value.version || '',
        watchdogBuild: '',
        remoteReady: false,
        remoteAccount: '',
        remotePassword: '',
        firstSeenAt: null,
        lastSeenAt: value.lastSeen || null,
        online: this.isOnline(value.lastSeen),
        diagnosable: false,
        pendingTasks: 0,
        lastTaskAt: null,
        lastTaskStatus: null,
      });
    }

    for (const pc of managedPcs) {
      items.push({
        machineId: `managedpc-${pc.id}`,
        source: 'managed-pc',
        clientType: 'COMPANION',
        hostname: pc.label || '',
        label: pc.label || pc.loginAccount,
        windowsUser: '',
        loginUser: pc.loginAccount,
        loginRole: 'COMPANION',
        ips: pc.ip ? [pc.ip] : [],
        primaryIp: pc.ip,
        mac: pc.macAddress || '',
        os: '',
        appVersion: '',
        watchdogBuild: '',
        remoteReady: false,
        remoteAccount: '',
        remotePassword: '',
        firstSeenAt: null,
        lastSeenAt: null,
        online: false,
        diagnosable: false,
        pendingTasks: 0,
        lastTaskAt: pc.lastActionAt || null,
        lastTaskStatus: pc.lastAction || null,
      });
    }

    items.sort((a, b) => {
      // 真有客户端上报的机器排最前（那些才点得动「一键诊断」），其次是旧版客服端账号行、
      // 最后是手工登记的陪玩电脑。
      const ra = a.source === 'machine' ? 0 : 1;
      const rb = b.source === 'machine' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      if (a.online !== b.online) return a.online ? -1 : 1;
      const ta = a.lastSeenAt || '';
      const tb = b.lastSeenAt || '';
      if (ta !== tb) return ta < tb ? 1 : -1;
      return String(a.label).localeCompare(String(b.label));
    });

    return {
      diagScriptVersion: CLIENT_DIAG_SCRIPT_VERSION,
      watchdogLatestBuild: (() => {
        const raw: any = watchdogCfg?.value;
        const value = typeof raw === 'string' ? raw : raw?.value;
        return String(value ?? '').trim();
      })(),
      total: items.length,
      onlineCount: items.filter((i) => i.online).length,
      remoteReadyCount: items.filter((i) => i.remoteReady).length,
      items,
    };
  }

  private isOnline(lastSeenAt?: string | null): boolean {
    if (!lastSeenAt) return false;
    const t = new Date(lastSeenAt).getTime();
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < MachineService.ONLINE_WINDOW_MS;
  }

  /** 看门狗（SYSTEM 服务）最近有没有来领过任务。 */
  private systemPollerAlive(machine: any): boolean {
    const raw = String(machine?.systemPollAt || '');
    if (!raw) return false;
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < MachineService.SYSTEM_POLL_WINDOW_MS;
  }

  /** 云端那份看门狗的构建号（发布脚本写进配置；没有就只按「远程管理开没开」判断）。 */
  private async watchdogTargetBuild(): Promise<string> {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: 'watchdog.latest_build' } });
    const raw: any = row?.value;
    const value = typeof raw === 'string' ? raw : raw?.value;
    return String(value ?? '').trim();
  }

  /**
   * 上报即自愈（老板 2026-10-01：「你看看还谁不是全自动的……以后都弄全自动好么？」）。
   *
   * 客户端 / 看门狗一上报，就顺手判断这台机器缺什么：
   *   ① 远程管理没开通（`remoteReady=false`）→ 补一条「开通远程管理」；
   *   ② 看门狗构建号跟云端对不上（含「老看门狗压根不认识构建号」）→ 同一条任务里补上，
   *      脚本会把看门狗换成云端最新那份。
   * 这条任务由看门狗（SYSTEM 服务）执行，所以不需要人点、不需要人在电脑跟前、
   * 也不需要登录账号是管理员。同一条任务 6 小时内只补一次，避免反复派。
   */
  private async autoHeal(record: any): Promise<void> {
    const machineId = String(record?.machineId || '');
    if (!machineId) return;
    // 连类型都不知道的行（手工登记的陪玩电脑之类）别去碰。
    if (String(record.clientType || '').toUpperCase() === 'UNKNOWN') return;
    const target = await this.watchdogTargetBuild();
    const build = String(record.watchdogBuild || '');
    const needsRemote = !record.remoteReady;
    const needsWatchdog = !!target && build !== target;
    if (!needsRemote && !needsWatchdog) return;

    const rows = await this.prisma.systemConfig.findMany({ where: { key: { startsWith: 'client.task.' } } });
    const mine = rows
      .map((r) => (r.value as any) || {})
      .filter((t) => t && t.machineId === machineId && t.type === 'enable-remote');
    if (mine.some((t) => t.status === 'pending' || t.status === 'running')) return;
    // 冷却：远程管理这条走「每 6 小时体检一次」；看门狗这条 2 小时一次 —— 它一旦补上去，
    // 看门狗下一分钟就会把新构建号报上来，条件自己就没了，不会一直补。
    const cooldownMs = needsRemote ? 6 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
    const last = mine.map((t) => String(t.createdAt || '')).sort().pop() || '';
    if (last && Date.now() - new Date(last).getTime() < cooldownMs) return;

    await this.createTask({
      machineId,
      type: 'enable-remote',
      reason: needsRemote ? '自动自愈：开通远程管理' : '自动自愈：看门狗换成云端最新那份',
      actor: { username: 'system', id: '' },
    });
  }

  // ── 任务队列 ────────────────────────────────────────────────────────────

  async createTask(input: {
    machineId: string;
    type: 'diag' | 'shell' | 'enable-remote';
    command?: string;
    reason?: string;
    actor?: { id?: string; username?: string };
  }): Promise<any> {
    const machine = await this.readMachine(input.machineId);
    if (!machine) {
      // 允许对已存在但还没上报过的台账行下发任务没有意义，直接说清楚。
      const err: any = new Error('这台机器还没上报过信息，暂时没法远程诊断');
      err.status = 404;
      throw err;
    }
    if (input.type === 'shell' && !String(input.command || '').trim()) {
      const err: any = new Error('请填写要执行的命令');
      err.status = 400;
      throw err;
    }
    const now = new Date();
    const task = {
      id: randomUUID(),
      machineId: input.machineId,
      machineLabel: machine.hostname || input.machineId,
      clientType: machine.clientType || 'UNKNOWN',
      type: input.type,
      command: input.type === 'shell' ? String(input.command || '').slice(0, 4000) : '',
      reason: String(input.reason || '').slice(0, 200),
      createdBy: input.actor?.username || '',
      createdById: input.actor?.id || '',
      createdAt: now.toISOString(),
      status: 'pending',
      startedAt: null as string | null,
      finishedAt: null as string | null,
      exitCode: null as number | null,
      reportFile: '',
      reportPreview: '',
      error: '',
    };
    await this.prisma.systemConfig.create({
      data: { key: `client.task.${task.id}`, value: task as any },
    });
    this.logger.warn(`远程任务已排队: ${input.type} → ${task.machineLabel}(${input.machineId}) by ${task.createdBy || '未知'}`);
    void this.pruneTasks();
    return task;
  }

  /**
   * 客户端 / 看门狗来领任务：只领自己名下的 pending，领走即置 running，避免重复执行。
   *
   * 谁有权执行：管理端下发的诊断 / 指令 / 开通远程管理都要管理员权限，而客户端是以
   * **登录用户**身份跑的。2026-10-01 实拍：叶号那台（WIN-20260311RKT）登录的 Windows 账号
   * 不是管理员，脚本第一行就是「是不是管理员: False」，任务白派。所以现在改成
   * **看门狗（SYSTEM 服务）优先**：只要它近 3 分钟来领过任务，客户端就领不到 ——
   * 没人登录、登录的是普通账号，任务照样以系统权限执行。
   */
  async takeTasks(machineId: string, limit = 3, as: 'system' | 'user' = 'user') {
    const wanted = Math.max(1, Math.min(5, Number(limit) || 3));
    const machine = await this.readMachine(machineId);
    if (!machine) return { tasks: [] as any[], serverTime: new Date().toISOString() };
    if (as === 'user' && this.systemPollerAlive(machine)) {
      return { tasks: [] as any[], serverTime: new Date().toISOString(), executedBy: 'system' };
    }
    await this.expireStaleTasks();
    const rows = await this.prisma.systemConfig.findMany({ where: { key: { startsWith: 'client.task.' } } });
    const mine = rows
      .map((r) => (r.value as any) || {})
      .filter((t) => t && t.machineId === machineId && t.status === 'pending')
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .slice(0, wanted);

    const out: any[] = [];
    for (const task of mine) {
      const startedAt = new Date().toISOString();
      const next = { ...task, status: 'running', startedAt };
      await this.prisma.systemConfig.update({ where: { key: `client.task.${task.id}` }, data: { value: next as any } });
      out.push(this.buildTaskPayload(next, machine));
    }
    return { tasks: out, serverTime: new Date().toISOString() };
  }

  /** 把任务翻译成客户端能直接执行的东西。 */
  private buildTaskPayload(task: any, machine: any) {
    const base = {
      id: task.id,
      type: task.type,
      reason: task.reason || '',
      createdAt: task.createdAt,
      timeoutSec: task.type === 'shell' ? 300 : 240,
    };
    if (task.type === 'diag') {
      return { ...base, mode: 'script', script: buildClientDiagScript(ONBOARD_REPORT_TOKEN), args: ['-OutFile', '__OUT__', '-ServerUrl', '__SERVER__', '-TaskId', task.id, '-Reason', task.reason || '远程一键诊断'] };
    }
    if (task.type === 'enable-remote') {
      return { ...base, mode: 'script', script: buildEnableRemoteScript(ONBOARD_REPORT_TOKEN), args: ['-ServerUrl', '__SERVER__', '-ClientType', machine?.clientType || ''] };
    }
    return { ...base, mode: 'command', command: task.command || '' };
  }

  /** 客户端把执行结果交回来。 */
  async finishTask(payload: any) {
    const taskId = String(payload?.taskId || '').trim();
    if (!taskId) return { saved: false, reason: 'missing taskId' };
    const row = await this.prisma.systemConfig.findUnique({ where: { key: `client.task.${taskId}` } });
    if (!row) return { saved: false, reason: '任务不存在' };
    const task: any = (row.value as any) || {};
    const lines = String(payload?.lines || '').slice(0, 400_000);
    const machineId = String(payload?.machineId || task.machineId || '');
    const machine = await this.readMachine(machineId);
    const hostname = (machine?.hostname as string) || (payload?.hostname as string) || machineId || 'unknown';
    let reportFile = '';
    try {
      const dir = path.join(this.resolveDataDir('onboard-reports'), 'diag');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      reportFile = path.join(dir, `${hostname}-${stamp}-task-${task.type}.log`);
      const header = [
        `taskId=${taskId}`,
        `machineId=${machineId}`,
        `hostname=${hostname}`,
        `type=${task.type}`,
        `command=${task.command || ''}`,
        `requestedBy=${task.createdBy || ''}`,
        `requestedAt=${task.createdAt || ''}`,
        `at=${new Date().toISOString()}`,
        `exitCode=${payload?.exitCode ?? ''}`,
        `error=${String(payload?.error || '').slice(0, 500)}`,
        '',
      ].join('\n');
      fs.writeFileSync(reportFile, header + lines + '\n', 'utf8');
    } catch (err: any) {
      this.logger.error(`诊断报告落盘失败: ${err?.message || err}`);
    }
    const status = String(payload?.status || '').toLowerCase() === 'ok' ? 'done' : 'failed';
    const next = {
      ...task,
      status,
      finishedAt: new Date().toISOString(),
      exitCode: typeof payload?.exitCode === 'number' ? payload.exitCode : null,
      reportFile,
      reportPreview: lines.slice(0, 600),
      reportLines: lines ? lines.split('\n').length : 0,
      error: String(payload?.error || '').slice(0, 500),
      tookMs: typeof payload?.tookMs === 'number' ? payload.tookMs : null,
    };
    await this.prisma.systemConfig.update({ where: { key: `client.task.${taskId}` }, data: { value: next as any } });
    this.logger.warn(`远程任务完成: ${task.type} → ${hostname} [${status}] ${next.reportLines || 0} 行`);
    return { saved: true, status, reportFile, lines: next.reportLines || 0 };
  }

  async listTasks(machineId: string, limit = 30) {
    const rows = await this.prisma.systemConfig.findMany({ where: { key: { startsWith: 'client.task.' } } });
    return rows
      .map((r) => (r.value as any) || {})
      .filter((t) => t && t.machineId === machineId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.max(1, Math.min(200, limit)));
  }

  /** 读某一趟诊断的报告正文。 */
  async readReport(taskId: string) {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: `client.task.${taskId}` } });
    const task: any = (row?.value as any) || null;
    if (!task) return null;
    let text = '';
    try {
      if (task.reportFile && fs.existsSync(task.reportFile)) text = fs.readFileSync(task.reportFile, 'utf8');
    } catch (err: any) {
      text = `读取报告失败: ${err?.message || err}`;
    }
    return { task, text };
  }

  /** 超时没回来的任务标成失败，别让界面一直显示「执行中」。 */
  async expireStaleTasks(): Promise<void> {
    try {
      const rows = await this.prisma.systemConfig.findMany({ where: { key: { startsWith: 'client.task.' } } });
      const now = Date.now();
      for (const r of rows) {
        const t: any = (r.value as any) || {};
        if (!t.id || t.status !== 'running') continue;
        const at = new Date(t.startedAt || t.createdAt).getTime();
        if (!Number.isFinite(at) || now - at < MachineService.TASK_TIMEOUT_MS) continue;
        await this.prisma.systemConfig.update({
          where: { key: r.key },
          data: { value: { ...t, status: 'failed', finishedAt: new Date().toISOString(), error: '客户端超时没有回报（电脑关机 / 断网 / 客户端没在跑）' } as any },
        });
      }
    } catch (err: any) {
      this.logger.warn(`清理超时任务失败: ${err?.message || err}`);
    }
  }

  /** 任务台账只留最近的，避免 SystemConfig 无限长大。 */
  private async pruneTasks(): Promise<void> {
    try {
      const rows = await this.prisma.systemConfig.findMany({ where: { key: { startsWith: 'client.task.' } } });
      if (rows.length <= MachineService.MAX_TASKS) return;
      const sorted = rows
        .map((r) => ({ key: r.key, at: String(((r.value as any) || {}).createdAt || '') }))
        .sort((a, b) => a.at.localeCompare(b.at));
      const drop = sorted.slice(0, sorted.length - MachineService.MAX_TASKS);
      for (const d of drop) await this.prisma.systemConfig.delete({ where: { key: d.key } });
      this.logger.log(`清理了 ${drop.length} 条旧远程任务`);
    } catch (err: any) {
      this.logger.warn(`清理旧任务失败: ${err?.message || err}`);
    }
  }

  /** 给手工下载用的脚本正文（客户端点「下载诊断脚本」/ 客服自己双击跑）。 */
  getDiagScriptText(): string {
    return buildClientDiagScript(ONBOARD_REPORT_TOKEN);
  }

  getEnableRemoteScriptText(): string {
    return buildEnableRemoteScript(ONBOARD_REPORT_TOKEN);
  }

  /** 数据落盘目录：和 uploads 同级（部署在 repo 根目录），公网下不到。 */
  private resolveDataDir(name: string): string {
    let dir = __dirname;
    for (let depth = 0; depth < 6; depth += 1) {
      if (fs.existsSync(path.join(dir, 'uploads'))) return path.join(dir, name);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return path.join(os.tmpdir(), `chunlv-${name}`);
  }

  /** 诊断脚本正文（给控制器做「下载 .ps1」用）。 */
  get diagPsBody(): string {
    return CLIENT_DIAG_PS;
  }

  get enableRemotePsBody(): string {
    return CLIENT_ENABLE_REMOTE_PS;
  }
}
