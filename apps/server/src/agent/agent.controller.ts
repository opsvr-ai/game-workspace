// craftsman-ignore: TS001,TS003
import { Controller, Get, Post, Res, Req, UseGuards, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import { AgentService } from './agent.service';
import { WsGateway } from '../ws/ws.gateway';
import { logger } from '../common/logger';
import { streamFileThrottled } from '../common/throttled-file';
import type { ApiResponse } from '@chunlv/shared';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Resolve the server URL reachable from other machines on the LAN.
 * If the request host is localhost, fall back to the server's LAN IP.
 */
function resolveServerUrl(req: any): string {
  const host = req.get('host') as string;
  // If already using a real IP/hostname, use it as-is
  if (host && !host.startsWith('localhost') && !host.startsWith('127.') && !host.startsWith('[::1]')) {
    return `${req.protocol}://${host}`;
  }
  // Detect LAN IP — prefer 192.168.x.x or 10.x.x.x, skip Docker bridges
  const nets = os.networkInterfaces();
  const candidates: string[] = [];
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        candidates.push(addr.address);
      }
    }
  }
  // Prefer real LAN IPs over Docker bridges (172.17-19.x.x)
  const lan = candidates.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.'));
  const selected = lan || candidates[0] || '127.0.0.1';
  return `${req.protocol}://${selected}:3001`;
}

/**
 * 新电脑自动装机上报用的共享令牌。
 * 脚本里会带上它；只用于挡住误报/乱报，不是强认证（装机脚本本身是公开下载的）。
 */
const ONBOARD_REPORT_TOKEN = 'c4f1a2e7d9b8435fa6e10c7d2b9f8e34';

