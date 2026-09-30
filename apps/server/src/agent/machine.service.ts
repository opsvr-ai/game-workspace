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
  /** 台账里最多留多少条任务，超了就删最老的。 */
  private static readonly MAX_TASKS = 400;

  constructor(private readonly prisma: PrismaService) {}

  // ── 台账 ────────────────────────────────────────────────────────────────

  /** 客户端上报自己是谁。同一个 machineId 覆盖更新，不新增行。 */
  async reportMachine(payload: any): Promise<{ machineId: string; lastSeenAt: string }> {
    const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
    const machineId = clean(payload?.machineId, 120) || clean(payload?.hostname, 120).toLowerCase();
    const now = new Date();
    const before = await this.readMachine(machineId);
    const record: any = {
      machineId,
      clientType: clean(payload?.clientType, 16) || before?.clientType || 'UNKNOWN',
      hostname: clean(payload?.hostname, 120) || before?.hostname || '',
      windowsUser: clean(payload?.windowsUser, 120) || before?.windowsUser || '',
      loginUser: clean(payload?.loginUser, 60) || before?.loginUser || '',
      loginRole: clean(payload?.loginRole, 20) || before?.loginRole || '',
      ips: Array.isArray(payload?.ips) ? payload.ips.map((v: unknown) => clean(v, 64)).slice(0, 12) : before?.ips || [],
      primaryIp: clean(payload?.primaryIp, 64) || before?.primaryIp || '',
      mac: clean(payload?.mac, 64) || before?.mac || '',
      os: clean(payload?.os, 160) || before?.os || '',
      appVersion: clean(payload?.appVersion, 60) || before?.appVersion || '',
      agentBuild: clean(payload?.agentBuild, 60) || before?.agentBuild || '',
      remoteReady: payload?.remoteReady === undefined ? !!before?.remoteReady : !!payload?.remoteReady,
      remoteAccount: clean(payload?.remoteAccount, 60) || before?.remoteAccount || '',
      remotePassword: clean(payload?.remotePassword, 120) || before?.remotePassword || '',
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
    return { machineId, lastSeenAt: record.lastSeenAt };
  }

  private async readMachine(machineId: string): Promise<any | null> {
    if (!machineId) return null;
    const row = await this.prisma.systemConfig.findUnique({ where: { key: `client.machine.${machineId}` } });
    return (row?.value as any) || null;
  }

  /**
   * 机器列表：三路合并，保证「该看见的都在」。
   *   ① client.machine.*  → 装了新版客户端、会上报的机器（能远程诊断）
   *   ② cs.client.version.* → 客服端还没升级的账号（只能看见版本/在线，暂不可诊断）
   *   ③ ManagedPC 表      → 手工登记的陪玩电脑（可开关机，但不可诊断）
   */
  async listMachines() {
    const [machineRows, tasks, csRows, csUsers, managedPcs] = await Promise.all([
      this.prisma.systemConfig.findMany({ where: { key: { startsWith: 'client.machine.' } } }),
      this.prisma.systemConfig.findMany({ where: { key: { startsWith: 'client.task.' } } }),
      this.prisma.systemConfig.findMany({ where: { key: { startsWith: 'cs.client.version.' } } }),
      this.prisma.user.findMany({ select: { id: true, username: true, role: true, studioId: true } }),
      this.prisma.managedPC.findMany({ orderBy: { ip: 'asc' } }),
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

  /** 客户端来领任务：只领自己名下的 pending，领走即置 running，避免重复执行。 */
  async takeTasks(machineId: string, limit = 3) {
    const wanted = Math.max(1, Math.min(5, Number(limit) || 3));
    const machine = await this.readMachine(machineId);
    if (!machine) return { tasks: [] as any[], serverTime: new Date().toISOString() };
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