/** 版本号比较：1.0.20260924 > 1.0.20260923。 */
function compareVersionStrings(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

@Controller('agent')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly wsGateway: WsGateway,
    private readonly jwt: JwtService,
  ) {
    // 名额一空就叫下一位排队的人来下载（正在接单的跳过）。
    // 没有这一步的话，一台下完名额就空着，其他人要等 30 分钟才来问一次，
    // 一次发布要几小时才能铺开。
    this.agentService.setUpdateNotifier(() => this.pumpUpdateQueue());
  }

  /**
   * 叫号：按排队先后问一遍，跳过正在接单（不能打断）和已经是最新版本的机器，
   * 把「去更新」推给第一台能更新的机器；剩下的等下一次 release 继续叫。
   */
  private async pumpUpdateQueue(): Promise<void> {
    const skipped: Array<{ companionId: string; firstAskedAt: number }> = [];
    try {
      const { version, downloadUrl } = await this.agentService.getLatestVersion();
      for (let i = 0; i < 50; i += 1) {
        const next = this.agentService.takeNextUpdateWaiter();
        if (!next) break;
        if (await this.agentService.isCompanionInService(next.companionId)) {
          skipped.push(next);
          continue;
        }
        const [target] = await this.agentService.getCompanionTargetsByIds([next.companionId]);
        if (target && compareVersionStrings(target.agentVersion, version) >= 0) {
          logger.info('Update queue: already on latest, skip', {
            companionId: next.companionId,
            agentVersion: target.agentVersion,
            version,
          });
          continue;
        }
        const sent = this.wsGateway.sendCommand(next.companionId, 'update', { downloadUrl, version });
        logger.info('Update queue: notify next waiter', {
          companionId: next.companionId,
          name: target?.name,
          sent,
          version,
        });
        if (sent) return;
      }
    } catch (err: any) {
      logger.warn(`Update queue pump error: ${err?.message || err}`);
    } finally {
      for (const waiter of skipped) this.agentService.requeueUpdateWaiter(waiter);
    }
  }

  /** 客户端更新时带的是 refreshToken（7 天），而标准 JWT 守卫只认 accessToken（15 分钟）。
   *  这里手动用双密钥验证，避免 update/acquire 因 401 卡住导致永远无法更新。 */
  private resolveCompanionId(req: any): string {
    const auth = (req.headers?.authorization || req.headers?.Authorization || '') as string;
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return '';
    let payload: any;
    try {
      payload = this.jwt.verify(token, { secret: process.env.JWT_SECRET });
    } catch {
      try {
        payload = this.jwt.verify(token, { secret: process.env.JWT_REFRESH_SECRET });
      } catch {
        return '';
      }
    }
    return payload?.companionId || payload?.sub || '';
  }

  // Public: companion calls this on startup (no auth needed)
  @Get('version')
  async getVersion(): Promise<ApiResponse<unknown>> {
    const data = await this.agentService.getLatestVersion();
    return { code: 200, message: 'ok', data };
  }

  // Public: companion polls this to reload the web page when a new frontend is deployed.
  @Get('frontend-version')
  async getFrontendVersion(): Promise<ApiResponse<unknown>> {
    const data = await this.agentService.getFrontendVersion();
    return { code: 200, message: 'ok', data };
  }

  // Public (shared token): a freshly onboarded PC reports the remote-support account it just
  // created, so the machine stays remotely reachable without asking its owner for the password.
  @Post('onboard-report')
  async onboardReport(@Body() body: any, @Req() req: any): Promise<ApiResponse<unknown>> {
    const token = String(req.headers?.['x-onboard-token'] || '');
    if (token !== ONBOARD_REPORT_TOKEN) {
      return { code: 403, message: 'forbidden', data: null };
    }
    const data = this.agentService.recordOnboardReport(body);
    return { code: 200, message: 'ok', data };
  }

  // Public: 前端把「请求根本没到服务器」的网络层故障回传上来。
  // 服务端日志看不到这类失败（连接都没建立），只能靠前端上报，落到 client-errors/。
  @Post('client-error')
  async clientError(@Body() body: any, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = this.agentService.recordClientError({ ...(body || {}), ip: req.ip });
    return { code: 200, message: 'ok', data };
  }

  // Public: CS client checks for its own updates
  @Get('cs-version')
  async getCsVersion(): Promise<ApiResponse<unknown>> {
    const data = await this.agentService.getCsLatestVersion();
    return { code: 200, message: 'ok', data };
  }

  @Post('cs-heartbeat')
  @UseGuards(AuthGuard('jwt'))
  async csHeartbeat(@Req() req: any, @Body() body: { agentVersion?: string }): Promise<ApiResponse<unknown>> {
    if (!req.user?.id) return { code: 401, message: '未登录', data: null };
    await this.agentService.reportCsVersion(req.user.id, body?.agentVersion || '0.0.0');
    return { code: 200, message: 'ok', data: null };
  }

  @Get('cs-version-status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async csVersionStatus(): Promise<ApiResponse<unknown>> {
    const data = await this.agentService.listCsVersionStatus();
    return { code: 200, message: 'ok', data };
  }

  // Companion client reports heartbeat/version over REST as a reliable fallback
  @Post('heartbeat')
  @UseGuards(AuthGuard('jwt'))
  async heartbeat(@Req() req: any, @Body() body: { agentVersion?: string }): Promise<ApiResponse<unknown>> {
    const user = req.user;
    if (!user?.companionId) {
      return { code: 200, message: 'ok', data: { webBuildId: this.agentService.deployId } };
    }
    const [data, inService] = await Promise.all([
      this.agentService.recordHeartbeat(user.companionId, body?.agentVersion),
      this.agentService.isCompanionInService(user.companionId),
    ]);
    return {
      code: 200,
      message: 'ok',
      data: { ...data, webBuildId: this.agentService.deployId, inService },
    };
  }

  // 远程自测：让陪玩端自杀进程，验证看门狗是否会自动拉起
  @Post('test-watchdog')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async testWatchdog(@Body() body: { companionId: string }): Promise<ApiResponse<unknown>> {
    if (!body?.companionId) {
      return { code: 400, message: '缺少陪玩ID', data: null };
    }
    this.wsGateway.sendCommand(body.companionId, 'test_watchdog', {});
    return { code: 200, message: '自测指令已发送', data: { companionId: body.companionId } };
  }

  // 陪玩端上报本地日志（排查掉线/看门狗用），服务端只落日志便于运维检索。
  @Post('logs/report')
  @UseGuards(AuthGuard('jwt'))
  async reportLogs(
    @Req() req: any,
    @Body() body: { source?: string; lines?: string },
  ): Promise<ApiResponse<unknown>> {
    const companionId = req.user?.companionId || req.user?.id || '';
    const lines = body?.lines || '';
    logger.info('RECV client logs', {
      companionId,
      source: body?.source || '',
      len: lines.length,
    });
    // 每条一行写进 combined.log，方便用 companionId 检索
    for (const line of lines.split(/\r?\n/)) {
      if (line.trim()) logger.info('CLIENT_LOG', { companionId, source: body?.source || '', line });
    }
    return { code: 200, message: 'ok', data: null };
  }

  // 陪玩端下载更新前先申请名额，服务端串行放行，避免多台同时下载抢带宽。
  @Post('update/acquire')
  async acquireUpdateSlot(@Req() req: any): Promise<ApiResponse<unknown>> {
    // 新机器装完还没登录，拿不到令牌：用 IP 兜底给它一个排队身份。
    // 否则客户端只能打印「Update slot busy」，版本卡死在装机包那一版。
    const companionId = this.resolveCompanionId(req) || `anon:${req.ip || 'unknown'}`;
    const result = this.agentService.acquireUpdateSlot(companionId);
    return { code: 200, message: 'ok', data: result };
  }

  @Post('update/release')
  async releaseUpdateSlot(@Req() req: any): Promise<ApiResponse<unknown>> {
    const companionId = this.resolveCompanionId(req);
    this.agentService.releaseUpdateSlot(companionId);
    return { code: 200, message: 'ok', data: null };
  }

  // Public: 自动更新专用 —— 返回 win-unpacked 的 zip，SystemHelper 服务按 zip 解压覆盖安装目录。
  // 限速下发：全速下发会把办公室那条网占满，别的陪玩接口请求超时（看起来像掉线）。
  @Get('download/latest')
  async downloadLatest(@Res() res: Response): Promise<void> {
    const zipPath = this.agentService.getLatestZipPath();
    if (!fs.existsSync(zipPath)) {
      res.status(404).json({ code: 404, message: '更新包不存在，请先构建', data: null });
      return;
    }
    await streamFileThrottled(zipPath, 'chunlv-latest.zip', res);
  }

  // Public: 全新安装 / 远程部署专用 —— 返回 NSIS 安装器。
  @Get('download/exe')
  async downloadExe(@Res() res: Response): Promise<void> {
    const exePath = this.agentService.getLatestExePath();
    if (!fs.existsSync(exePath)) {
      res.status(404).json({ code: 404, message: '安装包不存在，请先构建', data: null });
      return;
    }
    res.download(exePath, '陪玩管理-Setup.exe');
  }

  // Public: CS client downloads its own installer
  @Get('download/cs')
  async downloadCs(@Res() res: Response): Promise<void> {
    const exePath = this.agentService.getLatestCsExePath();
    if (!fs.existsSync(exePath)) {
      res.status(404).json({ code: 404, message: '客服端安装包不存在，请先构建', data: null });
      return;
    }
    res.download(exePath, '客服管理-Setup.exe');
  }

  // Admin only: view version distribution
  @Get('version-status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async getVersionStatus(): Promise<ApiResponse<unknown>> {
    const data = await this.agentService.getVersionStatus();
    return { code: 200, message: 'ok', data };
  }

  // Admin only: 看更新队列（谁在下载、几台在排队），发布时用来盯铺开进度
  @Get('update/queue')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async getUpdateQueue(): Promise<ApiResponse<unknown>> {
    return { code: 200, message: 'ok', data: this.agentService.getUpdateSlot() };
  }

  // Admin only: trigger build and push
  @Post('build-and-push')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async buildAndPush(@Req() req: any): Promise<ApiResponse<unknown>> {
    const result = await this.agentService.buildAndPush();

    if (result.success) {
      if (req.user?.studioId) {
        this.wsGateway.broadcastToStudio(req.user.studioId, 'pc:command', {
          command: 'update',
          downloadUrl: '/api/agent/download/latest',
          version: result.version,
        });
      }
      return { code: 200, message: '构建成功，已推送到在线陪玩', data: result };
    }

    return { code: 500, message: '构建失败', data: result };
  }

  // Admin only: push update to specific companions
  @Post('update/push')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async pushUpdate(@Body() body: { companionIds: string[] }): Promise<ApiResponse<unknown>> {
    const { companionIds } = body;
    if (!companionIds || companionIds.length === 0) {
      return { code: 400, message: '请选择至少一个陪玩', data: null };
    }

    const { version, downloadUrl } = await this.agentService.getLatestVersion();
    const targets = await this.agentService.getCompanionTargetsByIds(companionIds);
    let successCount = 0;
    const results = targets.map((target) => {
      const sent = this.wsGateway.sendCommand(target.companionId, 'update', { downloadUrl, version });
      if (sent) successCount += 1;
      return { ...target, sent };
    });

    return {
      code: 200,
      message: `已向 ${successCount}/${targets.length} 位在线陪玩发送更新命令`,
      data: { successCount, total: targets.length, version, results },
    };
  }

  // Admin only: push update to entire studio (OWNER pushes to all companions)
  @Post('update/push-studio')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async pushUpdateStudio(@Req() req: any): Promise<ApiResponse<unknown>> {
    const { version, downloadUrl } = await this.agentService.getLatestVersion();
    const studioId = req.user?.studioId;

    if (!studioId && req.user?.role !== 'OWNER') {
      return { code: 400, message: '未找到所属工作室', data: null };
    }

    const targets = await this.agentService.getOnlineCompanionTargets(studioId || undefined);
    let successCount = 0;
    const results = targets.map((target) => {
      const sent = this.wsGateway.sendCommand(target.companionId, 'update', { downloadUrl, version });
      if (sent) successCount += 1;
      return { ...target, sent };
    });

    return {
      code: 200,
      message: `已向 ${successCount}/${targets.length} 位在线陪玩发送更新命令`,
      data: { successCount, total: targets.length, version, results },
    };
  }

  // Admin only: generate deploy script
  @Get('deploy/script')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async getDeployScript(@Req() req: any): Promise<ApiResponse<unknown>> {
    const serverUrl = resolveServerUrl(req);
    const script = this.agentService.generateDeployScript(serverUrl);
    const downloadUrl = `${serverUrl}/api/agent/download/exe`;

    return {
      code: 200,
      message: 'ok',
      data: { script, downloadUrl, serverUrl },
    };
  }

  // Scan LAN — ping sweep subnet, then detect Windows via SMB port
  @Get('deploy/scan-lan')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async scanLan(): Promise<ApiResponse<unknown>> {
    const { execSync } = require('child_process');
    const hosts: { ip: string; mac?: string }[] = [];
    const seen = new Set<string>();

    // 读取宿主机 ARP 表（容器通过只读挂载 /proc/net/arp 共享）
    try {
      if (fs.existsSync('/host-arp')) {
        const raw = fs.readFileSync('/host-arp', 'utf-8');
        for (const line of raw.split('\n')) {
          const parts = line.trim().split(/\s+/);
          const ip = parts[0];
          const mac = parts[3];
          if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !seen.has(ip)) {
            seen.add(ip);
            hosts.push({ ip, mac: mac && mac !== '00:00:00:00:00:00' ? mac : undefined });
          }
        }
      }
    } catch {}

    // ARP table (fast, already-communicated devices)
    try {
      const raw = execSync('arp -a', { timeout: 3000, encoding: 'utf-8' }) as string;
      for (const line of raw.split('\n')) {
        const m = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f:]+)/i);
        if (m && !seen.has(m[1])) {
          seen.add(m[1]);
          hosts.push({ ip: m[1], mac: m[2] });
        }
      }
    } catch {}

    // 安全慢速扫描常见局域网段。
    // 之前用 `fping -r 1` 对两个 /24 一次性高速打 ICMP，廉价路由器/交换机很容易瞬间拥塞。
    // 改为 `-c 1 -i 50`：每个 IP 只 ping 一次，间隔 50ms，单个 /24 约 13 秒，不会再形成 ping 风暴。
    try {
      const subnets = ['192.168.0.0/24', '192.168.1.0/24'];
      for (const subnet of subnets) {
        try {
          const result = execSync(`fping -a -c 1 -i 50 -t 300 -g ${subnet} 2>/dev/null || true`, {
            timeout: 20000,
            encoding: 'utf-8',
          }) as string;
          for (const line of result.split('\n')) {
            const ip = line.trim();
            if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !seen.has(ip)) {
              seen.add(ip);
              hosts.push({ ip });
            }
          }
        } catch {}
      }
    } catch {}

    // 容器里没有主机网卡时，再用当前进程网卡补充一次（慢速，且跳过 docker 网段）。
    try {
      const nets = require('os').networkInterfaces();
      const scanned = new Set<string>();
      for (const iface of Object.values(nets) as any[]) {
        for (const addr of iface as any[]) {
          if (addr.family !== 'IPv4' || addr.internal) continue;
          const ip = addr.address;
          if (!/^192\.168\.\d+\.\d+$/.test(ip)) continue;
          const subnet = ip.split('.').slice(0, 3).join('.');
          if (scanned.has(subnet)) continue;
          scanned.add(subnet);
          try {
            const result = execSync(`fping -a -c 1 -i 50 -t 300 -g ${subnet}.0/24 2>/dev/null || true`, {
              timeout: 20000,
              encoding: 'utf-8',
            }) as string;
            for (const line of result.split('\n')) {
              const found = line.trim();
              if (found && !seen.has(found) && /^\d+\.\d+\.\d+\.\d+$/.test(found)) {
                seen.add(found);
                hosts.push({ ip: found });
              }
            }
          } catch {}
        }
      }
    } catch {}

    // 3. Sort by IP
    hosts.sort((a, b) => {
      const aParts = a.ip.split('.').map(Number);
      const bParts = b.ip.split('.').map(Number);
      for (let i = 0; i < 4; i++) {
        if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
      }
      return 0;
    });

    return { code: 200, message: `发现 ${hosts.length} 台设备`, data: hosts };
  }

  // Admin only: generate PsExec remote deploy script
  @Post('deploy/remote-script')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getRemoteDeployScript(
    @Body() body: { targetIPs: string[]; adminUser: string; adminPass: string },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const { targetIPs, adminUser, adminPass } = body;
    if (!targetIPs || targetIPs.length === 0) {
      return { code: 400, message: '请输入目标电脑 IP', data: null };
    }
    if (!adminUser) {
      return { code: 400, message: '请输入管理员账号', data: null };
    }

    const serverUrl = resolveServerUrl(req);
    const script = this.agentService.generateRemoteDeployScript({
      targetIPs,
      adminUser,
      adminPass,
      serverUrl,
    });
    const downloadUrl = `${serverUrl}/api/agent/download/exe`;

    return {
      code: 200,
      message: 'ok',
      data: { script, downloadUrl, serverUrl, targetCount: targetIPs.length },
    };
  }

  // Admin only: execute remote deploy directly from server (no manual step needed)
  @Post('deploy/execute')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async executeRemoteDeploy(
    @Body() body: { targetIPs: string[]; adminUser?: string; adminPass?: string },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const { targetIPs, adminUser, adminPass } = body;
    if (!targetIPs || targetIPs.length === 0) {
      return { code: 400, message: '请输入目标电脑 IP', data: null };
    }

    const serverUrl = resolveServerUrl(req);
    const result = await this.agentService.executeRemoteDeploy({
      targetIPs,
      adminUser: adminUser || 'Administrator',
      adminPass: adminPass || '',
      serverUrl,
    });

    const okCount = result.results.filter((r) => r.status === 'OK').length;
    return {
      code: 200,
      message: `部署完成: ${okCount}/${result.results.length} 成功`,
      data: result,
    };
  }
}
